import { describe, expect, it, vi } from 'vitest';
import { createHistoryStore, type RemovedEntry } from '../core/historyStore';
import { memoryStorage } from '../test/memoryStorage';
import { restoreEntry } from './restore';

const entry = (uri: string, positions: number[], sessionId = 's1'): RemovedEntry => ({
  uri,
  name: uri,
  artists: [],
  imageUrl: null,
  positions,
  sessionId,
  removedAt: 1,
});

describe('restoreEntry', () => {
  it('re-adds a song around the other songs its session removed, then forgets it', async () => {
    const history = createHistoryStore(memoryStorage());
    history.add('pl', entry('a', [4, 7]));
    history.add('pl', entry('b', [2]));
    history.add('pl', entry('c', [0], 'other-session'));
    const api = { addItems: vi.fn(async (_p: string, _uris: string[], _position: number) => {}) };
    const length = { current: 5 };

    await restoreEntry({ api, history, playlistId: 'pl' }, 'a', length);

    expect(api.addItems.mock.calls).toEqual([
      ['pl', ['a'], 3],
      ['pl', ['a'], 6],
    ]);
    expect(length.current).toBe(7);
    expect(history.load('pl').map((e) => e.uri)).not.toContain('a');
  });

  it('does nothing for a song without an entry', async () => {
    const api = { addItems: vi.fn(async () => {}) };
    await restoreEntry({ api, history: createHistoryStore(memoryStorage()), playlistId: 'pl' }, 'a', { current: 0 });
    expect(api.addItems).not.toHaveBeenCalled();
  });

  it('trims the entry after each insert, so a retry after a failure does not add a copy twice', async () => {
    const history = createHistoryStore(memoryStorage());
    history.add('pl', entry('a', [0, 2]));
    const api = { addItems: vi.fn(async (_p: string, _uris: string[], _position: number) => {}) };
    api.addItems.mockResolvedValueOnce().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const length = { current: 1 };

    await expect(restoreEntry({ api, history, playlistId: 'pl' }, 'a', length)).rejects.toThrow();
    expect(length.current).toBe(2);
    expect(history.load('pl')[0].positions).toEqual([2]);

    await restoreEntry({ api, history, playlistId: 'pl' }, 'a', length);
    expect(api.addItems).toHaveBeenLastCalledWith('pl', ['a'], 2);
    expect(history.load('pl')).toEqual([]);
  });

  it('inserts positions given out of order in ascending order', async () => {
    const history = createHistoryStore(memoryStorage());
    history.add('pl', entry('a', [5, 1]));
    const api = { addItems: vi.fn(async (_p: string, _uris: string[], _position: number) => {}) };
    await restoreEntry({ api, history, playlistId: 'pl' }, 'a', { current: 10 });
    expect(api.addItems.mock.calls.map((call) => call[2])).toEqual([1, 5]);
  });

  it('does not count songs whose removal is still queued', async () => {
    const history = createHistoryStore(memoryStorage());
    history.add('pl', entry('a', [3]));
    history.add('pl', entry('b', [1]));
    const api = { addItems: vi.fn(async (_p: string, _uris: string[], _position: number) => {}) };
    await restoreEntry({ api, history, playlistId: 'pl' }, 'a', { current: 3 }, { unconfirmed: new Set(['b']) });
    expect(api.addItems).toHaveBeenCalledWith('pl', ['a'], 3);
  });

  it('puts the song back but keeps a newer entry written since the restore was asked for', async () => {
    const history = createHistoryStore(memoryStorage());
    history.add('pl', { ...entry('a', [0]), removedAt: 2 });
    const api = { addItems: vi.fn(async (_p: string, _uris: string[], _position: number) => {}) };
    await restoreEntry({ api, history, playlistId: 'pl' }, 'a', { current: 1 }, { removedAt: 1 });
    expect(api.addItems).toHaveBeenCalledTimes(1);
    expect(history.load('pl')).toEqual([{ ...entry('a', [0]), removedAt: 2 }]);
  });
});
