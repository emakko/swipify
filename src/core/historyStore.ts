export interface RemovedEntry {
  uri: string;
  name: string;
  artists: string[];
  imageUrl: string | null;
  /** Original positions, in the index space of the session that removed it. */
  positions: number[];
  sessionId: string;
  removedAt: number;
}

export interface HistoryStore {
  /** Entries for a playlist, newest first. */
  load(playlistId: string): RemovedEntry[];
  /** Adds an entry, replacing any existing entry for the same song. */
  add(playlistId: string, entry: RemovedEntry): void;
  remove(playlistId: string, uri: string): void;
}

const storageKey = (playlistId: string) => `spotify-swipe:history:${playlistId}`;

/**
 * Removal history kept in memory and mirrored to `storage` so it survives reloads.
 * Storage failures are swallowed: the in-memory copy keeps undo/restore working.
 */
export function createHistoryStore(storage: Storage | null): HistoryStore {
  const cache = new Map<string, RemovedEntry[]>();

  function read(playlistId: string): RemovedEntry[] {
    const cached = cache.get(playlistId);
    if (cached) return cached;
    let entries: RemovedEntry[] = [];
    try {
      const raw = storage?.getItem(storageKey(playlistId));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) entries = parsed as RemovedEntry[];
    } catch {
      // Corrupt or unreadable storage: start with an empty history.
    }
    cache.set(playlistId, entries);
    return entries;
  }

  function write(playlistId: string, entries: RemovedEntry[]) {
    cache.set(playlistId, entries);
    try {
      storage?.setItem(storageKey(playlistId), JSON.stringify(entries));
    } catch {
      // Storage full or blocked: keep the in-memory copy.
    }
  }

  return {
    load: (playlistId) => [...read(playlistId)].sort((a, b) => b.removedAt - a.removedAt),
    add: (playlistId, entry) =>
      write(playlistId, [...read(playlistId).filter((e) => e.uri !== entry.uri), entry]),
    remove: (playlistId, uri) => write(playlistId, read(playlistId).filter((e) => e.uri !== uri)),
  };
}
