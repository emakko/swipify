import type { Deck } from '../core/deck';
import { forgetPresent, type HistoryStore, type RemovedEntry } from '../core/historyStore';
import {
  currentCard,
  initialSession,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from '../core/session';
import type { SpotifyApi } from '../spotify/api';
import { ApiError, AuthError, describeError } from '../spotify/errors';
import { restoreEntry } from './restore';

export interface SessionDeps {
  api: Pick<SpotifyApi, 'removeItems' | 'addItems'>;
  history: HistoryStore;
  playlistId: string;
  sessionId: string;
  now: () => number;
}

export interface SessionSnapshot {
  session: SessionState;
  /** Removed songs for this playlist (this and earlier sessions), newest first. */
  history: RemovedEntry[];
  skipped: number;
  /** A Spotify call is in flight. */
  busy: boolean;
  error: string | null;
  authLost: boolean;
}

export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  keep(): void;
  remove(): void;
  undo(): void;
  restore(uri: string): void;
  dismissError(): void;
  /** Resolves once every queued Spotify call has finished. */
  idle(): Promise<void>;
}

/**
 * One swipe session over one playlist. Swipes update state immediately; Spotify calls
 * run strictly one at a time in swipe order and roll the state back if they fail.
 */
export function createSession(deps: SessionDeps, deck: Deck): SessionController {
  const { api, history, playlistId, sessionId, now } = deps;
  const listeners = new Set<() => void>();
  const length = { current: deck.totalRows };
  let pending = 0;
  let queue: Promise<void> = Promise.resolve();

  // The song is back in the playlist, so it is no longer removed: drop any history
  // entry left over from a session that removed it, before it can be shown as
  // restorable or trigger a stale restoreFailed re-mark.
  forgetPresent(history, playlistId, deck.cards.map((card) => card.uri));

  let snapshot: SessionSnapshot = {
    session: initialSession(deck.cards),
    history: history.load(playlistId),
    skipped: deck.skipped,
    busy: false,
    error: null,
    authLost: false,
  };

  function update(patch: Partial<SessionSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }

  function dispatch(action: SessionAction) {
    update({ session: sessionReducer(snapshot.session, action) });
  }

  function fail(error: unknown) {
    update({ error: describeError(error), authLost: snapshot.authLost || error instanceof AuthError });
  }

  function enqueue(op: () => Promise<void>) {
    pending++;
    update({ busy: true });
    queue = queue
      .then(op)
      .catch(fail)
      .finally(() => {
        pending--;
        update({ busy: pending > 0 });
      });
  }

  async function restoreOnSpotify(uri: string) {
    await restoreEntry({ api, history, playlistId }, uri, length);
    update({ history: history.load(playlistId) });
  }

  async function restoreWithRollback(uri: string) {
    try {
      await restoreOnSpotify(uri);
    } catch (error) {
      dispatch({ type: 'restoreFailed', uri });
      throw error;
    }
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    keep() {
      const card = currentCard(snapshot.session);
      if (card) dispatch({ type: 'keep', uri: card.uri });
    },

    remove() {
      const card = currentCard(snapshot.session);
      if (!card) return;
      dispatch({ type: 'remove', uri: card.uri });
      // Recorded before the DELETE, so a reload or a lost response while the call is
      // in flight can't leave a removal that went through with no way to restore it.
      history.add(playlistId, {
        uri: card.uri,
        name: card.name,
        artists: card.artists,
        imageUrl: card.imageUrl,
        positions: card.positions,
        sessionId,
        removedAt: now(),
      });
      update({ history: history.load(playlistId) });
      enqueue(async () => {
        try {
          await api.removeItems(playlistId, [card.uri]);
        } catch (error) {
          dispatch({ type: 'removalFailed', uri: card.uri });
          const definiteRejection =
            error instanceof AuthError || (error instanceof ApiError && error.status >= 400 && error.status < 500);
          if (definiteRejection) {
            history.remove(playlistId, card.uri);
            update({ history: history.load(playlistId) });
            throw error;
          }
          // Ambiguous failure (network error, 5xx, or anything else): Spotify may have
          // applied the DELETE anyway, so keep the entry restorable and say so.
          throw new Error(
            `Couldn't confirm the removal of "${card.name}" — if it went through, you can restore it from History.`,
          );
        }
        length.current -= card.positions.length;
      });
    },

    undo() {
      // Undoing while a call is in flight could race it; the window is a few hundred ms.
      if (snapshot.busy) return;
      const last = snapshot.session.undoStack[snapshot.session.undoStack.length - 1];
      if (!last) return;
      dispatch({ type: 'undo' });
      if (last.decision === 'remove') enqueue(() => restoreWithRollback(last.uri));
    },

    restore(uri) {
      dispatch({ type: 'restored', uri });
      enqueue(() => restoreWithRollback(uri));
    },

    dismissError: () => update({ error: null }),

    async idle() {
      while (pending > 0) await queue;
    },
  };
}
