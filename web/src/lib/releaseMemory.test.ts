import { describe, expect, it, vi } from 'vitest';
import {
  currentReleaseRecall,
  ScopedReleaseMemory,
  type ReleaseAuthority,
  type ReleaseRecallGeneration,
} from './releaseMemory';

function memoryStore(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (n) => [...items.keys()][n] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

type AuthorityFields = {
  profile: string;
  library: string | null;
  household: string | null;
  addon: string;
  source: string;
};
const authority = (replace: Partial<AuthorityFields> = {}): ReleaseAuthority => {
  const value: AuthorityFields = {
    profile: 'profile:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    library: 'profile-library-a',
    household: 'household-a',
    addon: 'http://scout.test/config-a',
    source: '/scout/config-a',
    ...replace,
  };
  return [value.profile, value.library, value.household, value.addon, value.source];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => (resolve = accept));
  return { promise, resolve };
}

describe('ScopedReleaseMemory', () => {
  it('reads a deliberate group after reload only in its season and exact authority', async () => {
    const storage = memoryStore();
    const first = await ScopedReleaseMemory.open(authority(), storage);
    first.remember('tv:1', { season: 1, group: 'stable-pack-a' });

    expect((await ScopedReleaseMemory.open(authority(), storage)).recall('tv:1', 1)).toEqual({
      season: 1,
      group: 'stable-pack-a',
    });
    expect(first.recall('tv:1', 2)).toBeUndefined();
    for (const changed of [
      { profile: 'profile:b' },
      { library: 'profile-library-b' },
      { household: 'household-b' },
      { addon: 'http://scout.test/config-b' },
      { source: '/den/config-b' },
    ])
      expect(
        (await ScopedReleaseMemory.open(authority(changed), storage)).recall('tv:1', 1),
      ).toBeUndefined();
  });

  it('removes legacy unscoped filename rows without adopting them', async () => {
    const storage = memoryStore({
      'den.releases.tv:1:1:3': JSON.stringify({ chosen: 'raw-name.mkv', left: ['other.mkv'] }),
      unrelated: 'kept',
    });
    const memory = await ScopedReleaseMemory.open(authority(), storage);
    expect(memory.recall('tv:1', 1)).toBeUndefined();
    expect(storage.getItem('den.releases.tv:1:1:3')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('kept');
  });

  it('ignores malformed, oversized and rollback/future rows while keeping the namespace private', async () => {
    const storage = memoryStore();
    const memory = await ScopedReleaseMemory.open(authority(), storage);
    memory.remember('tv:1', { season: 1, group: 'pack-a' });
    const key = [...Array(storage.length).keys()].map((n) => storage.key(n)).find(Boolean)!;
    expect(key).not.toContain('profile-library-a');
    expect(key).not.toContain('scout.test');
    expect(storage.getItem(key)).not.toContain('.mkv');

    storage.setItem(key, JSON.stringify({ version: 2, season: 1, group: 'future' }));
    expect(memory.recall('tv:1', 1)).toBeUndefined();
    storage.setItem(key, JSON.stringify({ version: 1, season: 1, group: 'x'.repeat(513) }));
    expect(memory.recall('tv:1', 1)).toBeUndefined();
    storage.setItem(key, '{');
    expect(memory.recall('tv:1', 1)).toBeUndefined();
  });

  it('forgets a choice and carries on when storage is blocked or full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = memoryStore();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const memory = await ScopedReleaseMemory.open(authority(), storage);
    expect(() => memory.remember('tv:1', { season: 1, group: 'pack-a' })).not.toThrow();
    expect(() => memory.forget('tv:1')).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('currentReleaseRecall', () => {
  const initial: ReleaseRecallGeneration = {
    authority: 'profile/library/household/addon/source-a',
    episode: 0,
    session: 1,
    choice: 0,
  };

  it('does not let delayed recall overwrite a newer explicit filename choice', async () => {
    const recalled = deferred<string | undefined>();
    let generation = initial;
    const answer = currentReleaseRecall(recalled.promise, initial, () => generation);
    let continuityGroup: string | undefined = 'new-manual-pack';
    generation = { ...generation, choice: 1 };
    recalled.resolve('old-retained-pack');
    continuityGroup = (await answer) ?? continuityGroup;
    expect(continuityGroup).toBe('new-manual-pack');
  });

  it('does not restore stale continuity after the newer choice has no group', async () => {
    const recalled = deferred<string | undefined>();
    let generation = initial;
    const answer = currentReleaseRecall(recalled.promise, initial, () => generation);
    generation = { ...generation, choice: 1 };
    recalled.resolve('old-retained-pack');
    expect(await answer).toBeUndefined();
  });

  it('publishes valid initial recall only to its exact session and episode', async () => {
    await expect(
      currentReleaseRecall(Promise.resolve('retained-pack'), initial, () => initial),
    ).resolves.toBe('retained-pack');
    for (const generation of [
      { ...initial, authority: 'profile/library/household/addon/source-b' },
      { ...initial, session: 2 },
      { ...initial, episode: 1 },
      undefined,
    ])
      await expect(
        currentReleaseRecall(Promise.resolve('stale-pack'), initial, () => generation),
      ).resolves.toBeUndefined();
  });
});
