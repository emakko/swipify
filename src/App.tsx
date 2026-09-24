import { useEffect, useState } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { PlaylistPicker } from './components/PlaylistPicker';
import type { PlaylistSummary } from './core/playlists';
import { createApi } from './spotify/api';
import { createAuth } from './spotify/auth';
import { createWebPlayer, type WebPlayer } from './spotify/player';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? '';

const auth = createAuth({
  clientId: CLIENT_ID,
  redirectUri: `${window.location.origin}/callback`,
  storage: window.localStorage,
  fetch: (input, init) => window.fetch(input, init),
  now: Date.now,
  navigate: (url) => window.location.assign(url),
});

const api = createApi({
  getAccessToken: () => auth.getAccessToken(),
  forceRefresh: () => auth.forceRefresh(),
  fetch: (input, init) => window.fetch(input, init),
});

type Screen =
  | { name: 'loading' }
  | { name: 'connect'; error?: string }
  | { name: 'picker' }
  | { name: 'swipe'; playlist: PlaylistSummary };

const isCallback = window.location.pathname === '/callback';

export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    isCallback ? { name: 'loading' } : auth.isLoggedIn() ? { name: 'picker' } : { name: 'connect' },
  );
  const [player, setPlayer] = useState<WebPlayer | null>(null);

  useEffect(() => {
    if (!isCallback) return;
    auth
      .handleCallback(window.location.search)
      .then(
        () => setScreen({ name: 'picker' }),
        (e: unknown) => setScreen({ name: 'connect', error: e instanceof Error ? e.message : String(e) }),
      )
      .finally(() => window.history.replaceState(null, '', '/'));
  }, []);

  const loggedIn = screen.name === 'picker' || screen.name === 'swipe';
  useEffect(() => {
    // Create the player as soon as we are logged in so it is ready by the time a playlist loads.
    if (loggedIn && !player) setPlayer(createWebPlayer(() => auth.getAccessToken()));
  }, [loggedIn, player]);

  const logout = (error?: string) => {
    auth.logout();
    player?.disconnect();
    setPlayer(null);
    setScreen({ name: 'connect', error });
  };
  const onAuthLost = () => logout('Your Spotify login expired — please reconnect.');

  switch (screen.name) {
    case 'loading':
      return <main className="center muted">Connecting to Spotify…</main>;
    case 'connect':
      return <ConnectScreen clientIdMissing={!CLIENT_ID} error={screen.error} onConnect={() => void auth.login()} />;
    case 'picker':
      return (
        <PlaylistPicker
          api={api}
          onPick={(playlist) => setScreen({ name: 'swipe', playlist })}
          onAuthLost={onAuthLost}
          onLogout={() => logout()}
        />
      );
    case 'swipe':
      return <main className="center muted">Loading {screen.playlist.name}…</main>;
  }
}
