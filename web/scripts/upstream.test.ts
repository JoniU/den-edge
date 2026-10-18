import { afterEach, describe, expect, it, vi } from 'vitest';

const HOMELAB = /^http:\/\/192\.168\./;

type Proxy = Record<string, { target: string }>;

async function proxies(config: string): Promise<{ server: Proxy; preview?: Proxy }> {
  vi.resetModules();
  const loaded = (await import(config)).default as {
    server: { proxy: Proxy };
    preview?: { proxy: Proxy };
  };
  return { server: loaded.server.proxy, preview: loaded.preview?.proxy };
}

function targets(proxy: Proxy | undefined): string[] {
  return Object.values(proxy ?? {}).map((entry) => entry.target);
}

afterEach(() => vi.unstubAllEnvs());

// A spec that does not route a request (WebKit's sendBeacon skips Playwright's routing entirely) falls through
// to these proxies. Under e2e that must never be a real service: a fixture's playback outcome was recorded by the
// production den-edge this way.
describe.each(['../vite.config.ts', '../vite.tv.config.ts'])('%s under e2e', (config) => {
  it('proxies to nothing but a loopback address', async () => {
    vi.stubEnv('DEN_E2E', '1');
    vi.stubEnv('DEN_TV_PLATFORM', 'tizen');
    const { server, preview } = await proxies(config);
    const all = [...targets(server), ...targets(preview)];
    expect(all.length).toBeGreaterThan(0);
    for (const target of all) expect(new URL(target).hostname).toBe('127.0.0.1');
  });

  it('refuses a real den-edge named by the environment', async () => {
    vi.stubEnv('DEN_E2E', '1');
    vi.stubEnv('DEN_TV_PLATFORM', 'tizen');
    vi.stubEnv('DEN_EDGE', 'https://d.oxy.fi');
    await expect(proxies(config)).rejects.toThrow(/not loopback/);
  });

  it('still points a developer at the homelab outside e2e', async () => {
    vi.stubEnv('DEN_E2E', '');
    vi.stubEnv('DEN_TV_PLATFORM', 'tizen');
    const { server } = await proxies(config);
    expect(targets(server).some((target) => HOMELAB.test(target))).toBe(true);
  });
});
