import { useEffect, useMemo, useState } from 'react';
import { collectCards, type Card } from '../core/deck';
import { countRemoved, findDuplicates, planRemoval, type Duplicates } from '../core/duplicates';
import { forgetPresent, type HistoryStore } from '../core/historyStore';
import { LIKED_SONGS_ID, type PlaylistSummary } from '../core/playlists';
import { createDedupeRun, type DedupeController } from '../dedupe/controller';
import { useSnapshot } from '../hooks/useSnapshot';
import type { SpotifyApi } from '../spotify/api';
import { AuthError, describeError } from '../spotify/errors';
import { HistoryPanel } from './HistoryPanel';
import { Toast } from './Toast';

interface Props {
  playlist: PlaylistSummary;
  api: SpotifyApi;
  history: HistoryStore;
  onExit: () => void;
  onAuthLost: () => void;
}

interface Loaded {
  controller: DedupeController;
  found: Duplicates;
  totalRows: number;
  runId: string;
}

const COLLAPSED_ROWS = 3;

const duplicates = (count: number) => `${count} duplicate${count === 1 ? '' : 's'}`;

/** Loads the playlist and finds its duplicates, then hands a fresh run to DedupeView. */
export function DedupeScreen(props: Props) {
  const { playlist, api, history, onAuthLost, onExit } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    api.getPlaylistItems(playlist.id).then(
      (rows) => {
        if (cancelled) return;
        const { cards } = collectCards(rows);
        forgetPresent(history, playlist.id, cards.map((card) => card.uri));
        const runId = crypto.randomUUID();
        const controller = createDedupeRun({
          api,
          history,
          playlistId: playlist.id,
          runId,
          now: Date.now,
          playlistLength: rows.length,
        });
        setLoaded({ controller, found: findDuplicates(cards), totalRows: rows.length, runId });
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
  }, [api, history, playlist.id, attempt]);

  if (loadError) {
    return (
      <main className="center">
        <p className="error">{loadError}</p>
        <button onClick={onExit}>← Back to playlists</button>
      </main>
    );
  }
  if (!loaded) return <main className="center muted">Loading songs…</main>;
  return (
    <DedupeView
      key={loaded.runId}
      {...props}
      {...loaded}
      banner={banner}
      onUndone={(count) => {
        setBanner(`Put back ${duplicates(count)}.`);
        setAttempt((n) => n + 1);
      }}
    />
  );
}

function DedupeView({
  playlist,
  controller,
  found,
  totalRows,
  runId,
  banner,
  onExit,
  onAuthLost,
  onUndone,
}: Props & Loaded & { banner: string | null; onUndone: (count: number) => void }) {
  const snap = useSnapshot(controller);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllCopies, setShowAllCopies] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const foundCount = useMemo(() => countRemoved(planRemoval(found, new Set())), [found]);
  const ops = useMemo(() => planRemoval(found, unticked), [found, unticked]);
  const selected = countRemoved(ops);

  useEffect(() => {
    if (snap.authLost) onAuthLost();
  }, [snap.authLost]);

  useEffect(() => {
    if (snap.phase === 'undone') onUndone(snap.total);
  }, [snap.phase]);

  useEffect(() => {
    // A Spotify call is in flight: warn before the tab closes mid-run.
    if (!snap.busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [snap.busy]);

  const toggle = (key: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const overlays = (
    <>
      {showHistory && (
        <HistoryPanel
          entries={snap.history}
          sessionId={runId}
          note={
            playlist.id === LIKED_SONGS_ID
              ? 'Restoring re-likes the song — it goes to the top of Liked Songs.'
              : undefined
          }
          onRestore={(uri) => controller.restore(uri)}
          onClose={() => setShowHistory(false)}
        />
      )}
      {snap.error && !(snap.phase === 'partial' && snap.failedName) && (
        <Toast message={snap.error} onDismiss={() => controller.dismissError()} />
      )}
    </>
  );

  if (snap.phase === 'review') {
    const copies = showAllCopies ? found.exact : found.exact.slice(0, COLLAPSED_ROWS);
    const extraCopies = found.exact.reduce((count, e) => count + e.remove.length, 0);
    return (
      <main className="dedupe">
        <button className="link" onClick={onExit} disabled={snap.busy}>
          ← Playlists
        </button>
        <h1>{playlist.name}</h1>
        <p className="muted">
          {totalRows} songs{foundCount > 0 && ` · ${duplicates(foundCount)} found`}
        </p>
        {banner && <p className="banner">{banner}</p>}
        {foundCount === 0 ? (
          <div className="empty">
            <h2>No duplicates in {playlist.name}</h2>
            <p className="muted">Every song appears once.</p>
            <button className="primary" onClick={onExit}>
              Back to playlists
            </button>
          </div>
        ) : (
          <>
            {found.exact.length > 0 && (
              <section>
                <h2>
                  Exact copies · {extraCopies}
                  <span className="muted">Untick a song to keep all its copies</span>
                </h2>
                {copies.map((e) => {
                  const on = !unticked.has(e.key);
                  const total = e.card.positions.length;
                  return (
                    <DuplicateRow
                      key={e.key}
                      card={e.card}
                      checked={on}
                      onToggle={() => toggle(e.key)}
                      detail={e.card.artists.join(', ')}
                      count={on ? `${total} copies · removes ${e.remove.length}` : `keeps all ${total}`}
                    />
                  );
                })}
                {!showAllCopies && found.exact.length > COLLAPSED_ROWS && (
                  <button className="link" onClick={() => setShowAllCopies(true)}>
                    Show {found.exact.length - COLLAPSED_ROWS} more
                  </button>
                )}
              </section>
            )}
            {found.otherReleases.length > 0 && (
              <section>
                <h2>
                  Same song, other release · {found.otherReleases.length}
                  <span className="muted">The copy highest in the playlist stays</span>
                </h2>
                {found.otherReleases.map((r) => {
                  const on = !unticked.has(r.key);
                  const what = on ? `removes “${r.card.album}”, keeps “${r.kept.album}”` : 'keeps both releases';
                  return (
                    <DuplicateRow
                      key={r.key}
                      card={r.card}
                      checked={on}
                      onToggle={() => toggle(r.key)}
                      detail={`${r.card.artists.join(', ')} · ${what}`}
                    />
                  );
                })}
              </section>
            )}
            <footer>
              <button className="primary" disabled={selected === 0 || snap.busy} onClick={() => controller.start(ops)}>
                {selected === 0 ? 'Nothing selected' : `Remove ${duplicates(selected)}`}
              </button>
              <span className="muted">
                You can undo right after. Other-release removals can also be restored from History.
              </span>
            </footer>
          </>
        )}
        {overlays}
      </main>
    );
  }

  if (snap.phase === 'removing' || snap.phase === 'undoing' || snap.phase === 'undone') {
    const percent = snap.total ? Math.round((snap.done / snap.total) * 100) : 0;
    return (
      <main className="center">
        <button className="link" onClick={onExit} disabled>
          ← Playlists
        </button>
        <h2>{snap.phase === 'removing' ? 'Removing duplicates…' : 'Putting duplicates back…'}</h2>
        <div className="progress">
          <div style={{ width: `${percent}%` }} />
        </div>
        <p className="muted">
          {snap.done} / {snap.total}
        </p>
        <p className="muted hint">Keep this tab open until it's done.</p>
        {overlays}
      </main>
    );
  }

  const partial = snap.phase === 'partial';
  return (
    <main className="center">
      <h2>{partial ? `Removed ${snap.done} of ${snap.total}` : `Removed ${duplicates(snap.done)}`}</h2>
      {partial && snap.failedName ? (
        <p className="error-box">
          Couldn't remove “{snap.failedName}”: {snap.error?.replace(/\.$/, '')}. Nothing was lost.
        </p>
      ) : (
        <p className="muted">
          {playlist.name} now has {snap.length} songs.
        </p>
      )}
      <div className="row">
        {partial && (
          <button onClick={() => controller.retry()} disabled={snap.busy}>
            Try the rest again
          </button>
        )}
        {snap.canUndo && (
          <button onClick={() => controller.undo()} disabled={snap.busy}>
            ↩ {partial ? `Undo the ${snap.removed}` : 'Undo'}
          </button>
        )}
        <button onClick={() => setShowHistory(true)}>History ({snap.history.length})</button>
        <button className="primary" onClick={onExit} disabled={snap.busy}>
          Back to playlists
        </button>
      </div>
      {overlays}
    </main>
  );
}

function DuplicateRow({
  card,
  checked,
  detail,
  count,
  onToggle,
}: {
  card: Card;
  checked: boolean;
  detail: string;
  count?: string;
  onToggle: () => void;
}) {
  return (
    <label className={checked ? 'dup-row' : 'dup-row off'}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {card.imageUrl ? <img src={card.imageUrl} alt="" /> : <div className="no-art small">♪</div>}
      <div className="grow">
        <strong>{card.name}</strong>
        <span className="muted">{detail}</span>
      </div>
      {count && <span className="muted count">{count}</span>}
    </label>
  );
}
