// Holding a copy's start until it can play through (`prebufferLead`, else `prebuffer`, in the session answer), with an
// honest countdown.

/**
 * The longest any start is held: den-remux's `LONG_PREBUFFER`, past which it ranks a copy below a transcode. A wait at
 * the start is the price of a better picture that then plays through.
 */
export const MAX_HOLD_SECS = 60;
/** Holds shorter than this show no countdown: a moment, not a wait to explain. */
export const COUNTDOWN_FROM_SECS = 3;
/** A buffer that has stood still this long won't grow however long the start is held: it lets go. */
export const STILL_BUFFER_MS = 5_000;
/** How far above what the viewer saw a new estimate must be before the countdown goes back up. */
const RAISE_AFTER_SECS = 2;
/** How far a buffered end may fall short of a segment's end and still count as holding all of it. */
const SEGMENT_END_SLACK_SECS = 0.15;

/** Each segment's `[start, bytes]` as the session sends it (`segments` in the session answer). */
export type Demand = readonly (readonly [number, number])[];

/**
 * Holds a start until `target` seconds of media are buffered ahead, and says how long that will take.
 *
 * den-remux answers with two figures: `prebuffer`, the seconds to wait on the link this browser named, and
 * `prebufferLead`, the seconds of media that wait buys. The hold is on the lead; the wait is only the countdown. They
 * differ wherever the opening is lighter or heavier than the link: a cheap opening buffers many seconds of media a
 * second, so holding for `prebuffer` seconds of media lets go before a heavy scene later is covered, and it stalls
 * there. An older den-remux sends no lead, and the hold is on `prebuffer` (capped at MAX_HOLD_SECS) as before.
 *
 * With the session's `segments` the countdown runs on bits, which is what the link carries, and a buffer is taken to
 * have stood still only once the next segment is overdue at the rate the others came in: a heavy segment on a slow
 * link takes far more than STILL_BUFFER_MS to arrive, and the media buffered only grows when it is all in. Without
 * them, the estimate comes from the media seconds buffered per second waited. The countdown never goes back up by less
 * than RAISE_AFTER_SECS, so a buffer that jitters doesn't make the number jump about.
 */
export class PrebufferHold {
  readonly target: number;
  private readonly wait: number;
  private shown: number | null = null;
  private grew: { at: number; ahead: number };

  constructor(
    prebuffer: number,
    private readonly began: number,
    lead?: number | null,
    private readonly segments?: Demand | null,
  ) {
    this.wait = Math.min(Math.max(prebuffer, 0), MAX_HOLD_SECS);
    this.target = lead != null && lead > 0 ? lead : this.wait;
    this.grew = { at: began, ahead: 0 };
  }

  /** Whether the hold shows a countdown at all. */
  get counts(): boolean {
    return this.wait > COUNTDOWN_FROM_SECS;
  }

  /**
   * With `ahead` seconds buffered past `position` at `now` (ms): whether to start playing, and the seconds to show
   * until then.
   */
  update(ahead: number, now: number, position = 0): { ready: boolean; seconds: number | null } {
    if (ahead > this.grew.ahead) this.grew = { at: now, ahead };
    const elapsed = (now - this.began) / 1000;
    const since = (now - this.grew.at) / 1000;
    // Bits a second up to the last segment that came in: the one still arriving counts for nothing until it is all in.
    const bits = this.bitsBetween(position, position + ahead);
    const came = elapsed - since;
    const bitRate = came > 0 && bits > 0 ? bits / came : null;
    const ready =
      ahead >= this.target ||
      elapsed >= MAX_HOLD_SECS ||
      (since * 1000 >= this.stillMs(position + ahead, bitRate) && ahead > 0);
    if (ready) return { ready, seconds: null };
    let left = this.wait - elapsed;
    // Before two seconds of it, the wait den-remux worked out stands.
    if (elapsed >= 2 && ahead > 0) {
      left = bitRate
        ? (this.bitsBetween(position, position + this.target) - bits) / bitRate - since
        : (this.target - ahead) / (ahead / elapsed);
    }
    left = Math.min(left, MAX_HOLD_SECS - elapsed);
    if (this.shown === null || left < this.shown || left > this.shown + RAISE_AFTER_SECS)
      this.shown = Math.max(left, 0);
    return { ready, seconds: this.counts ? Math.ceil(this.shown) : null };
  }

  /** The bits of the segments that end past `from` and by `to`; 0 without `segments`. */
  private bitsBetween(from: number, to: number): number {
    const segments = this.segments ?? [];
    let bits = 0;
    for (let i = 0; i < segments.length; i++) {
      const end = segments[i + 1]?.[0] ?? Infinity;
      if (end <= from) continue;
      if (end > to + SEGMENT_END_SLACK_SECS) break;
      bits += segments[i]![1] * 8;
    }
    return bits;
  }

  /** How long the buffer may stand still before it lets go: the next segment twice overdue at `bitRate`. */
  private stillMs(end: number, bitRate: number | null): number {
    const next = this.segments?.find(
      (_, i) => (this.segments![i + 1]?.[0] ?? Infinity) > end + SEGMENT_END_SLACK_SECS,
    );
    if (!next || !bitRate) return STILL_BUFFER_MS;
    return Math.max(STILL_BUFFER_MS, ((2 * next[1] * 8) / bitRate) * 1000);
  }
}

/** `Starts in 0:24`. */
export function countdownLabel(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `Starts in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
