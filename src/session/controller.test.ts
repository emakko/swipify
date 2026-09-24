import { describe, expect, it, vi } from 'vitest';
import type { Card, Deck } from '../core/deck';
import { createHistoryStore, type RemovedEntry } from '../core/historyStore';
import { currentCard } from '../core/session';
import { ApiError, AuthError } from '../spotify/errors';
import { memoryStorage } from '../test/memoryStorage';
import { createSession, type SessionController } from './controller';

const card = (uri: string, positions: number[]): Card => ({
  uri,
  name: uri,
  artists: [],
  album: '',
  imageUrl: null,
  durationMs: 1000,
  isPlayable: true,
  positions,
  playUri: uri,
});

// Playlist rows: 0=a, 1=b, 2=c, 3=<local file>, 4=c (duplicate). Deck order: a, b, c.
function setup(existingHistory: RemovedEntry[] = []) {
  const history = createHistoryStore(memoryStorage());
  existingHistory.forEach((entry) => history.add('pl', entry));
  const api = {
    removeItems: vi.fn(async (_playlistId: string, _uris: string[]) => {}),
    addItems: vi.fn(async (_playlistId: string, _uris: string[], _position: number) => {}),
  };
  const deck: Deck = { cards: [card('a', [0]), card('b', [1]), card('c', [2, 4])], skipped: 1, totalRows: 5 };
  const controller = createSession({ api, history, playlistId: 'pl', sessionId: 's1', now: () => 1000 }, deck);
  return { api, controller };
}

const current = (controller: SessionController) => currentCard(controller.getSnapshot().session)?.uri ?? null;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

describe('createSession', () => {
  it('removes the current song on Spotify and records it in history', async () => {
    const { api, controller } = setup();
    controller.remove();
    expect(current(controller)).toBe('b');
    await controller.idle();
    expect(api.removeItems).toHaveBeenCalledWith('pl', ['a']);
    expect(controller.getSnapshot().history).toEqual([
      { uri: 'a', name: 'a', artists: [], imageUrl: null, positions: [0], sessionId: 's1', removedAt: 1000 },
    ]);
  });

  it('keep makes no Spotify call', async () => {
    const { api, controller } = setup();
    controller.keep();
    controller.undo();
    await controller.idle();
    expect(current(controller)).toBe('a');
    expect(api.removeItems).not.toHaveBeenCalled();
    expect(api.addItems).not.toHaveBeenCalled();
  });

  it('brings the card back and reports an error when removal fails', async () => {
    const { api, controller } = setup();
    api.removeItems.mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    controller.remove();
    await controller.idle();
    expect(current(controller)).toBe('a');
    expect(controller.getSnapshot().error).toMatch(/permission/);
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('undo of a removal re-adds the song at its original position', async () => {
    const { api, controller } = setup();
    controller.remove();
    await controller.idle();
    controller.undo();
    await controller.idle();
    expect(api.addItems).toHaveBeenCalledWith('pl', ['a'], 0);
    expect(current(controller)).toBe('a');
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('ignores undo while a Spotify call is still running', async () => {
    const { api, controller } = setup();
    const pending = deferred();
    api.removeItems.mockImplementationOnce(() => pending.promise);
    controller.remove();
    expect(controller.getSnapshot().busy).toBe(true);
    controller.undo();
    expect(current(controller)).toBe('b');

    pending.resolve();
    await controller.idle();
    expect(controller.getSnapshot().busy).toBe(false);
    controller.undo();
    await controller.idle();
    expect(current(controller)).toBe('a');
  });

  it('runs Spotify calls one at a time in swipe order', async () => {
    const { api, controller } = setup();
    const pending = deferred();
    api.removeItems.mockImplementationOnce(() => pending.promise);
    controller.remove();
    controller.remove();
    await flush();
    expect(api.removeItems).toHaveBeenCalledTimes(1);

    pending.resolve();
    await controller.idle();
    expect(api.removeItems.mock.calls).toEqual([
      ['pl', ['a']],
      ['pl', ['b']],
    ]);
  });

  it('restores every copy of a duplicated song at its original positions', async () => {
    const { api, controller } = setup();
    controller.keep();
    controller.keep();
    controller.remove();
    await controller.idle();
    expect(api.removeItems).toHaveBeenCalledWith('pl', ['c']);

    controller.undo();
    await controller.idle();
    expect(api.addItems.mock.calls).toEqual([
      ['pl', ['c'], 2],
      ['pl', ['c'], 4],
    ]);
  });

  it('restores from history accounting for songs that are still removed', async () => {
    const { api, controller } = setup();
    controller.remove();
    controller.remove();
    await controller.idle();

    controller.restore('b');
    expect(controller.getSnapshot().session.decisions.b).toBe('restored');
    await controller.idle();
    expect(api.addItems).toHaveBeenLastCalledWith('pl', ['b'], 0);

    controller.restore('a');
    await controller.idle();
    expect(api.addItems).toHaveBeenLastCalledWith('pl', ['a'], 0);
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('clamps restores from an earlier session to the current playlist length', async () => {
    const old: RemovedEntry = {
      uri: 'x',
      name: 'x',
      artists: [],
      imageUrl: null,
      positions: [50],
      sessionId: 'old',
      removedAt: 1,
    };
    const { api, controller } = setup([old]);
    expect(controller.getSnapshot().history).toEqual([old]);

    controller.restore('x');
    await controller.idle();
    expect(api.addItems).toHaveBeenCalledWith('pl', ['x'], 5);
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('keeps the history entry and reports an error when restoring fails', async () => {
    const { api, controller } = setup();
    controller.remove();
    await controller.idle();
    api.addItems.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    controller.undo();
    await controller.idle();
    expect(controller.getSnapshot().session.decisions.a).toBe('remove');
    expect(current(controller)).toBe('b');
    expect(controller.getSnapshot().history.map((e) => e.uri)).toEqual(['a']);
    expect(controller.getSnapshot().error).toMatch(/Network error/);
  });

  it('flags a lost login', async () => {
    const { api, controller } = setup();
    api.removeItems.mockRejectedValueOnce(new AuthError());
    controller.remove();
    await controller.idle();
    expect(controller.getSnapshot().authLost).toBe(true);
  });

  it('records the history entry before the DELETE, so it exists while removal is pending', async () => {
    const { api, controller } = setup();
    const pending = deferred();
    api.removeItems.mockImplementationOnce(() => pending.promise);
    controller.remove();
    expect(controller.getSnapshot().history).toEqual([
      { uri: 'a', name: 'a', artists: [], imageUrl: null, positions: [0], sessionId: 's1', removedAt: 1000 },
    ]);
    pending.resolve();
    await controller.idle();
  });

  it('drops the history entry when a 403 definitively rejects the removal', async () => {
    const { api, controller } = setup();
    api.removeItems.mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    controller.remove();
    await controller.idle();
    expect(controller.getSnapshot().history).toEqual([]);
    expect(controller.getSnapshot().error).toMatch(/permission/);
  });

  it("keeps the history entry and says the removal couldn't be confirmed on an ambiguous failure", async () => {
    const { api, controller } = setup();
    api.removeItems.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    controller.remove();
    await controller.idle();
    expect(controller.getSnapshot().history.map((e) => e.uri)).toEqual(['a']);
    expect(controller.getSnapshot().error).toBe(
      'Couldn\'t confirm the removal of "a" — if it went through, you can restore it from History.',
    );
    expect(current(controller)).toBe('a');
  });

  it('drops a stale history entry for a song that is back in the deck at session start', () => {
    const stale: RemovedEntry = {
      uri: 'a',
      name: 'a',
      artists: [],
      imageUrl: null,
      positions: [0],
      sessionId: 'old',
      removedAt: 1,
    };
    const surviving: RemovedEntry = {
      uri: 'zzz',
      name: 'zzz',
      artists: [],
      imageUrl: null,
      positions: [9],
      sessionId: 'old',
      removedAt: 2,
    };
    const history = createHistoryStore(memoryStorage());
    history.add('pl', stale);
    history.add('pl', surviving);
    const api = { removeItems: vi.fn(async () => {}), addItems: vi.fn(async () => {}) };
    const deck: Deck = { cards: [card('a', [0]), card('b', [1]), card('c', [2, 4])], skipped: 1, totalRows: 5 };
    const controller = createSession({ api, history, playlistId: 'pl', sessionId: 's1', now: () => 1000 }, deck);

    expect(controller.getSnapshot().history).toEqual([surviving]);
    expect(history.load('pl')).toEqual([surviving]);
  });

  it('notifies subscribers and clears errors on dismiss', async () => {
    const { api, controller } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    api.removeItems.mockRejectedValueOnce(new ApiError(500, 'Boom'));
    controller.remove();
    await controller.idle();
    expect(listener).toHaveBeenCalled();
    controller.dismissError();
    expect(controller.getSnapshot().error).toBeNull();
  });
});
