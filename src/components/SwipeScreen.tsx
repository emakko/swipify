import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { buildDeck } from '../core/deck';
import type { HistoryStore } from '../core/historyStore';
import { LIKED_SONGS_ID, type PlaylistSummary } from '../core/playlists';
import { currentCard, sessionCounts } from '../core/session';
import { useCardPlayback } from '../hooks/usePlayer';
import { useSnapshot } from '../hooks/useSnapshot';
import { createSession, type SessionController } from '../session/controller';
import type { SpotifyApi } from '../spotify/api';
import { AuthError, describeError } from '../spotify/errors';
import type { WebPlayer } from '../spotify/player';
import { DoneScreen } from './DoneScreen';
import { HistoryPanel } from './HistoryPanel';
import { PlayerControls } from './PlayerControls';
import { SwipeCard, type SwipeDirection } from './SwipeCard';
import { Toast } from './Toast';

interface Props {
  playlist: PlaylistSummary;
  api: SpotifyApi;
  player: WebPlayer;
  history: HistoryStore;
  onExit: () => void;
  onAuthLost: () => void;
}

/** Loads the playlist, then hands a fresh session to SwipeView. */
export function SwipeScreen(props: Props) {
  const { playlist, api, history, onAuthLost, onExit } = props;
  const [loaded, setLoaded] = useState<{ controller: SessionController; sessionId: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPlaylistItems(playlist.id).then(
      (rows) => {
        if (cancelled) return;
        const sessionId = crypto.randomUUID();
        const controller = createSession(
          { api, history, playlistId: playlist.id, sessionId, now: Date.now },
          buildDeck(rows),
        );
        setLoaded({ controller, sessionId });
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof AuthError) onAuthLost();
        else setLoadError(describeError(e));
      },
    );
    return () => {
      cancelled = true;
    };
    // onAuthLost is recreated on every App render; depending on it would reload in a loop.
  }, [api, history, playlist.id]);

  if (loadError) {
    return (
      <main className="center">
        <p className="error">{loadError}</p>
        <button onClick={onExit}>← Back to playlists</button>
      </main>
    );
  }
  if (!loaded) return <main className="center muted">Loading songs…</main>;
  return <SwipeView {...props} controller={loaded.controller} sessionId={loaded.sessionId} />;
}

function SwipeView({
  playlist,
  api,
  player,
  onExit,
  onAuthLost,
  controller,
  sessionId,
}: Props & { controller: SessionController; sessionId: string }) {
  const snap = useSnapshot(controller);
  const card = currentCard(snap.session);
  const counts = sessionCounts(snap.session);
  const [started, setStarted] = useState(false);
  const [direction, setDirection] = useState<SwipeDirection>('keep');
  const [showHistory, setShowHistory] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const { snap: playerSnap, resumeHere } = useCardPlayback(player, api, card, started, (e) => {
    if (e instanceof AuthError) onAuthLost();
    else setPlayError(describeError(e));
  });

  useEffect(() => {
    if (snap.authLost) onAuthLost();
  }, [snap.authLost]);

  useEffect(() => {
    // A Spotify call is in flight: warn before the tab closes so a removal that went
    // through doesn't lose its history entry to an unfinished write.
    if (!snap.busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [snap.busy]);

  const swipe = useCallback(
    (next: SwipeDirection) => {
      setDirection(next);
      if (next === 'keep') controller.keep();
      else controller.remove();
    },
    [controller],
  );

  useEffect(() => {
    if (!started) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      // While the History panel is open it can cover the card at narrow widths, so
      // ←/→ must not remove or keep a song the user can't see. Undo and Space still work.
      if (e.key === 'ArrowRight') {
        if (!showHistory) swipe('keep');
      } else if (e.key === 'ArrowLeft') {
        if (!showHistory) swipe('remove');
      } else if (e.key === ' ') {
        e.preventDefault();
        // Only the current card's own playback should toggle: on an unplayable card or
        // the Done screen the SDK still holds the previous track, so togglePlay would
        // resume that instead.
        if (card?.isPlayable) void player.togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        controller.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, swipe, player, controller, card, showHistory]);

  const dismissError = useCallback(() => {
    controller.dismissError();
    setPlayError(null);
  }, [controller]);

  const exit = () => {
    void player.pause();
    onExit();
  };
  const canUndo = !snap.busy && snap.session.undoStack.length > 0;
  const error = snap.error ?? playError;

  if (!started) {
    return (
      <main className="center intro">
        <button className="link back" onClick={exit} disabled={snap.busy}>
          ← Playlists
        </button>
        <h1>{playlist.name}</h1>
        <p className="muted">
          {counts.total} songs
          {snap.skipped > 0 && ` · ${snap.skipped} skipped (local files or podcasts)`}
        </p>
        {playerSnap.error && <p className="error">{playerSnap.error}</p>}
        <button
          className="primary"
          disabled={!playerSnap.ready}
          onClick={() => {
            void player.activate(); // must run inside the click to unlock audio
            setStarted(true);
          }}
        >
          {playerSnap.ready ? 'Start swiping' : 'Connecting player…'}
        </button>
      </main>
    );
  }

  return (
    <main className="swipe">
      <header className="topbar">
        <button className="link" onClick={exit} disabled={snap.busy}>
          ← Playlists
        </button>
        <span className="title">{playlist.name}</span>
        <span className="muted">{card ? `${Math.min(counts.decided + 1, counts.total)} / ${counts.total}` : ''}</span>
        <button className="link" onClick={() => setShowHistory(true)}>
          History ({snap.history.length})
        </button>
      </header>

      <section className="stack">
        <AnimatePresence custom={direction}>
          {card && <SwipeCard key={card.uri} card={card} direction={direction} onSwipe={swipe} />}
        </AnimatePresence>
        {!card && (
          <DoneScreen
            kept={counts.kept}
            removed={counts.removed}
            skipped={snap.skipped}
            canUndo={canUndo}
            busy={snap.busy}
            onUndo={() => controller.undo()}
            onShowHistory={() => setShowHistory(true)}
            onPickAnother={exit}
          />
        )}
      </section>

      {card && (
        <>
          {playerSnap.error && <p className="error">{playerSnap.error}</p>}
          {playerSnap.movedAway && (
            <p className="banner">
              Playback moved to another device.{' '}
              <button className="link" onClick={resumeHere}>
                Resume here
              </button>
            </p>
          )}
          {card.isPlayable && <PlayerControls key={card.uri} player={player} />}
          <div className="actions">
            <button
              className="action remove"
              aria-label="Remove (←)"
              onClick={(e) => {
                e.currentTarget.blur();
                swipe('remove');
              }}
            >
              ✕
            </button>
            <button
              className="action undo"
              aria-label="Undo (Ctrl+Z)"
              disabled={!canUndo}
              onClick={(e) => {
                e.currentTarget.blur();
                controller.undo();
              }}
            >
              ↩
            </button>
            <button
              className="action keep"
              aria-label="Keep (→)"
              onClick={(e) => {
                e.currentTarget.blur();
                swipe('keep');
              }}
            >
              ♥
            </button>
          </div>
          <p className="hint muted">← remove · → keep · Space play/pause · Ctrl+Z undo</p>
        </>
      )}

      {showHistory && (
        <HistoryPanel
          entries={snap.history}
          sessionId={sessionId}
          note={
            playlist.id === LIKED_SONGS_ID
              ? 'Restoring re-likes the song — it goes to the top of Liked Songs.'
              : undefined
          }
          onRestore={(uri) => controller.restore(uri)}
          onClose={() => setShowHistory(false)}
        />
      )}
      {error && <Toast message={error} onDismiss={dismissError} />}
    </main>
  );
}
