import { describe, expect, it, vi } from 'vitest';
import {
  bingeGroupFor,
  BoundedLookup,
  continuationPrefetch,
  reportNextDetailFailure,
  reportNextPrefetch,
  shouldWarmNext,
  WARM_LEAD_SECS,
} from './binge';

describe('binge diagnostics', () => {
  it('reports a closed prefetch outcome without episode coordinates', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    reportNextPrefetch('ready');

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith('[Den binge] {"event":"next-prefetch","outcome":"ready"}');
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/season|episode|7349281|6193472/);
    info.mockRestore();
  });

  it('classifies a next-detail failure without forwarding its free text', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const freeText = 'S7349281E6193472 failed\nprovider body: private sentinel';

    reportNextDetailFailure(new Error(freeText));
    reportNextDetailFailure(freeText);

    expect(warn.mock.calls).toEqual([
      ['[Den binge] {"event":"next-detail","outcome":"failed","errorClass":"error"}'],
      ['[Den binge] {"event":"next-detail","outcome":"failed","errorClass":"other"}'],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(freeText);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /7349281|6193472|provider body|private sentinel/,
    );
    warn.mockRestore();
  });
});

describe('shouldWarmNext', () => {
  /**
   * Late, not at the halfway mark the TV uses. den-scout keeps a stream list for five minutes, so a warm
   * twenty minutes out would have expired long before the advance that was meant to use it.
   */
  it('warms only inside the lead before the end', () => {
    const episode = 40 * 60;
    expect(shouldWarmNext(episode / 2, episode)).toBe(false);
    expect(shouldWarmNext(episode - WARM_LEAD_SECS - 1, episode)).toBe(false);
    expect(shouldWarmNext(episode - WARM_LEAD_SECS, episode)).toBe(true);
    expect(shouldWarmNext(episode - 5, episode)).toBe(true);
  });

  /** The end itself is not a warm: playback has finished and the advance is already running. */
  it('does not warm at or past the end', () => {
    expect(shouldWarmNext(2400, 2400)).toBe(false);
    expect(shouldWarmNext(2500, 2400)).toBe(false);
  });

  /** A duration the player does not know yet, which is every frame before `loadedmetadata`. */
  it('says no until the length is known', () => {
    expect(shouldWarmNext(100, 0)).toBe(false);
    expect(shouldWarmNext(100, Number.NaN)).toBe(false);
    expect(shouldWarmNext(Number.NaN, 2400)).toBe(false);
    expect(shouldWarmNext(Number.POSITIVE_INFINITY, 2400)).toBe(false);
    expect(shouldWarmNext(-1, 2400)).toBe(false);
  });

  /** A short episode is all lead, and warming it from the start is right rather than a bug. */
  it('warms a whole episode shorter than the lead', () => {
    expect(shouldWarmNext(1, 120)).toBe(true);
  });
});

describe('continuationPrefetch', () => {
  const sources = [
    {
      filename: 'jordskott.s01e10.1080p.bluray.x264-skgtv.mkv',
      bingeGroup: 'den-scout|1080p|bluray||skgtv',
      cached: false,
      url: '/pack',
    },
    {
      filename: 'Jordskott.S01E10.other.mkv',
      bingeGroup: 'den-scout|720p|webdl||other',
      cached: true,
      url: '/other',
    },
  ];

  it('keeps the exact season pack across differing episode filenames, even when it needs fetching', () => {
    // The production E9 and E10 files differ; bingeGroup, derived from their common infohash, is the continuity.
    const playing = {
      filename: 'jordskott.s01e09.1080p.bluray.x264-skgtv.mkv',
      bingeGroup: 'den-scout|1080p|bluray||skgtv',
    };
    expect(continuationPrefetch(sources, playing.bingeGroup, 1, 1)).toBe(sources[0]);
  });

  it('carries a manual switch into natural advance by group, never by its episode filename', () => {
    const current = [
      { filename: 'e09-default.mkv', bingeGroup: 'default' },
      { filename: 'e09-manual.mkv', bingeGroup: 'manual-pack' },
    ];
    const next = [
      { filename: 'e10-default.mkv', bingeGroup: 'default' },
      { filename: 'e10-manual.mkv', bingeGroup: 'manual-pack' },
    ];
    const remembered = bingeGroupFor(current, 'e09-manual.mkv');
    expect(remembered).toBe('manual-pack');
    expect(continuationPrefetch(next, remembered, 1, 1)?.filename).toBe('e10-manual.mkv');
    expect(bingeGroupFor(current, 'missing.mkv')).toBeUndefined();
  });

  it('does not choose an arbitrary fallback when continuity is absent', () => {
    expect(continuationPrefetch(sources, 'den-scout|1080p|webdl||missing', 1, 1)).toBeUndefined();
    expect(continuationPrefetch(sources, undefined, 1, 1)).toBeUndefined();
  });

  it('is independent of list order and ignores duplicate filenames before selection', () => {
    const reordered = [sources[1]!, sources[0]!];
    expect(continuationPrefetch(reordered, sources[0]!.bingeGroup, 1, 1)).toBe(sources[0]);
    // Production parsing removes a repeated filename before this decision; a duplicate group with a different
    // filename is still the same asserted pack, and the ranked list's first representative is the one requested.
    expect(
      continuationPrefetch(
        [{ ...sources[0]!, filename: 'duplicate.mkv' }, ...reordered],
        sources[0]!.bingeGroup,
        1,
        1,
      )?.filename,
    ).toBe('duplicate.mkv');
  });

  it('does not carry a release across a season boundary unattended', () => {
    expect(continuationPrefetch(sources, sources[0]!.bingeGroup, 1, 2)).toBeUndefined();
  });
});

describe('BoundedLookup', () => {
  it('shares a successful warm with foreground and bounds retained coordinates', async () => {
    const cache = new BoundedLookup<{ sources: string[] | null }>(2, (answer) => !!answer.sources);
    let calls = 0;
    const load = async () => ({ sources: [String(++calls)] });
    const warm = cache.get('1:1', load);
    expect(cache.get('1:1', load)).toBe(warm);
    await expect(warm).resolves.toEqual({ sources: ['1'] });
    await cache.get('1:2', load);
    await cache.get('1:3', load);
    await cache.get('1:1', load);
    expect(calls).toBe(4);
  });

  it('does not let a failed warm suppress the foreground retry', async () => {
    const cache = new BoundedLookup<{ sources: string[] | null }>(2, (answer) => !!answer.sources);
    let calls = 0;
    await expect(
      cache.get('1:2', async () => ({ sources: ++calls === 1 ? null : ['pack'] })),
    ).resolves.toEqual({ sources: null });
    await expect(
      cache.get('1:2', async () => ({ sources: ++calls === 1 ? null : ['pack'] })),
    ).resolves.toEqual({ sources: ['pack'] });
    expect(calls).toBe(2);
  });

  it('evicts a rejected warm too', async () => {
    const cache = new BoundedLookup<string>(2, () => true);
    await expect(
      cache.get('1:2', async () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow('offline');
    await expect(cache.get('1:2', async () => 'foreground')).resolves.toBe('foreground');
  });
});
