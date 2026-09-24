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
});
