import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (payload: unknown) => void;

/** Stand-in for the SDK's Spotify.Player, recording listeners and calls. */
class FakePlayer {
  static instances: FakePlayer[] = [];
  listeners = new Map<string, Listener>();
  connect = vi.fn(async () => true);
  disconnect = vi.fn();
  activateElement = vi.fn(async () => {});
  togglePlay = vi.fn(async () => {});
  pause = vi.fn(async () => {});
  seek = vi.fn(async (_ms: number) => {});

  constructor(readonly options: { getOAuthToken: (cb: (token: string) => void) => void }) {
    FakePlayer.instances.push(this);
  }

  addListener(event: string, listener: Listener) {
    this.listeners.set(event, listener);
    return true;
  }

  emit(event: string, payload?: unknown) {
    this.listeners.get(event)!(payload);
  }
}

let scripts: { src: string; onerror: (() => void) | null; remove: () => void }[];
let win: { Spotify?: { Player: typeof FakePlayer }; onSpotifyWebPlaybackSDKReady?: () => void };

beforeEach(() => {
  vi.resetModules(); // player.ts caches the SDK load per module instance
  FakePlayer.instances = [];
  scripts = [];
  win = {};
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    createElement: () => {
      const script = { src: '', async: false, onerror: null, remove: () => scripts.splice(scripts.indexOf(script), 1) };
      return script;
    },
    body: { appendChild: (script: (typeof scripts)[number]) => scripts.push(script) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function createLoaded(getToken = async () => 'token') {
  win.Spotify = { Player: FakePlayer };
  const { createWebPlayer } = await import('./player');
  const player = createWebPlayer(getToken);
  await flush();
  return { player, sdk: FakePlayer.instances[0] };
}

describe('createWebPlayer', () => {
  it('loads the SDK script once for several players', async () => {
    const { createWebPlayer } = await import('./player');
    createWebPlayer(async () => 't');
    createWebPlayer(async () => 't');
    expect(scripts.map((s) => s.src)).toEqual(['https://sdk.scdn.co/spotify-player.js']);
    win.Spotify = { Player: FakePlayer };
    win.onSpotifyWebPlaybackSDKReady!();
    await flush();
    expect(FakePlayer.instances).toHaveLength(2);
    expect(FakePlayer.instances.every((p) => p.connect.mock.calls.length === 1)).toBe(true);
  });

  it('uses an SDK that is already loaded without adding a script', async () => {
    const { sdk } = await createLoaded();
    expect(scripts).toEqual([]);
    expect(sdk.connect).toHaveBeenCalled();
  });

  it('reports a failed SDK load, and the next player tries again', async () => {
    const { createWebPlayer } = await import('./player');
    const first = createWebPlayer(async () => 't');
    scripts[0].onerror!();
    await flush();
    expect(first.getSnapshot().error).toBe('Could not load the Spotify player.');
    expect(scripts).toEqual([]);

    createWebPlayer(async () => 't');
    expect(scripts).toHaveLength(1);
  });

  it('does not create a player when disconnected before the SDK loaded', async () => {
    const { createWebPlayer } = await import('./player');
    const player = createWebPlayer(async () => 't');
    player.disconnect();
    win.Spotify = { Player: FakePlayer };
    win.onSpotifyWebPlaybackSDKReady!();
    await flush();
    expect(FakePlayer.instances).toEqual([]);
  });

  it('tracks readiness and the device id', async () => {
    const { player, sdk } = await createLoaded();
    sdk.emit('ready', { device_id: 'dev-1' });
    expect(player.getSnapshot()).toMatchObject({ deviceId: 'dev-1', ready: true });
    sdk.emit('not_ready', { device_id: 'dev-1' });
    expect(player.getSnapshot().ready).toBe(false);
  });

  it('maps playback state', async () => {
    const { player, sdk } = await createLoaded();
    sdk.emit('player_state_changed', {
      paused: false,
      position: 1200,
      duration: 180_000,
      track_window: { current_track: { uri: 'spotify:track:a' } },
    });
    expect(player.getSnapshot()).toMatchObject({
      paused: false,
      positionMs: 1200,
      durationMs: 180_000,
      trackUri: 'spotify:track:a',
      movedAway: false,
    });
  });

  it('only reports playback as moved away after this tab was playing', async () => {
    const { player, sdk } = await createLoaded();
    sdk.emit('player_state_changed', null);
    expect(player.getSnapshot().movedAway).toBe(false);
    sdk.emit('player_state_changed', { paused: false, position: 0, duration: 1, track_window: { current_track: null } });
    sdk.emit('player_state_changed', null);
    expect(player.getSnapshot()).toMatchObject({ movedAway: true, paused: true });
  });

  it.each([
    ['initialization_error', { message: 'no EME' }, "This browser can't play Spotify here: no EME"],
    ['authentication_error', { message: 'x' }, 'Your Spotify login expired — please reconnect.'],
    ['account_error', { message: 'x' }, 'In-browser playback needs Spotify Premium.'],
    ['playback_error', { message: 'boom' }, 'Playback error: boom'],
  ])('turns %s into a readable error', async (event, payload, message) => {
    const { player, sdk } = await createLoaded();
    sdk.emit(event, payload);
    expect(player.getSnapshot().error).toBe(message);
  });

  it('hands the SDK a token, or reports a lost login', async () => {
    const { sdk } = await createLoaded(async () => 'the-token');
    const callback = vi.fn();
    sdk.options.getOAuthToken(callback);
    await flush();
    expect(callback).toHaveBeenCalledWith('the-token');

    const failing = await createLoaded(async () => {
      throw new Error('no login');
    });
    const failingSdk = FakePlayer.instances[1];
    const never = vi.fn();
    failingSdk.options.getOAuthToken(never);
    await flush();
    expect(never).not.toHaveBeenCalled();
    expect(failing.player.getSnapshot().error).toMatch(/login expired/);
  });

  it('notifies subscribers until they unsubscribe', async () => {
    const { player, sdk } = await createLoaded();
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);
    sdk.emit('ready', { device_id: 'd' });
    unsubscribe();
    sdk.emit('not_ready', { device_id: 'd' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('passes controls through to the SDK player', async () => {
    const { player, sdk } = await createLoaded();
    await player.activate();
    await player.togglePlay();
    await player.pause();
    await player.seek(5000);
    player.disconnect();
    expect(sdk.activateElement).toHaveBeenCalled();
    expect(sdk.togglePlay).toHaveBeenCalled();
    expect(sdk.pause).toHaveBeenCalled();
    expect(sdk.seek).toHaveBeenCalledWith(5000);
    expect(sdk.disconnect).toHaveBeenCalled();
  });
});
