import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { editablePlaylists, LIKED_SONGS_ID, type PlaylistSummary } from '../core/playlists';
import type { SpotifyApi } from '../spotify/api';
import { AuthError, describeError } from '../spotify/errors';
import { Loading } from './Loading';

export type Mode = 'swipe' | 'dedupe';

const MODE_HINTS: Record<Mode, string> = {
  swipe: 'Songs play in random order: swipe right to keep, left to remove.',
  dedupe: 'Keeps the first copy of every song and removes the rest.',
};

interface Props {
  api: SpotifyApi;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onPick: (playlist: PlaylistSummary) => void;
  onAuthLost: () => void;
  onLogout: () => void;
}

export function PlaylistPicker({ api, mode, onModeChange, onPick, onAuthLost, onLogout }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [likedTotal, setLikedTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const segRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // Slide the highlight under the active mode. It first renders already in place, so it only animates on a switch.
  useLayoutEffect(() => {
    const active = segRef.current?.querySelector<HTMLElement>('button.on');
    if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([api.getMe(), api.getMyPlaylists()]).then(
      ([me, all]) => {
        if (!cancelled) setPlaylists(editablePlaylists(all, me.id));
      },
      (e: unknown) => {
        if (cancelled) return;
        if (e instanceof AuthError) onAuthLost();
        else setError(describeError(e));
      },
    );
    // Only the count; if it fails, opening Liked Songs shows the real error.
    api.getLikedSongsTotal().then(
      (total) => {
        if (!cancelled) setLikedTotal(total);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // onAuthLost is recreated on every App render; depending on it would reload in a loop.
  }, [api, attempt]);

  const liked: PlaylistSummary = {
    id: LIKED_SONGS_ID,
    name: 'Liked Songs',
    imageUrl: null,
    total: likedTotal ?? 0,
    ownerId: '',
    collaborative: false,
  };

  return (
    <main className="picker">
      <header>
        <div className="heading">
          <h1>Pick a playlist</h1>
          <div className="seg" role="group" aria-label="Mode" ref={segRef}>
            {pill && <span className="seg-pill" aria-hidden="true" style={{ width: pill.width, transform: `translateX(${pill.left}px)` }} />}
            <button className={mode === 'swipe' ? 'on' : ''} aria-pressed={mode === 'swipe'} onClick={() => onModeChange('swipe')}>
              Swipe
            </button>
            <button className={mode === 'dedupe' ? 'on' : ''} aria-pressed={mode === 'dedupe'} onClick={() => onModeChange('dedupe')}>
              Remove duplicates
            </button>
          </div>
        </div>
        <button className="link" onClick={onLogout}>
          Log out
        </button>
      </header>
      <p className="muted mode-hint">{MODE_HINTS[mode]}</p>
      {error && (
        <p className="error">
          {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!error && !playlists && <Loading>Loading your playlists…</Loading>}
      {playlists?.length === 0 && <p className="muted">You don't own or collaborate on any playlists yet.</p>}
      {playlists && (
        <div className="grid">
          <button className="tile" onClick={() => onPick(liked)}>
            <div className="no-art liked">♥</div>
            <strong>Liked Songs</strong>
            <span className="muted">{likedTotal === null ? 'Your saved songs' : `${likedTotal} songs`}</span>
          </button>
          {playlists.map((playlist) => (
            <button key={playlist.id} className="tile" onClick={() => onPick(playlist)}>
              {playlist.imageUrl ? <img src={playlist.imageUrl} alt="" /> : <div className="no-art">♪</div>}
              <strong>{playlist.name}</strong>
              <span className="muted">{playlist.total} songs</span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
