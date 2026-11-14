export function localEdgeEnvironment(
  environment: Record<string, string | undefined>,
  edgePort: string,
  dataDir: string,
): Record<string, string | undefined>;

export function localWebEnvironment(
  environment: Record<string, string | undefined>,
  edgePort: string,
): Record<string, string | undefined>;
