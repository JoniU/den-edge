import { describe, expect, it } from 'vitest';
import { countdownLabel, MAX_HOLD_SECS, PrebufferHold } from './prebufferHold';

describe('PrebufferHold', () => {
  it('holds a start with prebuffer 20 behind a countdown, and lets go once 20 s are buffered', () => {
    const hold = new PrebufferHold(20, 0);
    expect(hold.counts).toBe(true);
    // A second and a half of media a second: it counts down from the wait den-remux worked out, then with the buffer.
    const seen: number[] = [];
    let at = 0;
    for (; at <= 12_000; at += 1_000) {
      const { ready, seconds } = hold.update((at / 1000) * 1.5, at);
      if (ready) break;
      seen.push(seconds!);
    }
    expect(seen[0]).toBe(20);
    expect(
      seen.every((s, i) => i === 0 || s <= seen[i - 1]!),
      `${seen}`,
    ).toBe(true);
    expect(hold.update(19.9, 13_300)).toEqual({ ready: false, seconds: expect.any(Number) });
    expect(hold.update(20, 13_400)).toEqual({ ready: true, seconds: null });
  });

  it('goes back up only when the buffer has really fallen behind', () => {
    const hold = new PrebufferHold(20, 0);
    hold.update(0, 0);
    const before = hold.update(6, 4_000).seconds!;
    // A jitter — a hair slower — does not raise it; filling at a third of the rate does.
    expect(hold.update(7.5, 5_000).seconds).toBeLessThanOrEqual(before);
    expect(hold.update(7.6, 10_000).seconds!).toBeGreaterThan(before);
  });

  it('shows no countdown for a moment’s hold, and never holds past the cap or on a buffer that stopped', () => {
    expect(new PrebufferHold(2, 0).update(0.5, 500)).toEqual({ ready: false, seconds: null });
    const long = new PrebufferHold(90, 0);
    expect(long.target).toBe(MAX_HOLD_SECS);
    expect(long.update(10, MAX_HOLD_SECS * 1000).ready).toBe(true);
    const still = new PrebufferHold(20, 0);
    expect(still.update(8, 3_000).ready).toBe(false);
    expect(still.update(8, 8_100).ready, 'the player buffers no further while held').toBe(true);
  });

  // Half a minute at 1 Mbit/s, then a minute at 15, then 1 again, in 6 s segments, on a link that brings 8 Mbit/s:
  // den-remux answers a 32.1 s wait and a 48 s lead for it (den-hearth's
  // `a_light_opening_holds_for_the_media_a_heavy_scene_later_needs`). The buffer grows a whole segment at a time, as
  // hls.js appends them; each heavy one takes 11.25 s to arrive.
  const segments: [number, number][] = Array.from({ length: 100 }, (_, i) => [
    i * 6,
    i * 6 >= 30 && i * 6 < 90 ? 11_250_000 : 750_000,
  ]);
  const LINK = 8_000_000;

  /** Holds a start as the player does, every 250 ms, then plays: when it started, and the longest it ran dry. */
  function play(hold: PrebufferHold): { startedAt: number; dry: number } {
    let bits = 0;
    const arrived = segments.map(([, bytes]) => (bits += bytes * 8) / LINK);
    for (let t = 0; t < 120; t += 0.25) {
      const inBy = arrived.filter((at) => at <= t).length;
      const ahead = inBy === 0 ? 0 : (segments[inBy]?.[0] ?? 600);
      if (!hold.update(ahead, t * 1000, 0).ready) continue;
      const dry = Math.max(0, ...segments.map(([start], i) => arrived[i]! - (t + start)));
      return { startedAt: t, dry };
    }
    throw new Error('never let go');
  }

  it('holds a light opening for the lead den-remux names, so the heavy scene after it plays through', () => {
    const { startedAt, dry } = play(new PrebufferHold(32.1, 0, 48, segments));
    expect(dry, `started at ${startedAt} s`).toBe(0);
    // 48 s of media are in at 37.5 s on this link: the wait was an estimate, the lead is what holds.
    expect(startedAt).toBeCloseTo(37.5, 0);
  });

  it('counts down the wait in seconds of the clock while it holds for the lead', () => {
    const hold = new PrebufferHold(32.1, 0, 48, segments);
    expect(hold.update(0, 0, 0).seconds).toBe(33);
    // The opening is in at 3.75 s, at 8 Mbit/s; at 10 s a heavy segment is on its way: 27.5 s to go.
    hold.update(30, 3_750, 0);
    expect(hold.update(30, 10_000, 0).seconds).toBe(28);
  });

  it('holds for prebuffer itself facing a den-remux that names no lead', () => {
    expect(new PrebufferHold(32.1, 0, undefined, segments).target).toBe(32.1);
    expect(new PrebufferHold(32.1, 0, null, null).target).toBe(32.1);
  });

  it('reads as minutes and seconds', () => {
    expect(countdownLabel(24)).toBe('Starts in 0:24');
    expect(countdownLabel(9.2)).toBe('Starts in 0:10');
  });
});
