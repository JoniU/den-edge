export interface IconicStudio {
  id: string;
  name: string;
}

const MAX_ICONIC_STUDIOS = 128;
const MAX_STUDIO_NAME = 512;
const MAX_STUDIO_ID = 64;

/** Atlas's curated studios for one title. Missing/old indexes quietly leave the TMDB company text in place. */
export function parseIconicStudios(body: unknown): IconicStudio[] {
  if (!body || typeof body !== 'object') return [];
  const studios = (body as { studios?: unknown }).studios;
  if (!Array.isArray(studios)) return [];
  const seen = new Set<string>();
  return studios
    .flatMap((value): IconicStudio[] => {
      if (!value || typeof value !== 'object') return [];
      const { id, name } = value as { id?: unknown; name?: unknown };
      if (
        typeof id !== 'string' ||
        id.length > MAX_STUDIO_ID ||
        !/^Q[1-9]\d*$/.test(id) ||
        typeof name !== 'string'
      )
        return [];
      const clean = name.trim();
      if (!clean || clean.length > MAX_STUDIO_NAME || seen.has(id)) return [];
      seen.add(id);
      return [{ id, name: clean }];
    })
    .slice(0, MAX_ICONIC_STUDIOS);
}
