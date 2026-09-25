import type { Card } from '../core/deck';
import { countRemoved, historyPositions, type RemovalOp } from '../core/duplicates';
import type { HistoryStore, RemovedEntry } from '../core/historyStore';
import { LIKED_SONGS_ID } from '../core/playlists';
import { clampIndex } from '../core/positions';
import { restoreEntry } from '../session/restore';
import type { SpotifyApi } from '../spotify/api';
import { ApiError, AuthError, describeError } from '../spotify/errors';

export interface DedupeDeps {
  api: Pick<SpotifyApi, 'removeItems' | 'addItems'>;
  history: HistoryStore;
  playlistId: string;
  /** Groups this run's History entries, like a swipe session's id. */
  runId: string;
  now: () => number;
  /** Rows in the playlist when it was loaded. */
  playlistLength: number;
}

export type DedupePhase = 'review' | 'removing' | 'done' | 'partial' | 'undoing' | 'undone';

export interface DedupeSnapshot {
  phase: DedupePhase;
  /** Rows handled so far in the current removal or undo. */
  done: number;
  /** Rows the current removal or undo handles. */
  total: number;
  /** Rows this run removed that are not back in the playlist. */
  removed: number;
  /** Rows in the playlist now. */
  length: number;
  canUndo: boolean;
  /** Title of the song whose removal stopped the run. */
  failedName: string | null;
  error: string | null;
  history: RemovedEntry[];
  /** A Spotify call is in flight. */
  busy: boolean;
  authLost: boolean;
}

export interface DedupeController {
  getSnapshot(): DedupeSnapshot;
  subscribe(listener: () => void): () => void;
  /** Runs `ops` in order and stops at the first failure. */
  start(ops: RemovalOp[]): void;
  /** After a failure: continues with the op that failed. */
  retry(): void;
  /** Puts every row this run removed back at its original position. */
  undo(): void;
  /** History → Restore. */
  restore(uri: string): void;
  dismissError(): void;
  /** Resolves once every queued Spotify call has finished. */
  idle(): Promise<void>;
}

/** A playlist row (index in the playlist as loaded) this run removed. */
interface MissingRow {
  index: number;
  uri: string;
}

/**
 * Removes duplicates from one playlist. `removeItems` deletes every copy of a song, so
 * exact copies are removed by deleting the song and re-adding the copy that stays.
 */
export function createDedupeRun(deps: DedupeDeps): DedupeController {
  const { api, history, playlistId, runId, now } = deps;
  const listeners = new Set<() => void>();
  const length = { current: deps.playlistLength };
  let ops: RemovalOp[] = [];
  let next = 0;
  /** The op at `next` already deleted its song and only has to re-add the kept copy. */
  let reAddPending = false;
  let missing: MissingRow[] = [];
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();

  let snapshot: DedupeSnapshot = {
    phase: 'review',
    done: 0,
    total: 0,
    removed: 0,
    length: length.current,
    canUndo: false,
    failedName: null,
    error: null,
    history: history.load(playlistId),
    busy: false,
    authLost: false,
  };

  function update(patch: Partial<DedupeSnapshot>) {
    const phase = patch.phase ?? snapshot.phase;
    // Outside undo, `done` is always "duplicate rows this run currently has removed" —
    // recomputed here so every call site stays consistent, including restore and undo.
    const done =
      phase === 'undoing' || phase === 'undone' ? (patch.done ?? snapshot.done) : missing.length - (reAddPending ? 1 : 0);
    snapshot = {
      ...snapshot,
      ...patch,
      done,
      removed: missing.length,
      length: length.current,
      canUndo: missing.length > 0,
      history: history.load(playlistId),
    };
    listeners.forEach((listener) => listener());
  }

  function enqueue(job: () => Promise<void>) {
    pending++;
    update({ busy: true });
    queue = queue
      .then(job)
      .catch((error: unknown) =>
        update({ error: describeError(error), authLost: snapshot.authLost || error instanceof AuthError }),
      )
      .finally(() => {
        pending--;
        update({ busy: pending > 0 });
      });
  }

  function entryFor(card: Card, positions: number[]): RemovedEntry {
    return {
      uri: card.uri,
      name: card.name,
      artists: card.artists,
      imageUrl: card.imageUrl,
      positions,
      sessionId: runId,
      removedAt: now(),
    };
  }

  /** A row this run removed is back in the playlist. */
  function rowBack(row: MissingRow) {
    missing = missing.filter((r) => !(r.uri === row.uri && r.index === row.index));
    const op = ops[next];
    if (reAddPending && op?.kind === 'copies' && op.card.uri === row.uri && op.keep === row.index) {
      // The kept copy whose re-add failed is back: that op is finished, so retry must skip it.
      reAddPending = false;
      next++;
      history.remove(playlistId, row.uri); // its safety entry
    } else if (!missing.some((r) => r.uri === row.uri)) {
      history.remove(playlistId, row.uri);
    }
  }

  /** Deletes every copy of `card`. Its History entry must already be written. */
  async function removeSong(card: Card) {
    try {
      await api.removeItems(playlistId, [card.uri]);
    } catch (error) {
      const definiteRejection =
        error instanceof AuthError || (error instanceof ApiError && error.status >= 400 && error.status < 500);
      if (definiteRejection) {
        history.remove(playlistId, card.uri);
        throw error;
      }
      // Spotify may have applied the DELETE anyway, so the entry stays restorable.
      throw new Error("Spotify didn't confirm the removal. If it went through, you can restore the song from History.");
    }
    length.current -= card.positions.length;
    missing.push(...card.positions.map((index) => ({ index, uri: card.uri })));
  }

  async function runOp(op: RemovalOp) {
    const { card } = op;
    if (op.kind === 'release') {
      history.add(playlistId, entryFor(card, historyPositions(card.positions, ops)));
      await removeSong(card);
      update({});
      return;
    }
    if (!reAddPending) {
      // Written first: if the re-add below fails, the song is gone and History brings it back.
      history.add(playlistId, entryFor(card, historyPositions([op.keep], ops)));
      await removeSong(card);
      reAddPending = true;
    }
    const index = op.keep - missing.filter((row) => row.index < op.keep).length;
    await api.addItems(playlistId, [card.uri], clampIndex(index, length.current));
    reAddPending = false;
    length.current++;
    missing = missing.filter((row) => !(row.uri === card.uri && row.index === op.keep));
    history.remove(playlistId, card.uri);
    update({});
  }

  async function runFrom() {
    update({ phase: 'removing', failedName: null, error: null });
    for (; next < ops.length; next++) {
      try {
        await runOp(ops[next]);
      } catch (error) {
        update({
          phase: 'partial',
          failedName: ops[next].card.name,
          error: describeError(error),
          authLost: snapshot.authLost || error instanceof AuthError,
        });
        return;
      }
    }
    update({ phase: 'done' });
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start(newOps) {
      if (snapshot.phase !== 'review' || snapshot.busy) return;
      ops = newOps;
      next = 0;
      update({ done: 0, total: countRemoved(ops) });
      enqueue(runFrom);
    },

    retry() {
      if (snapshot.phase !== 'partial' || snapshot.busy) return;
      enqueue(runFrom);
    },

    undo() {
      if (snapshot.busy || missing.length === 0) return;
      const before = { phase: snapshot.phase, total: snapshot.total };
      enqueue(async () => {
        // In ascending order, every earlier row is back, so each original index is right.
        // Liked Songs ignores positions and puts each re-liked song on top, so go in
        // descending order there to keep the songs' original order.
        const direction = playlistId === LIKED_SONGS_ID ? -1 : 1;
        const rows = [...missing].sort((a, b) => direction * (a.index - b.index));
        update({ phase: 'undoing', done: 0, total: rows.length, error: null });
        try {
          for (const row of rows) {
            await api.addItems(playlistId, [row.uri], clampIndex(row.index, length.current));
            length.current++;
            rowBack(row);
            update({ done: snapshot.done + 1 });
          }
        } catch (error) {
          update({ ...before, failedName: null });
          throw error;
        }
        update({ phase: 'undone' });
      });
    },

    restore(uri) {
      enqueue(async () => {
        const entry = history.load(playlistId).find((e) => e.uri === uri);
        if (!entry) return; // Nothing recorded for this uri: restoreEntry would be a no-op.
        const op = ops[next];
        // The safety entry of a pending copies op only ever put the kept row back; any
        // other entry's rows are exactly the still-missing rows for that uri.
        const rows: MissingRow[] =
          reAddPending && op?.kind === 'copies' && op.card.uri === uri
            ? [{ uri, index: op.keep }]
            : missing.filter((row) => row.uri === uri).sort((a, b) => a.index - b.index);
        // Rows go back one at a time, so a failure partway doesn't leave a re-added
        // row in `missing` for Undo to add a second time.
        let back = 0;
        const onInserted = () => {
          const row = rows[back++];
          if (row) rowBack(row);
        };
        try {
          await restoreEntry({ api, history, playlistId }, uri, length, { onInserted });
        } finally {
          update({});
        }
      });
    },

    dismissError: () => update({ error: null }),

    async idle() {
      while (pending > 0) await queue;
    },
  };
}
