import type { HistoryStore } from '../core/historyStore';
import { clampIndex, restoreIndices } from '../core/positions';
import type { SpotifyApi } from '../spotify/api';

export interface RestoreDeps {
  api: Pick<SpotifyApi, 'addItems'>;
  history: HistoryStore;
  playlistId: string;
}

export interface RestoreOptions {
  /**
   * `removedAt` of the entry when the restore was asked for. If the song was removed
   * again since (its DELETE queued behind this restore), it is still put back, but the
   * newer entry stays in History.
   */
  removedAt?: number;
  /** Songs whose DELETE hasn't run yet: they are still in the playlist. */
  unconfirmed?: ReadonlySet<string>;
  /** Called after each copy is back, in ascending position order. */
  onInserted?: () => void;
}

/**
 * Puts a removed song back at its original positions and drops its History entry.
 * `length` is the playlist's current row count and is updated after every insert, so
 * it stays right even if a later insert fails. The entry is trimmed after every
 * insert too, so retrying after a failure doesn't add a copy twice.
 */
export async function restoreEntry(
  { api, history, playlistId }: RestoreDeps,
  uri: string,
  length: { current: number },
  { removedAt, unconfirmed, onInserted }: RestoreOptions = {},
): Promise<void> {
  const entries = history.load(playlistId);
  const entry = entries.find((e) => e.uri === uri);
  if (!entry) return; // The removal never reached Spotify, so there is nothing to put back.
  const ours = removedAt === undefined || entry.removedAt === removedAt;
  const otherRemoved = entries
    .filter((e) => e.sessionId === entry.sessionId && e.uri !== uri && !unconfirmed?.has(e.uri))
    .flatMap((e) => e.positions);
  const positions = [...entry.positions].sort((a, b) => a - b);
  const indices = restoreIndices(positions, otherRemoved);
  for (const [i, index] of indices.entries()) {
    await api.addItems(playlistId, [uri], clampIndex(index, length.current));
    length.current++;
    if (ours) history.add(playlistId, { ...entry, positions: positions.slice(i + 1) });
    onInserted?.();
  }
  if (ours) history.remove(playlistId, uri);
}
