import { describe, expect, it, vi } from 'vitest';
import { collectCards, type RawPlaylistRow } from '../core/deck';
import { findDuplicates, planRemoval } from '../core/duplicates';
import { createHistoryStore } from '../core/historyStore';
import { ApiError, AuthError } from '../spotify/errors';
import { memoryStorage } from '../test/memoryStorage';
import { createDedupeRun } from './controller';

// a is in the playlist three times; y2 is another release of y (same title and artist).
const PLAYLIST = ['a', 'x', 'a', 'y', 'y2', 'a', 'z'];
const NAMES: Record<string, string> = { y2: 'y' };

const row = (uri: string): RawPlaylistRow => ({
  is_local: false,
  item: {
    type: 'track',
    uri,
    name: NAMES[uri] ?? uri,
    duration_ms: 1000,
    artists: [{ name: 'Artist' }],
    album: { name: `Album ${uri}` },
  },
});

/** A playlist "on Spotify" that the fake API edits the way the real one does. */
function fakeSpotify(initial: string[]) {
  const rows = [...initial];
  const api = {
    removeItems: vi.fn(async (_playlistId: string, uris: string[]) => {
      for (let i = rows.length - 1; i >= 0; i--) if (uris.includes(rows[i])) rows.splice(i, 1);
    }),
    addItems: vi.fn(async (_playlistId: string, uris: string[], position: number) => {
      rows.splice(position, 0, ...uris);
    }),
  };
  return { rows, api };
}

function setup(unticked: string[] = []) {
  const spotify = fakeSpotify(PLAYLIST);
  const history = createHistoryStore(memoryStorage());
  const ops = planRemoval(findDuplicates(collectCards(PLAYLIST.map(row)).cards), new Set(unticked));
  const controller = createDedupeRun({
    api: spotify.api,
    history,
    playlistId: 'pl',
    runId: 'r1',
    now: () => 1000,
    playlistLength: PLAYLIST.length,
  });
  return { spotify, controller, ops };
}

describe('createDedupeRun', () => {
  it('removes every duplicate and keeps the first copy in place', async () => {
    const { spotify, controller, ops } = setup();
    controller.start(ops);
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'z']);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'done', done: 3, total: 3, removed: 3, length: 4 });
  });

  it('lists other releases in History, in the run index space, but not exact copies', async () => {
    const { controller, ops } = setup();
    controller.start(ops);
    await controller.idle();
    expect(controller.getSnapshot().history).toEqual([
      { uri: 'y2', name: 'y', artists: ['Artist'], imageUrl: null, positions: [3], sessionId: 'r1', removedAt: 1000 },
    ]);
  });

  it('restores an other release from History at its place', async () => {
    const { spotify, controller, ops } = setup();
    controller.start(ops);
    await controller.idle();
    controller.restore('y2');
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'y2', 'z']);
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('undo puts every row back at its original position', async () => {
    const { spotify, controller, ops } = setup();
    controller.start(ops);
    await controller.idle();
    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'undone', total: 3, removed: 0, history: [] });
  });

  it('does not put a song back twice when it was restored before undo', async () => {
    const { spotify, controller, ops } = setup();
    controller.start(ops);
    await controller.idle();
    controller.restore('y2');
    await controller.idle(); // undo() is ignored while a call is in flight
    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
    expect(controller.getSnapshot().total).toBe(2);
  });

  it('stops when the kept copy cannot be re-added, leaving it restorable', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems.mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();
    expect(spotify.rows).toEqual(['x', 'y', 'y2', 'z']);
    const snap = controller.getSnapshot();
    expect(snap).toMatchObject({ phase: 'partial', failedName: 'a', removed: 3, canUndo: true });
    expect(snap.error).toContain('Network error');
    expect(snap.history.map((e) => [e.uri, e.positions])).toEqual([['a', [0]]]);
  });

  it('retry re-adds the kept copy without deleting again, then continues', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems.mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();
    controller.retry();
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'z']);
    expect(spotify.api.removeItems.mock.calls.map((call) => call[1])).toEqual([['a'], ['y2']]);
    expect(controller.getSnapshot().phase).toBe('done');
    expect(controller.getSnapshot().history.map((e) => e.uri)).toEqual(['y2']);
  });

  it('undo after a failure puts back what was removed', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems.mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();
    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
    expect(controller.getSnapshot().history).toEqual([]);
  });

  it('drops the History entry when Spotify rejects a removal', async () => {
    const { spotify, controller, ops } = setup(['copies:a']);
    spotify.api.removeItems.mockRejectedValueOnce(new ApiError(403, 'Forbidden'));
    controller.start(ops);
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'partial', failedName: 'y', history: [], canUndo: false });
  });

  it('keeps the History entry when a removal is not confirmed', async () => {
    const { spotify, controller, ops } = setup(['copies:a']);
    spotify.api.removeItems.mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();
    const snap = controller.getSnapshot();
    expect(snap.error).toContain('restore the song from History');
    expect(snap.history.map((e) => e.uri)).toEqual(['y2']);
  });

  it('reports a lost login', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.removeItems.mockRejectedValueOnce(new AuthError());
    controller.start(ops);
    await controller.idle();
    expect(controller.getSnapshot().authLost).toBe(true);
  });

  it('restores the failed kept copy, then retries, then undoes', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems.mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();

    controller.restore('a');
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'y2', 'z']);
    expect(controller.getSnapshot()).toMatchObject({ removed: 2, canUndo: true, done: 2 });
    expect(controller.getSnapshot().history).toEqual([]);

    controller.retry();
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'z']);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'done', done: 3 });
    expect(spotify.api.removeItems.mock.calls.map((call) => call[1])).toEqual([['a'], ['y2']]);

    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
  });

  it('undo fails right after a failed re-add, then retry recovers without a second delete', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'));
    controller.start(ops);
    await controller.idle();

    controller.undo();
    await controller.idle();
    expect(controller.getSnapshot().phase).toBe('partial');
    expect(spotify.rows).toEqual(['x', 'y', 'y2', 'z']);
    expect(controller.getSnapshot().removed).toBe(3);

    controller.retry();
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'z']);
    expect(spotify.api.removeItems.mock.calls.map((call) => call[1])).toEqual([['a'], ['y2']]);
    expect(controller.getSnapshot().length).toBe(4);

    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
  });

  it('clears failedName when undo itself fails, so the error is not blamed on the earlier song', async () => {
    const { spotify, controller, ops } = setup();
    spotify.api.addItems
      .mockRejectedValueOnce(new TypeError('offline')) // the re-add
      .mockRejectedValueOnce(new TypeError('offline')); // the first undo insert
    controller.start(ops);
    await controller.idle();
    controller.undo();
    await controller.idle();
    const snap = controller.getSnapshot();
    expect(snap).toMatchObject({ phase: 'partial', failedName: null });
    expect(snap.error).toContain('Network error');
  });

  it('undo fails partway, then retry finishes without redoing the completed row', async () => {
    const { spotify, controller, ops } = setup();
    let call = 0;
    // 1st call: the copies op's re-add. 3rd call: undo's second insert (after the
    // first undo insert put the kept copy back).
    spotify.api.addItems.mockImplementation(async (_playlistId: string, uris: string[], position: number) => {
      call++;
      if (call === 1 || call === 3) throw new TypeError('offline');
      spotify.rows.splice(position, 0, ...uris);
    });
    controller.start(ops);
    await controller.idle();

    controller.undo();
    await controller.idle();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'partial', done: 2 });
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'y2', 'z']);
    expect(controller.getSnapshot().history).toEqual([]);

    controller.retry();
    await controller.idle();
    expect(spotify.rows).toEqual(['a', 'x', 'y', 'z']);
    expect(spotify.api.removeItems.mock.calls.map((call) => call[1])).toEqual([['a'], ['y2']]);
    expect(controller.getSnapshot().phase).toBe('done');

    controller.undo();
    await controller.idle();
    expect(spotify.rows).toEqual(PLAYLIST);
  });
});
