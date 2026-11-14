import { describe, expect, it } from 'vitest';
import { localEdgeEnvironment, localWebEnvironment } from '../../scripts/dev-env.mjs';

describe('the local backend launcher environment', () => {
  it('binds Edge to loopback with isolated development state and an open bootstrap default', () => {
    const environment = localEdgeEnvironment({ BIND_ADDR: '0.0.0.0' }, '18080', '/tmp/dev');
    expect(environment).toMatchObject({
      BIND_ADDR: '127.0.0.1',
      PORT: '18080',
      DATA_DIR: '/tmp/dev',
      NEW_LIBRARIES: 'open',
    });
  });

  it('preserves members mode and the Edge-to-Remux secret for local Hearth integration', () => {
    expect(
      localEdgeEnvironment(
        { NEW_LIBRARIES: 'members', REMUX_EDGE_SECRET: 'local-development-secret' },
        '18080',
        '/tmp/dev',
      ),
    ).toMatchObject({
      NEW_LIBRARIES: 'members',
      REMUX_EDGE_SECRET: 'local-development-secret',
    });
  });

  it('keeps explicit standalone media services and closes unspecified ones', () => {
    expect(
      localWebEnvironment(
        { DEN_REEL: 'http://127.0.0.1:8092', DEN_REMUX: 'http://127.0.0.1:8095' },
        '18080',
      ),
    ).toMatchObject({
      DEN_EDGE: 'http://127.0.0.1:18080',
      DEN_REEL: 'http://127.0.0.1:8092',
      DEN_REMUX: 'http://127.0.0.1:8095',
    });
    expect(localWebEnvironment({}, '18080')).toMatchObject({
      DEN_REEL: 'http://127.0.0.1:9',
      DEN_REMUX: 'http://127.0.0.1:9',
    });
  });
});
