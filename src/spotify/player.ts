export interface PlayerSnapshot {
  deviceId: string | null;
  ready: boolean;
  paused: boolean;
  /** Position at `updatedAt`; interpolate while playing. */
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  trackUri: string | null;
  /** Playback was taken over by another Spotify device. */
  movedAway: boolean;
  error: string | null;
}

export interface WebPlayer {
  getSnapshot(): PlayerSnapshot;
  subscribe(listener: () => void): () => void;
  /** Must be called from a click handler: unlocks audio in the browser. */
  activate(): Promise<void>;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  disconnect(): void;
}

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
let sdkLoaded: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  sdkLoaded ??= new Promise<void>((resolve, reject) => {
    if (window.Spotify) {
      resolve();
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      // Forget the failure so the next player (e.g. after reconnecting) tries again.
      sdkLoaded = null;
      script.remove();
      reject(new Error('Could not load the Spotify player.'));
    };
    document.body.appendChild(script);
  });
  return sdkLoaded;
}

/** Turns this browser tab into a Spotify Connect device named "Swipify". */
export function createWebPlayer(getToken: () => Promise<string>): WebPlayer {
  const listeners = new Set<() => void>();
  let player: Spotify.Player | null = null;
  let wasActive = false;
  let disposed = false;
  let snapshot: PlayerSnapshot = {
    deviceId: null,
    ready: false,
    paused: true,
    positionMs: 0,
    durationMs: 0,
    updatedAt: Date.now(),
    trackUri: null,
    movedAway: false,
    error: null,
  };

  function update(patch: Partial<PlayerSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }

  loadSdk().then(
    () => {
      if (disposed) return;
      player = new window.Spotify.Player({
        name: 'Swipify',
        volume: 0.8,
        getOAuthToken: (callback) => {
          getToken().then(callback, () => update({ error: 'Your Spotify login expired — please reconnect.' }));
        },
      });
      player.addListener('ready', ({ device_id }) => update({ deviceId: device_id, ready: true }));
      player.addListener('not_ready', () => update({ ready: false }));
      player.addListener('player_state_changed', (state) => {
        if (!state) {
          // Null state: this tab is no longer the active Spotify device.
          update({ paused: true, movedAway: wasActive });
          return;
        }
        wasActive = true;
        update({
          paused: state.paused,
          positionMs: state.position,
          durationMs: state.duration,
          updatedAt: Date.now(),
          trackUri: state.track_window.current_track?.uri ?? null,
          movedAway: false,
        });
      });
      player.addListener('initialization_error', ({ message }) =>
        update({ error: `This browser can't play Spotify here: ${message}` }),
      );
      player.addListener('authentication_error', () =>
        update({ error: 'Your Spotify login expired — please reconnect.' }),
      );
      player.addListener('account_error', () => update({ error: 'In-browser playback needs Spotify Premium.' }));
      player.addListener('playback_error', ({ message }) => update({ error: `Playback error: ${message}` }));
      void player.connect();
    },
    (error: Error) => {
      if (!disposed) update({ error: error.message });
    },
  );

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate: async () => {
      await player?.activateElement();
    },
    togglePlay: async () => {
      await player?.togglePlay();
    },
    pause: async () => {
      await player?.pause();
    },
    seek: async (ms) => {
      await player?.seek(ms);
    },
    disconnect: () => {
      disposed = true;
      listeners.clear();
      player?.disconnect();
    },
  };
}
