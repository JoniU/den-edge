const DEAD_END = "http://127.0.0.1:9";

export function localEdgeEnvironment(environment, edgePort, dataDir) {
  return {
    ...environment,
    BIND_ADDR: "127.0.0.1",
    PORT: edgePort,
    DATA_DIR: dataDir,
    NEW_LIBRARIES: environment.NEW_LIBRARIES ?? "open",
  };
}

export function localWebEnvironment(environment, edgePort) {
  return {
    ...environment,
    DEN_EDGE: `http://127.0.0.1:${edgePort}`,
    DEN_REEL: environment.DEN_REEL ?? DEAD_END,
    DEN_REMUX: environment.DEN_REMUX ?? DEAD_END,
  };
}
