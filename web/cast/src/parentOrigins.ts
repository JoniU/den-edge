export const DEFAULT_PARENT_ORIGINS = 'https://d.oxy.fi http://localhost:5173';

/** Exact origins allowed to control the isolated Cast sender. Never broaden localhost to a wildcard or port range. */
export function parentOrigins(configured: string = DEFAULT_PARENT_ORIGINS): Set<string> {
  return new Set(
    configured
      .split(/[\s,]+/)
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}
