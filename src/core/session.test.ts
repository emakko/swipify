import { describe, expect, it } from 'vitest';
import type { Card } from './deck';
import {
  currentCard,
  initialSession,
  sessionCounts,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from './session';

const card = (uri: string): Card => ({
  uri,
  name: uri,
  artists: [],
  album: '',
  imageUrl: null,
  durationMs: 1000,
  isPlayable: true,
  positions: [0],
  playUri: uri,
});

const start = () => initialSession([card('a'), card('b'), card('c')]);
const run = (state: SessionState, ...actions: SessionAction[]) => actions.reduce(sessionReducer, state);
const current = (state: SessionState) => currentCard(state)?.uri ?? null;

describe('sessionReducer', () => {
  it('starts on the first card', () => {
    expect(current(start())).toBe('a');
  });

  it('advances on keep and remove', () => {
    const state = run(start(), { type: 'keep', uri: 'a' }, { type: 'remove', uri: 'b' });
    expect(current(state)).toBe('c');
    expect(state.decisions).toEqual({ a: 'keep', b: 'remove' });
  });

  it('ignores a swipe for a card that is not current', () => {
    const state = run(start(), { type: 'keep', uri: 'a' }, { type: 'keep', uri: 'a' });
    expect(state.undoStack).toHaveLength(1);
    expect(current(state)).toBe('b');
  });

  it('undo brings back the last swiped card, most recent first', () => {
    const swiped = run(start(), { type: 'keep', uri: 'a' }, { type: 'remove', uri: 'b' });
    const once = run(swiped, { type: 'undo' });
    expect(current(once)).toBe('b');
    const twice = run(once, { type: 'undo' });
    expect(current(twice)).toBe('a');
    expect(twice.undoStack).toEqual([]);
  });

  it('undo with nothing to undo is a no-op', () => {
    const state = start();
    expect(run(state, { type: 'undo' })).toBe(state);
  });

  it('restored marks a removed song as back and takes it off the undo stack', () => {
    const state = run(
      start(),
      { type: 'keep', uri: 'a' },
      { type: 'remove', uri: 'b' },
      { type: 'restored', uri: 'b' },
    );
    expect(state.decisions.b).toBe('restored');
    expect(current(state)).toBe('c');
    expect(state.undoStack).toEqual([{ uri: 'a', decision: 'keep' }]);
  });

  it('restored is ignored for a song that is not removed', () => {
    const state = run(start(), { type: 'keep', uri: 'a' });
    expect(run(state, { type: 'restored', uri: 'a' })).toBe(state);
  });

  it('removalFailed puts the card back in front and off the undo stack', () => {
    const state = run(start(), { type: 'remove', uri: 'a' }, { type: 'keep', uri: 'b' }, {
      type: 'removalFailed',
      uri: 'a',
    });
    expect(current(state)).toBe('a');
    expect(state.undoStack).toEqual([{ uri: 'b', decision: 'keep' }]);
  });

  it('removalFailed is ignored when the song is no longer marked removed', () => {
    const state = run(start(), { type: 'keep', uri: 'a' });
    expect(run(state, { type: 'removalFailed', uri: 'a' })).toBe(state);
  });

  it('restoreFailed marks the song removed again and undoable', () => {
    const state = run(start(), { type: 'remove', uri: 'a' }, { type: 'undo' }, {
      type: 'restoreFailed',
      uri: 'a',
    });
    expect(state.decisions.a).toBe('remove');
    expect(current(state)).toBe('b');
    expect(state.undoStack).toEqual([{ uri: 'a', decision: 'remove' }]);
  });

  it('restoreFailed is ignored for songs outside this deck', () => {
    const state = start();
    expect(run(state, { type: 'restoreFailed', uri: 'zzz' })).toBe(state);
  });

  it('has no current card once everything is decided, or for an empty deck', () => {
    const state = run(start(), { type: 'keep', uri: 'a' }, { type: 'keep', uri: 'b' }, { type: 'keep', uri: 'c' });
    expect(currentCard(state)).toBeNull();
    expect(currentCard(initialSession([]))).toBeNull();
  });
});

describe('sessionCounts', () => {
  it('counts restored songs as kept', () => {
    const state = run(
      start(),
      { type: 'keep', uri: 'a' },
      { type: 'remove', uri: 'b' },
      { type: 'remove', uri: 'c' },
      { type: 'restored', uri: 'c' },
    );
    expect(sessionCounts(state)).toEqual({ kept: 2, removed: 1, decided: 3, total: 3 });
  });
});
