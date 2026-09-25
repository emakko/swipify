export type SwipeDirection = 'keep' | 'remove';

export const SWIPE_DISTANCE = 120;
const SWIPE_VELOCITY = 600;
/** A flick must have moved the card at least this far in the flick's direction. */
const FLICK_MIN_OFFSET = 30;

const directionOf = (dx: number): SwipeDirection => (dx > 0 ? 'keep' : 'remove');

/**
 * What a released drag means: past the distance threshold, or a fast flick the same
 * way the card was dragged. Flicking back toward the middle cancels the swipe.
 */
export function swipeIntent(offsetX: number, velocityX: number): SwipeDirection | null {
  const flicking = Math.abs(velocityX) > SWIPE_VELOCITY;
  const sameWay = Math.sign(offsetX) === Math.sign(velocityX);
  if (Math.abs(offsetX) > SWIPE_DISTANCE) return flicking && !sameWay ? null : directionOf(offsetX);
  if (flicking && sameWay && Math.abs(offsetX) >= FLICK_MIN_OFFSET) return directionOf(offsetX);
  return null;
}

export type Shortcut = SwipeDirection | 'toggle' | 'undo';

export interface KeyLike {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
}

const TEXT_FIELDS = 'input, select, textarea, [contenteditable]';
const CONTROLS = `button, a[href], ${TEXT_FIELDS}`;

const targetMatches = (target: EventTarget | null, selector: string) =>
  Boolean((target as Element | null)?.closest?.(selector));

/** Maps a keydown on the swipe screen to its shortcut, or null to leave it to the browser. */
export function shortcutFor(e: KeyLike, { historyOpen }: { historyOpen: boolean }): Shortcut | null {
  if (e.repeat || targetMatches(e.target, TEXT_FIELDS)) return null;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') return 'undo';
  // Alt/Cmd+← is the browser's Back: never let it (or other chords) remove a song.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  // While the History panel is open it can cover the card at narrow widths, so
  // ←/→ must not remove or keep a song the user can't see. Undo and Space still work.
  if (e.key === 'ArrowRight') return historyOpen ? null : 'keep';
  if (e.key === 'ArrowLeft') return historyOpen ? null : 'remove';
  // Space on a focused button must press that button, not toggle playback.
  if (e.key === ' ') return targetMatches(e.target, CONTROLS) ? null : 'toggle';
  return null;
}
