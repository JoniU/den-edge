import { describe, expect, it } from 'vitest';
import {
  hearthContainerEnvironment,
  localEdgeEnvironment,
  localWebEnvironment,
  newHearthSecrets,
} from '../../scripts/dev-env.mjs';

const hearth = { origin: 'http://127.0.0.1:8090', edgeSecret: 'generated-edge-secret' };

describe('the local backend launcher environment', () => {
  it('binds Edge to loopback with isolated development state in the mode it was given', () => {
    const environment = localEdgeEnvironment({ BIND_ADDR: '0.0.0.0' }, '18080', '/tmp/dev');
    expect(environment).toMatchObject({
      BIND_ADDR: '127.0.0.1',
      PORT: '18080',
      DATA_DIR: '/tmp/dev',
      NEW_LIBRARIES: 'open',
    });
    expect(
      localEdgeEnvironment({}, '18080', '/tmp/dev', { newLibraries: 'members' }).NEW_LIBRARIES,
    ).toBe('members');
    expect(environment.ADDON_RELAY).toBeUndefined();
  });

  it('wires a local Hearth into Edge with the shared secret, and keeps explicit settings', () => {
    expect(localEdgeEnvironment({}, '18080', '/tmp/dev', { hearth })).toMatchObject({
      ADDON_RELAY: '/den=http://127.0.0.1:8090',
      DEN_PLAYBACK_ENABLED: '1',
      REMUX_EDGE_SECRET: 'generated-edge-secret',
    });
    expect(
      localEdgeEnvironment({ ADDON_RELAY: '/den=http://127.0.0.1:9000' }, '18080', '/tmp/dev', {
        hearth,
      }).ADDON_RELAY,
    ).toBe('/den=http://127.0.0.1:9000');
  });

  it('sends media to the local Hearth, keeps explicit services, and closes unspecified ones', () => {
    expect(localWebEnvironment({}, '18080', hearth)).toMatchObject({
      DEN_EDGE: 'http://127.0.0.1:18080',
      DEN_REEL: 'http://127.0.0.1:8090/reel',
      DEN_REMUX: 'http://127.0.0.1:8090',
    });
    expect(
      localWebEnvironment(
        { DEN_REEL: 'http://127.0.0.1:8092', DEN_REMUX: 'http://127.0.0.1:8095' },
        '18080',
      ),
    ).toMatchObject({ DEN_REEL: 'http://127.0.0.1:8092', DEN_REMUX: 'http://127.0.0.1:8095' });
    expect(localWebEnvironment({}, '18080')).toMatchObject({
      DEN_REEL: 'http://127.0.0.1:9',
      DEN_REMUX: 'http://127.0.0.1:9',
    });
  });

  it("starts Hearth on the dev server's origin, trusting Edge only from the bridge gateway", () => {
    expect(hearthContainerEnvironment('http://localhost:5173', '172.17.0.1')).toMatchObject({
      HEARTH_PUBLIC_BASE_URL: 'http://localhost:5173',
      REMUX_PUBLIC_SESSION_PROXY: '172.17.0.1',
      REMUX_SCOUT_ORIGINS: 'http://localhost:5173',
      REMUX_ORIGIN_ALIASES: 'http://localhost:5173=http://127.0.0.1:8090',
    });
  });

  it('generates a distinct value per Hearth secret and shares only the Scout–Remux key', () => {
    let n = 0;
    const secrets = newHearthSecrets(() => `secret-${n++}`);
    expect(secrets.REMUX_SCOUT_KEY).toBe(secrets.SCOUT_REMUX_KEY);
    const { REMUX_SCOUT_KEY: _shared, ...own } = secrets;
    expect(new Set(Object.values(own)).size).toBe(Object.keys(own).length);
    expect(Object.keys(secrets)).toContain('REMUX_EDGE_SECRET');
  });
});
