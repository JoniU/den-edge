#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localEdgeEnvironment, localWebEnvironment } from "./dev-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const args = new Set(process.argv.slice(2));
const allowed = new Set(["--check", "--local-edge", "--no-install"]);
for (const arg of args) {
  if (!allowed.has(arg)) {
    console.error(
      `Unknown option: ${arg}\nUsage: ./scripts/dev.mjs [--check] [--local-edge] [--no-install]`,
    );
    process.exit(2);
  }
}

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

const localEdge = args.has("--local-edge");
for (const command of ["git", "npm", ...(localEdge ? ["cargo"] : [])]) {
  const result = spawnSync(command, ["--version"], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.error?.code === "ENOENT" || result.status !== 0) {
    console.error(`${command} is required but was not found.`);
    process.exit(1);
  }
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

if (args.has("--check")) {
  console.log("Development prerequisites and dependencies are ready.");
  process.exit(0);
}

const edgePort = process.env.DEN_DEV_EDGE_PORT ?? "18080";
const webPort = process.env.DEN_DEV_WEB_PORT ?? "5173";
const dataDir = resolve(root, ".dev", "data");
if (localEdge) mkdirSync(dataDir, { recursive: true });

const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error);
    }
  }
  setTimeout(() => process.exit(code), 1000);
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

function start(command, commandArgs, options) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`${command}: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(
        `${command} exited unexpectedly (${signal ?? code ?? "unknown"}).`,
      );
      stop(code || 1);
    }
  });
  return child;
}

if (localEdge) {
  console.log(`Starting local Edge on http://127.0.0.1:${edgePort}…`);
  start("cargo", ["run", "--locked", "--bin", "den-edge"], {
    env: localEdgeEnvironment(process.env, edgePort, dataDir),
  });

  const health = `http://127.0.0.1:${edgePort}/health`;
  const deadline = Date.now() + 180_000;
  while (!stopping) {
    try {
      const response = await fetch(health, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) break;
    } catch {}
    if (Date.now() >= deadline) {
      console.error(
        `Local Edge did not become healthy within 180 seconds (${health}).`,
      );
      stop(1);
      await new Promise(() => {});
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  if (stopping) await new Promise(() => {});
}

console.log(`Starting Den Web on http://localhost:${webPort}…`);
console.log(
  localEdge
    ? "Backend mode uses local Edge state; configure local service overrides separately when working on integrations."
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
    env: localEdge ? localWebEnvironment(process.env, edgePort) : process.env,
  },
);

await new Promise(() => {});
