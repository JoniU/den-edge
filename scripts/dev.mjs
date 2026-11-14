#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEARTH_CONTAINER_PORT,
  hearthContainerEnvironment,
  localEdgeEnvironment,
  localWebEnvironment,
  newHearthSecrets,
} from "./dev-env.mjs";

const USAGE =
  "Usage: ./scripts/dev.mjs [--check] [--local-edge] [--hearth] [--no-install]";

if (process.platform === "win32") {
  console.error(
    "scripts/dev.mjs supports macOS and Linux. On Windows, run it inside WSL.",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const args = new Set(process.argv.slice(2));
const allowed = new Set([
  "--check",
  "--local-edge",
  "--hearth",
  "--no-install",
]);
for (const arg of args) {
  if (!allowed.has(arg)) {
    console.error(`Unknown option: ${arg}\n${USAGE}`);
    process.exit(2);
  }
}
const withHearth = args.has("--hearth");
const localEdge = withHearth || args.has("--local-edge");

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  console.error(
    `Node 24 or newer is required (found ${process.versions.node}).`,
  );
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error?.code === "ENOENT") {
    console.error(`${command} is required but was not found.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function output(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

for (const command of [
  "git",
  "npm",
  ...(localEdge ? ["cargo"] : []),
  ...(withHearth ? ["docker"] : []),
]) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.error?.code === "ENOENT" || result.status !== 0) {
    console.error(`${command} is required but was not found.`);
    process.exit(1);
  }
}
if (
  withHearth &&
  output("docker", ["info", "--format", "{{.ServerVersion}}"]) === undefined
) {
  console.error(
    "--hearth needs a running Docker daemon (start Docker Desktop, or the docker service).",
  );
  process.exit(1);
}

const submodule = spawnSync("git", ["submodule", "status", "spec"], {
  cwd: root,
  encoding: "utf8",
});
if (submodule.status !== 0 || submodule.stdout.startsWith("-")) {
  console.log("Initializing the den-spec submodule…");
  run("git", ["submodule", "update", "--init", "--depth", "1", "spec"]);
}

const lockfile = resolve(web, "package-lock.json");
const installStamp = resolve(web, "node_modules", ".package-lock.json");
const needsInstall =
  !existsSync(installStamp) ||
  statSync(installStamp).mtimeMs < statSync(lockfile).mtimeMs;
if (needsInstall && !args.has("--no-install")) {
  console.log("Installing web dependencies…");
  run("npm", ["ci", "--ignore-scripts"], { cwd: web });
} else if (needsInstall) {
  console.error(
    "Web dependencies are missing or stale; rerun without --no-install.",
  );
  process.exit(1);
}

// Built before anything starts, so a first compile, however long, is not counted against Edge's startup.
const edgeBinary = resolve(
  process.env.CARGO_TARGET_DIR ?? resolve(root, "target"),
  "debug",
  "den-edge",
);
if (localEdge) {
  console.log("Building den-edge…");
  run("cargo", ["build", "--locked", "--bin", "den-edge"]);
}

const hearthImage =
  process.env.DEN_DEV_HEARTH_IMAGE ?? "ghcr.io/oxyc/den-hearth:latest";
const hearthPlatform = process.env.DEN_DEV_HEARTH_PLATFORM ?? "linux/amd64";
if (withHearth) {
  console.log(`Pulling ${hearthImage}…`);
  const pulled = spawnSync(
    "docker",
    ["pull", "--platform", hearthPlatform, hearthImage],
    { stdio: "inherit" },
  );
  if (pulled.status !== 0) {
    if (output("docker", ["image", "inspect", hearthImage]) === undefined)
      process.exit(pulled.status ?? 1);
    console.warn(
      `Could not refresh ${hearthImage}; using the copy already pulled.`,
    );
  }
}

if (args.has("--check")) {
  console.log("Development prerequisites and dependencies are ready.");
  process.exit(0);
}

const edgePort = process.env.DEN_DEV_EDGE_PORT ?? "18080";
const webPort = process.env.DEN_DEV_WEB_PORT ?? "5173";
const hearthPort = process.env.DEN_DEV_HEARTH_PORT ?? "8090";
const devDir = resolve(root, ".dev");
const dataDir = resolve(devDir, "data");
if (localEdge) mkdirSync(dataDir, { recursive: true });

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) signal(child);
  setTimeout(() => process.exit(code), 1000);
}
function signal(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") console.error(error);
  }
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function start(command, commandArgs, options) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    detached: true,
    ...options,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signalName) => {
    children.delete(child);
    if (!stopping && !child.replaced) {
      console.error(
        `${command} exited unexpectedly (${signalName ?? code ?? "unknown"}).`,
      );
      stop(code || 1);
    }
  });
  return child;
}

/** Resolves once `url` answers 2xx. Past `seconds`, or once stopping, it stops everything and never resolves. */
async function healthy(url, seconds, name) {
  const deadline = Date.now() + seconds * 1000;
  while (!stopping) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    if (Date.now() >= deadline) {
      console.error(
        `${name} did not become healthy within ${seconds} seconds (${url}).`,
      );
      stop(1);
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  await new Promise(() => {});
}

/** Hearth's secrets: generated once, then reused so the installs made against this Hearth keep opening. */
function hearthSecrets(file) {
  if (!existsSync(file)) {
    const secrets = newHearthSecrets(() => randomBytes(32).toString("base64"));
    const lines = Object.entries(secrets).map(
      ([name, value]) => `${name}=${value}`,
    );
    writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  }
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
}

let hearth;
if (withHearth) {
  const secretsFile = resolve(devDir, "hearth.env");
  const secrets = hearthSecrets(secretsFile);
  const gateway = output("docker", [
    "network",
    "inspect",
    "bridge",
    "--format",
    "{{(index .IPAM.Config 0).Gateway}}",
  ]);
  if (!gateway) {
    console.error(
      "Could not read the Docker bridge gateway (docker network inspect bridge).",
    );
    process.exit(1);
  }
  const name = "den-dev-hearth";
  spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  const environment = hearthContainerEnvironment(
    `http://localhost:${webPort}`,
    gateway,
  );
  console.log(`Starting local Hearth on http://127.0.0.1:${hearthPort}…`);
  // As den-hearth's selfhost/compose.yaml runs it: non-root, read-only, no capabilities, a named cache volume.
  start("docker", [
    "run",
    "--rm",
    "--name",
    name,
    "--platform",
    hearthPlatform,
    "--publish",
    `127.0.0.1:${hearthPort}:${HEARTH_CONTAINER_PORT}`,
    "--env-file",
    secretsFile,
    ...Object.entries(environment).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
    "--user",
    "65532:65532",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:size=256m,mode=1777",
    "--tmpfs",
    "/home/nonroot:size=64m,mode=0700,uid=65532,gid=65532",
    "--volume",
    "den-dev-hearth-cache:/cache",
    hearthImage,
  ]);
  hearth = {
    origin: `http://127.0.0.1:${hearthPort}`,
    edgeSecret: secrets.REMUX_EDGE_SECRET,
  };
  // Under emulation on Apple Silicon the image takes a while to start.
  await healthy(`${hearth.origin}/health`, 120, "Local Hearth");
}

/**
 * Whether this Edge already holds a library: a file in the store's `lib` namespace other than the shared v3 index
 * (`src/library/v3.rs`).
 */
function hasLibrary() {
  try {
    return readdirSync(join(dataDir, "lib")).some(
      (name) => !name.startsWith("library-v3-index"),
    );
  } catch {
    return false;
  }
}

let edge;
function startEdge(newLibraries) {
  edge = start(edgeBinary, [], {
    env: localEdgeEnvironment(process.env, edgePort, dataDir, {
      newLibraries,
      hearth,
    }),
  });
}

if (localEdge) {
  // Guest invites and the member-authenticated Den configure flow need a household to be a real gate (`members`,
  // src/grants.rs), and in that mode nobody can start the first library. So an Edge with no library runs `open`
  // until this browser has created one, then restarts as `members`. An explicit NEW_LIBRARIES is kept as given.
  const explicit = process.env.NEW_LIBRARIES;
  const mode = explicit ?? (hasLibrary() ? "members" : "open");
  console.log(
    `Starting local Edge on http://127.0.0.1:${edgePort} (NEW_LIBRARIES=${mode})…`,
  );
  startEdge(mode);
  await healthy(`http://127.0.0.1:${edgePort}/health`, 30, "Local Edge");
  if (explicit === undefined && mode === "open") {
    console.log(
      "No library yet: create one in the browser. Edge then restarts in members mode, which guest invites need.",
    );
    const watch = setInterval(async () => {
      if (stopping || !hasLibrary()) return;
      clearInterval(watch);
      console.log("Library created; restarting local Edge in members mode…");
      const previous = edge;
      previous.replaced = true;
      signal(previous);
      if (previous.exitCode === null && previous.signalCode === null)
        await once(previous, "exit");
      startEdge("members");
    }, 2000);
  }
}

console.log(`Starting Den Web on http://localhost:${webPort}…`);
console.log(
  withHearth
    ? "Local mode: your own Edge library and a local Hearth. Configure TorBox at http://localhost:" +
        `${webPort}/den/configure and install the addon it gives you.`
    : localEdge
      ? "Local mode: your own Edge library; Atlas comes from the public stack. Add --hearth for streams and playback."
      : "Guest mode uses d.oxy.fi: redeem a guest invite to exercise centralized Atlas, Hearth, and authorized Remux with your own TorBox configuration.",
);
start(
  "npm",
  [
    "run",
    "dev",
    "--",
    "--host",
    "localhost",
    "--port",
    webPort,
    "--strictPort",
  ],
  {
    cwd: web,
    env: localEdge
      ? localWebEnvironment(process.env, edgePort, hearth)
      : process.env,
  },
);

await new Promise(() => {});
