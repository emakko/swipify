import { describe, expect, it } from 'vitest';
import { shortcutFor, swipeIntent, type KeyLike } from './gestures';

describe('swipeIntent', () => {
  it('swipes once the card is dragged far enough', () => {
    expect(swipeIntent(130, 0)).toBe('keep');
    expect(swipeIntent(-130, 0)).toBe('remove');
  });

  it('snaps back from a short, slow drag', () => {
    expect(swipeIntent(50, 0)).toBeNull();
    expect(swipeIntent(-50, 100)).toBeNull();
  });

  it('swipes on a fast flick in the direction of the drag', () => {
    expect(swipeIntent(40, 800)).toBe('keep');
    expect(swipeIntent(-40, -800)).toBe('remove');
  });

  it('does not remove a song when a keep drag is flicked back to the middle', () => {
    expect(swipeIntent(50, -700)).toBeNull();
    expect(swipeIntent(-50, 700)).toBeNull();
  });

  it('cancels a long drag that is flicked back', () => {
    expect(swipeIntent(200, -900)).toBeNull();
  });

  it('ignores a flick that barely moved the card', () => {
    expect(swipeIntent(5, 900)).toBeNull();
  });
});

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  repeat: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: null,
  ...extra,
});

/** A stand-in for a DOM element: `closest` matches when the selector lists the tag. */
const element = (tag: string) => ({ closest: (selector: string) => (selector.split(', ').includes(tag) ? {} : null) }) as unknown as EventTarget;

describe('shortcutFor', () => {
  const closed = { historyOpen: false };

  it('maps arrows, Space and Ctrl/Cmd+Z', () => {
    expect(shortcutFor(key('ArrowRight'), closed)).toBe('keep');
    expect(shortcutFor(key('ArrowLeft'), closed)).toBe('remove');
    expect(shortcutFor(key(' '), closed)).toBe('toggle');
    expect(shortcutFor(key('z', { ctrlKey: true }), closed)).toBe('undo');
    expect(shortcutFor(key('Z', { metaKey: true }), closed)).toBe('undo');
  });

  it('ignores held-down keys and typing in text fields', () => {
    expect(shortcutFor(key('ArrowLeft', { repeat: true }), closed)).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { target: element('input') }), closed)).toBeNull();
    expect(shortcutFor(key('z', { ctrlKey: true, target: element('textarea') }), closed)).toBeNull();
  });

  it('never removes a song on the browser’s Back shortcut or other chords', () => {
    expect(shortcutFor(key('ArrowLeft', { altKey: true }), closed)).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { metaKey: true }), closed)).toBeNull();
    expect(shortcutFor(key('ArrowLeft', { ctrlKey: true }), closed)).toBeNull();
    expect(shortcutFor(key('ArrowRight', { shiftKey: true }), closed)).toBeNull();
  });

  it('does not keep or remove while History covers the card, but still undoes and toggles', () => {
    const open = { historyOpen: true };
    expect(shortcutFor(key('ArrowRight'), open)).toBeNull();
    expect(shortcutFor(key('ArrowLeft'), open)).toBeNull();
    expect(shortcutFor(key('z', { ctrlKey: true }), open)).toBe('undo');
    expect(shortcutFor(key(' '), open)).toBe('toggle');
  });

  it('lets Space press a focused button instead of toggling playback', () => {
    expect(shortcutFor(key(' ', { target: element('button') }), closed)).toBeNull();
    expect(shortcutFor(key('ArrowRight', { target: element('button') }), closed)).toBe('keep');
  });

  it('ignores other keys', () => {
    expect(shortcutFor(key('a'), closed)).toBeNull();
    expect(shortcutFor(key('Enter'), closed)).toBeNull();
  });
});
