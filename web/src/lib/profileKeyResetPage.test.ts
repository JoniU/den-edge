import { describe, expect, it, vi } from 'vitest';
import fixture from '../vendor/den-core/profiles-v1.json';
import { validateStoredProfileDirectory, type ProfileDirectoryDocument } from './profileDirectory';
import { FakeEdge, Killed } from './profileKeyResetFakeEdge';
import {
  CompoundResetPage,
  type CompoundResetPageDeps,
  type ResetWorkerModel,
} from './profileKeyResetPage';
import {
  ProfileKeyResetService,
  ProfileResetUnauthorizedError,
  VaultResetAdoption,
} from './profileKeyResetService';
import type { LibraryLog } from './log';
import type { PendingReset } from './links.svelte';
import type { ProfileKidCreateVault } from './profileKidCreateWorker';

const OWNER = '00112233445566778899aabbccddeeff';
const MINA = '11112222333344445555666677778888';
const LEO = '9999aaaabbbbccccddddeeeeffff0000';
const JOURNAL = 'profile-reset/v1/journal';
const keyOf = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
const HOUSEHOLD_KEY = keyOf(4);
const SUCCESSORS = { H2: keyOf(80), OWNER2: keyOf(81), MINA2: keyOf(82), LEO2: keyOf(83) };
const DEVICE = '0123456789abcdef';

class MemoryVault implements ProfileKidCreateVault {
  readonly values = new Map<string, unknown>();
  readonly bindings = new Map<string, string>();
  constructor(readonly libraryId = '1'.repeat(32)) {}
  async keepRequired(name: string, value: unknown, binding = '') {
    this.values.set(name, structuredClone(value));
    this.bindings.set(name, binding);
  }
  async keptRequired<T>(name: string, binding = '') {
    if (!this.values.has(name)) return { kind: 'absent' as const };
    if (this.bindings.get(name) !== binding) throw new Error('sealed value binding changed');
    return { kind: 'value' as const, value: structuredClone(this.values.get(name)) as T };
  }
  async discardKept(name: string) {
    this.values.delete(name);
    this.bindings.delete(name);
  }
}

interface Destination {
  readonly session: string;
}

/** Everything the page and the worker keep durably, and the events that happened to it. */
class World {
  readonly vault = new MemoryVault();
  readonly events: string[] = [];
  pending: PendingReset | null = null;
  readonly markers: PendingReset[] = [];
  link: string | null = HOUSEHOLD_KEY;
  current: string | null = HOUSEHOLD_KEY;
  live: string | null = null;
  released = false;
  /** Called with an event name; throw to kill the page at that point. */
  die: (event: string) => void = () => {};
  /** The destination cannot be read yet. */
  destinationUnreadable = false;
  /** What the legacy standing check answers when no journal is left. */
  settled = 'undone';
  onDefinitiveRefusal: (() => void) | undefined;
  onPrepare: (() => void) | undefined;
  onResume: (() => void) | undefined;
  releaseGate: Promise<void> | undefined;
  constructor(
    readonly edge: FakeEdge,
    readonly gate = true,
  ) {}

  service() {
    let next = 80;
    return new ProfileKeyResetService({
      vault: this.vault,
      householdKey: HOUSEHOLD_KEY,
      device: 'device',
      open: (key, wire) => this.edge.open(key, wire),
      adoption: new VaultResetAdoption(
        {
          libraryId: this.vault.libraryId,
          keepRequired: this.vault.keepRequired.bind(this.vault),
          keptRequired: this.vault.keptRequired.bind(this.vault),
          rekeyKept: async () => {},
        } as unknown as Pick<
          LibraryLog,
          'libraryId' | 'rekeyKept' | 'keepRequired' | 'keptRequired'
        >,
        async () => ({}) as LibraryLog,
      ),
      gate: async () => this.gate,
      ownerPin: async (pin) => pin === '1234',
      options: {
        randomKey: () => new Uint8Array(32).fill(next++),
        randomAttempt: () => '0123456789abcdef0123456789abcdef',
        now: () => 1_800_000_100_000,
      },
    });
  }

  model(): ResetWorkerModel {
    const service = this.service();
    const wrap = async (kind: string, outcome: Promise<string>) => ({
      result: { kind, outcome: await outcome },
    });
    return {
      prepareKeyReset: async () => {
        this.onPrepare?.();
        return {
          result: {
            kind: 'key-reset.prepare',
            destinationLibraryKey: SUCCESSORS.H2,
            device: DEVICE,
          },
        };
      },
      startProfileKeyReset: (pin, to) => {
        this.events.push('worker:start');
        return wrap(
          'profile-key-reset.start',
          service.start({ pin, destinationLibraryKey: to }).then((outcome) => {
            this.die('after-start-lands');
            return outcome;
          }),
        );
      },
      resumeProfileKeyReset: () => {
        this.events.push('worker:resume');
        return wrap(
          'profile-key-reset.resume',
          service.resume().then((outcome) => {
            this.onResume?.();
            return outcome;
          }),
        );
      },
      confirmProfileKeyReset: (to) => {
        this.events.push('worker:confirm');
        this.die('before-confirm-lands');
        return wrap(
          'profile-key-reset.confirm',
          service.confirm({ destinationLibraryKey: to }).then((outcome) => {
            this.die('after-confirm-lands');
            return outcome;
          }),
        );
      },
      settleLibraryKey: async () => ({
        result: { kind: 'key-reset.settle', outcome: this.settled },
      }),
    };
  }

  page() {
    const deps: CompoundResetPageDeps<Destination> = {
      pending: {
        read: () => this.pending,
        write: (pending) => {
          this.events.push(pending ? 'marker:write' : 'marker:clear');
          if (pending) this.markers.push(structuredClone(pending));
          this.pending = pending ? structuredClone(pending) : null;
          return true;
        },
      },
      worker: async () => ({ model: this.model(), close: () => {} }),
      openDestination: async (key) => {
        this.events.push('destination:open');
        if (this.destinationUnreadable) throw new Error('the destination does not read yet');
        return { session: key, close: () => this.events.push('destination:close') };
      },
      link: () => (this.link === null ? null : { libraryKey: this.link }),
      install: (_from, to) => {
        this.events.push('install');
        this.link = to;
        this.die('after-install');
        return true;
      },
      release: async (pending) => {
        this.events.push('release');
        this.die('before-release');
        await this.releaseGate;
        if (JSON.stringify(this.pending) !== JSON.stringify(pending)) return false;
        this.released = true;
        this.pending = null;
        return true;
      },
      adopt: (destination) => {
        this.events.push('adopt');
        this.live = destination.session;
        this.current = destination.session;
        return true;
      },
      current: () => this.current,
      active: (from) => this.current === from,
      definitiveStartRefusal: (error) => {
        const definitive = error instanceof ProfileResetUnauthorizedError;
        if (definitive) this.onDefinitiveRefusal?.();
        return definitive;
      },
    };
    return new CompoundResetPage<Destination>(deps);
  }
}

async function edgeWorld() {
  const edge = new FakeEdge();
  const dir: ProfileDirectoryDocument = validateStoredProfileDirectory(
    structuredClone(fixture.migrationBase),
  );
  await edge.add('H', HOUSEHOLD_KEY, 5, ['library'], dir);
  for (const [label, id] of [
    ['OWNER', OWNER],
    ['MINA', MINA],
    ['LEO', LEO],
  ] as const)
    await edge.add(label, dir.profiles[id]!.library.value.key, 4, ['watch']);
  for (const [label, key] of Object.entries(SUCCESSORS)) await edge.plan(label, key);
  return edge;
}

const killAt = (world: World, name: string) => {
  world.die = (event) => {
    if (event === name) {
      world.die = () => {};
      throw new Killed();
    }
  };
};

describe('the page half of a compound key reset', () => {
  it('keeps the marker first, installs after the destination reads, and erases the journal last', async () => {
    const world = new World(await edgeWorld());
    const result = await world.page().start(HOUSEHOLD_KEY, '1234');

    expect(result).toBe('complete');
    const order = world.events;
    const at = (event: string) => order.indexOf(event);
    expect(at('marker:write')).toBeLessThan(at('worker:start'));
    expect(at('destination:open')).toBeLessThan(at('install'));
    expect(at('install')).toBeLessThan(at('worker:confirm'));
    expect(at('worker:confirm')).toBeLessThan(at('release'));
    expect(at('release')).toBeLessThan(at('adopt'));
    expect(world.link).toBe(SUCCESSORS.H2);
    expect(world.live).toBe(SUCCESSORS.H2);
    expect(world.pending).toBeNull();
    expect(world.vault.values.has(JOURNAL)).toBe(false);
  });

  it('stamps the marker as a compound reset of this household', async () => {
    const world = new World(await edgeWorld());
    await world.page().start(HOUSEHOLD_KEY, '1234');
    // The marker that was kept names the reset, so a reload settles it here and not with the legacy check.
    expect(world.markers[0]).toEqual({
      from: HOUSEHOLD_KEY,
      to: SUCCESSORS.H2,
      device: DEVICE,
      compound: true,
    });
  });

  it('clears only its exact marker after a definitive wrong PIN', async () => {
    const world = new World(await edgeWorld());
    await expect(world.page().start(HOUSEHOLD_KEY, '0000')).rejects.toBeInstanceOf(
      ProfileResetUnauthorizedError,
    );
    expect(world.pending).toBeNull();

    const replacement = { from: HOUSEHOLD_KEY, to: keyOf(99), device: 'other', compound: true };
    world.onDefinitiveRefusal = () => (world.pending = replacement);
    await expect(world.page().start(HOUSEHOLD_KEY, '0000')).rejects.toBeInstanceOf(
      ProfileResetUnauthorizedError,
    );
    expect(world.pending).toEqual(replacement);
  });

  it('keeps an ambiguous landed start actionable for reload recovery', async () => {
    const world = new World(await edgeWorld());
    killAt(world, 'after-start-lands');
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).rejects.toBeInstanceOf(Killed);
    expect(world.pending).toMatchObject({ from: HOUSEHOLD_KEY, compound: true });
    await expect(world.page().run(world.pending!)).resolves.toBe('complete');
  });

  it('continues one existing marker instead of preparing a superseding start', async () => {
    const world = new World(await edgeWorld());
    world.destinationUnreadable = true;
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
    expect(world.markers).toHaveLength(1);
    world.destinationUnreadable = false;
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('complete');
    expect(world.markers).toHaveLength(1);
  });

  it('never installs or adopts across a replacement household', async () => {
    const world = new World(await edgeWorld());
    world.destinationUnreadable = true;
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
    world.destinationUnreadable = false;
    world.current = keyOf(22);
    const before = world.events.length;
    await expect(world.page().run(world.pending!)).resolves.toBe('waiting');
    expect(world.events.slice(before)).not.toContain('install');
    expect(world.events.slice(before)).not.toContain('adopt');
    world.current = HOUSEHOLD_KEY;
    await expect(world.page().run(world.pending!)).resolves.toBe('complete');
  });

  it('does not publish a marker or start after household replacement during preparation', async () => {
    const world = new World(await edgeWorld());
    world.onPrepare = () => {
      world.current = keyOf(22);
    };
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('unavailable');
    expect(world.pending).toBeNull();
    expect(world.events).not.toContain('worker:start');
  });

  it('does not adopt over a household replacement while exact-marker release is pending', async () => {
    const world = new World(await edgeWorld());
    world.destinationUnreadable = true;
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
    world.destinationUnreadable = false;
    let release = () => {};
    world.releaseGate = new Promise<void>((resolve) => (release = resolve));
    const settling = world.page().run(world.pending!);
    await vi.waitFor(() => expect(world.events.at(-1)).toBe('release'));
    world.current = keyOf(22);
    release();
    await expect(settling).resolves.toBe('waiting');
    expect(world.live).toBeNull();
    expect(world.events.at(-1)).toBe('destination:close');
  });

  it('never installs or clears a different marker published while resume is pending', async () => {
    const world = new World(await edgeWorld());
    world.destinationUnreadable = true;
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
    world.destinationUnreadable = false;
    const replacement = { from: HOUSEHOLD_KEY, to: keyOf(99), device: 'other', compound: true };
    world.onResume = () => {
      world.pending = replacement;
      world.onResume = undefined;
    };
    const before = world.events.length;
    await expect(world.page().run(world.markers[0]!)).resolves.toBe('waiting');
    expect(world.events.slice(before)).not.toContain('install');
    expect(world.events.slice(before)).not.toContain('release');
    expect(world.events.slice(before)).not.toContain('adopt');
    expect(world.pending).toEqual(replacement);
  });

  it('closed gate: nothing starts and no marker is left', async () => {
    const world = new World(await edgeWorld(), false);
    await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('unavailable');
    expect(world.pending).toBeNull();
    expect(world.link).toBe(HOUSEHOLD_KEY);
    expect(world.edge.log).toEqual([]);
  });

  describe('a death between any two steps converges to the same end', () => {
    const ends = (world: World) => {
      expect(world.link).toBe(SUCCESSORS.H2);
      expect(world.live).toBe(SUCCESSORS.H2);
      expect(world.pending).toBeNull();
      expect(world.vault.values.has(JOURNAL)).toBe(false);
      expect(world.released).toBe(true);
    };

    it.each([
      ['after-install'],
      ['before-confirm-lands'],
      ['after-confirm-lands'],
      ['before-release'],
    ])('at %s', async (event) => {
      const world = new World(await edgeWorld());
      killAt(world, event);
      const page = world.page();
      await expect(page.start(HOUSEHOLD_KEY, '1234')).rejects.toBeInstanceOf(Killed);
      // Whatever it left, the reset is not lost: the marker names it, and the journal is erased only after install.
      expect(world.pending).not.toBeNull();
      if (event === 'after-install' || event === 'before-confirm-lands')
        expect(world.vault.values.has(JOURNAL)).toBe(true);

      // A reload: a fresh page over the same durable state, driven by the marker alone.
      const reloaded = world.page();
      await expect(reloaded.run(world.pending!)).resolves.toBe('complete');
      ends(world);
    });

    it('before the install: the journal stands and the next run installs it', async () => {
      const world = new World(await edgeWorld());
      world.destinationUnreadable = true;
      await expect(world.page().start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
      expect(world.link).toBe(HOUSEHOLD_KEY);
      expect(world.vault.values.has(JOURNAL)).toBe(true);
      expect(world.events).not.toContain('install');

      world.destinationUnreadable = false;
      await expect(world.page().run(world.pending!)).resolves.toBe('complete');
      ends(world);
    });

    it('a second run while one is in flight does not install twice', async () => {
      const world = new World(await edgeWorld());
      await world
        .page()
        .start(HOUSEHOLD_KEY, '1234')
        .catch(() => undefined);
      expect(world.events.filter((event) => event === 'install')).toHaveLength(1);
    });
  });

  it('never erases the journal when the install does not read back', async () => {
    const world = new World(await edgeWorld());
    const page = world.page();
    // The tab's in-memory overlay moves, but storage refused it. That must not be mistaken for a durable readback.
    const original = world.link;
    let visible = original;
    const failing = new CompoundResetPage<Destination>({
      pending: {
        read: () => world.pending,
        write: (pending) => {
          world.pending = pending;
          return true;
        },
      },
      worker: async () => ({ model: world.model(), close: () => {} }),
      openDestination: async (key) => ({ session: key, close: () => {} }),
      link: () => ({ libraryKey: visible! }),
      current: () => HOUSEHOLD_KEY,
      active: () => true,
      install: (_from, to) => {
        visible = to;
        return false;
      },
      release: () => {
        world.events.push('release');
        return true;
      },
      adopt: () => true,
    });
    void page;
    await expect(failing.start(HOUSEHOLD_KEY, '1234')).resolves.toBe('waiting');
    expect(world.vault.values.has(JOURNAL)).toBe(true);
    expect(world.events).not.toContain('worker:confirm');
    expect(world.events).not.toContain('release');
    expect(world.pending).not.toBeNull();
  });

  it('no journal and the old library still stands: the marker is dropped, nothing is installed', async () => {
    const world = new World(await edgeWorld());
    world.pending = { from: HOUSEHOLD_KEY, to: SUCCESSORS.H2, device: DEVICE, compound: true };
    world.settled = 'undone';
    await expect(world.page().run(world.pending)).resolves.toBe('aborted');
    expect(world.pending).toBeNull();
    expect(world.link).toBe(HOUSEHOLD_KEY);
    expect(world.events).not.toContain('install');
  });

  it('no journal and the old library was retired without naming a successor: it can only be this reset', async () => {
    const world = new World(await edgeWorld());
    world.pending = { from: HOUSEHOLD_KEY, to: SUCCESSORS.H2, device: DEVICE, compound: true };
    world.settled = 'held';
    await expect(world.page().run(world.pending)).resolves.toBe('complete');
    expect(world.link).toBe(SUCCESSORS.H2);
    expect(world.pending).toBeNull();
    // There is no journal to confirm.
    expect(world.events).not.toContain('worker:confirm');
  });

  it('an unproven standing is waited on, never guessed', async () => {
    const world = new World(await edgeWorld());
    world.pending = { from: HOUSEHOLD_KEY, to: SUCCESSORS.H2, device: DEVICE, compound: true };
    world.settled = 'unknown';
    await expect(world.page().run(world.pending)).resolves.toBe('waiting');
    expect(world.pending).not.toBeNull();
    expect(world.link).toBe(HOUSEHOLD_KEY);
  });

  it('a rolled back reset ends with the marker dropped and the old key kept', async () => {
    const edge = await edgeWorld();
    const world = new World(edge);
    edge.faults.push({ on: 'OWNER2 takeMoved', when: 'before' });
    await world
      .page()
      .start(HOUSEHOLD_KEY, '1234')
      .catch(() => undefined);
    edge.revive();
    // Another device recovers the open reset by aborting it.
    const other = new World(edge);
    const recovery = other.service();
    await expect(
      recovery.recover({
        pin: '1234',
        recoveryAttempt: 'fedcba9876543210fedcba9876543210',
        successorKey: null,
      }),
    ).resolves.toBe('aborted');

    await expect(world.page().run(world.pending!)).resolves.toBe('aborted');
    expect(world.pending).toBeNull();
    expect(world.link).toBe(HOUSEHOLD_KEY);
    expect(world.vault.values.has(JOURNAL)).toBe(false);
  });
});
