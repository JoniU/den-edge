type Environment = Record<string, string | undefined>;

export interface LocalHearth {
  origin: string;
  edgeSecret: string;
}

export const HEARTH_CONTAINER_PORT: string;

export function newHearthSecrets(random: () => string): Record<string, string>;

export function hearthContainerEnvironment(
  webOrigin: string,
  gateway: string,
): Record<string, string>;

export function localEdgeEnvironment(
  environment: Environment,
  edgePort: string,
  dataDir: string,
  options?: { newLibraries?: string; hearth?: LocalHearth },
): Environment;

export function localWebEnvironment(
  environment: Environment,
  edgePort: string,
  hearth?: LocalHearth,
): Environment;
