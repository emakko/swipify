import { useEffect, useState } from 'react';
import { editablePlaylists, type PlaylistSummary } from '../core/playlists';
import type { SpotifyApi } from '../spotify/api';
import { AuthError, describeError } from '../spotify/errors';

interface Props {
  api: SpotifyApi;
  onPick: (playlist: PlaylistSummary) => void;
  onAuthLost: () => void;
  onLogout: () => void;
}

export function PlaylistPicker({ api, onPick, onAuthLost, onLogout }: Props) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
    return () => {
      cancelled = true;
    };
    // onAuthLost is recreated on every App render; depending on it would reload in a loop.
  }, [api, attempt]);

  return (
    <main className="picker">
      <header>
        <h1>Pick a playlist</h1>
        <button className="link" onClick={onLogout}>
          Log out
        </button>
      </header>
      {error && (
        <p className="error">
          {error} <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!error && !playlists && <p className="muted">Loading your playlists…</p>}
      {playlists?.length === 0 && <p className="muted">You don't own or collaborate on any playlists yet.</p>}
      {playlists && playlists.length > 0 && (
        <div className="grid">
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
