import type { HistoryStore } from '../core/historyStore';
import { clampIndex, restoreIndices } from '../core/positions';
import type { SpotifyApi } from '../spotify/api';

export interface RestoreDeps {
  api: Pick<SpotifyApi, 'addItems'>;
  history: HistoryStore;
  playlistId: string;
}

/**
 * Puts a removed song back at its original positions and drops its History entry.
 * `length` is the playlist's current row count and is updated after every insert, so
 * it stays right even if a later insert fails.
 */
export async function restoreEntry(
  { api, history, playlistId }: RestoreDeps,
  uri: string,
  length: { current: number },
): Promise<void> {
  const entries = history.load(playlistId);
  const entry = entries.find((e) => e.uri === uri);
  if (!entry) return; // The removal never reached Spotify, so there is nothing to put back.
  const otherRemoved = entries
    .filter((e) => e.sessionId === entry.sessionId && e.uri !== uri)
    .flatMap((e) => e.positions);
  for (const index of restoreIndices(entry.positions, otherRemoved)) {
    await api.addItems(playlistId, [uri], clampIndex(index, length.current));
    length.current++;
  }
  history.remove(playlistId, uri);
}
