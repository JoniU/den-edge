const DEAD_END = "http://127.0.0.1:9";

/** The address Hearth listens on inside its container (selfhost/compose.yaml in den-hearth). */
export const HEARTH_CONTAINER_PORT = "8090";

/**
 * The secrets a local Hearth is started with, generated once and kept in `.dev/hearth.env` so installs made against
 * it keep opening. `REMUX_SCOUT_KEY` is `SCOUT_REMUX_KEY`: Scout lists a scoped install only for the key Remux
 * presents. `REMUX_EDGE_SECRET` is shared with the local Edge.
 */
export function newHearthSecrets(random) {
  const secrets = {};
  for (const name of [
    "SCOUT_CONFIG_KEY",
    "SCOUT_REMUX_KEY",
    "REEL_CONFIG_KEY",
    "SUBS_CONFIG_KEY",
    "REEL_PLAY_SECRET",
    "REMUX_URL_KEY",
    "REMUX_EDGE_SECRET",
  ]) {
    secrets[name] = random();
  }
  secrets.REMUX_SCOUT_KEY = secrets.SCOUT_REMUX_KEY;
  return secrets;
}

/**
 * Hearth's settings beside its secrets. The public base is the dev server's own origin, so the install URLs Hearth's
 * configure page writes, and its media URLs, stay on the origin the browser uses and reach Hearth through Vite and the
 * local Edge. `gateway` is the address the host's connections arrive from inside the container: the one peer Remux
 * lets mark Edge's playback calls as trusted.
 */
export function hearthContainerEnvironment(webOrigin, gateway) {
  return {
    PORT: HEARTH_CONTAINER_PORT,
    HEARTH_SERVICES: "all",
    HEARTH_SCOUT_PORT: "0",
    HEARTH_REEL_PORT: "0",
    HEARTH_SUBS_PORT: "0",
    HEARTH_REMUX_PORT: "0",
    HEARTH_PUBLIC_BASE_URL: webOrigin,
    REMUX_PUBLIC_SESSION_PROXY: gateway,
    // A Hearth that trusts its own public base (den-hearth#230) needs neither; an older image needs both to play the
    // installs it wrote, the alias keeping Remux's fetch inside the container.
    REMUX_SCOUT_ORIGINS: webOrigin,
    REMUX_ORIGIN_ALIASES: `${webOrigin}=http://127.0.0.1:${HEARTH_CONTAINER_PORT}`,
    LOG_REQUESTS: "1",
  };
}

/**
 * The local Edge's environment. `newLibraries` is the resolved `NEW_LIBRARIES` mode. With `hearth`
 * (`{ origin, edgeSecret }`), Edge relays `/den` to it and offers its playback; an explicit variable still wins.
 */
export function localEdgeEnvironment(
  environment,
  edgePort,
  dataDir,
  { newLibraries = "open", hearth } = {},
) {
  return {
    ...environment,
    BIND_ADDR: "127.0.0.1",
    PORT: edgePort,
    DATA_DIR: dataDir,
    NEW_LIBRARIES: newLibraries,
    ...(hearth
      ? {
          ADDON_RELAY: environment.ADDON_RELAY ?? `/den=${hearth.origin}`,
          DEN_PLAYBACK_ENABLED: environment.DEN_PLAYBACK_ENABLED ?? "1",
          REMUX_EDGE_SECRET: environment.REMUX_EDGE_SECRET ?? hearth.edgeSecret,
        }
      : {}),
  };
}

/**
 * The dev server's environment against a local Edge. Reel and Remux go to the local Hearth when there is one, and
 * otherwise to a closed port rather than to the public stack, whose sessions a local library cannot authorize.
 */
export function localWebEnvironment(environment, edgePort, hearth) {
  return {
    ...environment,
    DEN_EDGE: `http://127.0.0.1:${edgePort}`,
    DEN_REEL:
      environment.DEN_REEL ?? (hearth ? `${hearth.origin}/reel` : DEAD_END),
    DEN_REMUX: environment.DEN_REMUX ?? (hearth ? hearth.origin : DEAD_END),
  };
}
