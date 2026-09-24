import { useEffect, useState } from 'react';
import { ConnectScreen } from './components/ConnectScreen';
import { DedupeScreen } from './components/DedupeScreen';
import { Loading } from './components/Loading';
import { PlaylistPicker, type Mode } from './components/PlaylistPicker';
import { SwipeScreen } from './components/SwipeScreen';
import { createHistoryStore } from './core/historyStore';
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

const history = createHistoryStore(safeLocalStorage());

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const MODE_KEY = 'swipify:mode';

function loadMode(): Mode {
  try {
    return safeLocalStorage()?.getItem(MODE_KEY) === 'dedupe' ? 'dedupe' : 'swipe';
  } catch {
    return 'swipe';
  }
}

type Screen =
  | { name: 'loading' }
  | { name: 'connect'; error?: string }
  | { name: 'picker' }
  | { name: 'swipe'; playlist: PlaylistSummary }
  | { name: 'dedupe'; playlist: PlaylistSummary };

const isCallback = window.location.pathname === '/callback';

export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    isCallback
      ? { name: 'loading' }
      : auth.isLoggedIn()
        ? { name: 'picker' }
        : { name: 'connect', error: auth.needsNewScopes() ? 'Reconnect to give access to Liked Songs.' : undefined },
  );
  const [player, setPlayer] = useState<WebPlayer | null>(null);
  const [mode, setMode] = useState<Mode>(loadMode);
  const changeMode = (next: Mode) => {
    setMode(next);
    try {
      safeLocalStorage()?.setItem(MODE_KEY, next);
    } catch {
      // Storage full or blocked: the mode lasts until the page reloads.
    }
  };

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

  const loggedIn = screen.name === 'picker' || screen.name === 'swipe' || screen.name === 'dedupe';
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
      return (
        <main className="center">
          <Loading>Connecting to Spotify…</Loading>
        </main>
      );
    case 'connect':
      return <ConnectScreen clientIdMissing={!CLIENT_ID} error={screen.error} onConnect={() => void auth.login()} />;
    case 'picker':
      return (
        <PlaylistPicker
          api={api}
          mode={mode}
          onModeChange={changeMode}
          onPick={(playlist) => setScreen(mode === 'swipe' ? { name: 'swipe', playlist } : { name: 'dedupe', playlist })}
          onAuthLost={onAuthLost}
          onLogout={() => logout()}
        />
      );
    case 'swipe':
      if (!player) return <main className="center muted">Connecting player…</main>;
      return (
        <SwipeScreen
          key={screen.playlist.id}
          playlist={screen.playlist}
          api={api}
          player={player}
          history={history}
          onExit={() => setScreen({ name: 'picker' })}
          onAuthLost={onAuthLost}
        />
      );
    case 'dedupe':
      return (
        <DedupeScreen
          key={screen.playlist.id}
          playlist={screen.playlist}
          api={api}
          history={history}
          onExit={() => setScreen({ name: 'picker' })}
          onAuthLost={onAuthLost}
        />
      );
  }
}
