import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Card } from '../core/deck';
import type { SpotifyApi } from '../spotify/api';
import { ApiError } from '../spotify/errors';
import type { PlayerSnapshot, WebPlayer } from '../spotify/player';

export function usePlayerSnapshot(player: WebPlayer): PlayerSnapshot {
  return useSyncExternalStore(player.subscribe, player.getSnapshot);
}

/**
 * Plays `uri`, retrying once on 404. `isCurrent` turns false once the user has moved to
 * another card: the retry is then skipped so it can't start the previous card's song.
 */
export async function playWithRetry(
  api: Pick<SpotifyApi, 'play'>,
  deviceId: string,
  uri: string,
  positionMs = 0,
  isCurrent: () => boolean = () => true,
) {
  try {
    await api.play(deviceId, uri, positionMs);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
    // A freshly created SDK device can take a moment before the Web API knows it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!isCurrent()) return;
    await api.play(deviceId, uri, positionMs);
  }
}

/**
 * Plays the current card from 0:00 on this tab's device whenever the card changes,
 * pauses when there is nothing playable, and stops Spotify from drifting into other
 * songs (autoplay) after the card's song ends.
 */
export function useCardPlayback(
  player: WebPlayer,
  api: Pick<SpotifyApi, 'play'>,
  card: Card | null,
  started: boolean,
  onError: (error: unknown) => void,
) {
  const snap = usePlayerSnapshot(player);
  const playUri = card?.playUri ?? null;
  const playable = card?.isPlayable ?? false;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const lastSeenUri = useRef<string | null>(null);

  useEffect(() => {
    if (!started || !snap.deviceId) return;
    if (!playUri || !playable) {
      void player.pause();
      return;
    }
    let current = true;
    const isCurrent = () => current;
    playWithRetry(api, snap.deviceId, playUri, 0, isCurrent).catch((error: unknown) => {
      if (isCurrent()) onErrorRef.current(error);
    });
    return () => {
      current = false;
    };
  }, [started, snap.deviceId, playUri, playable, player, api]);

  useEffect(() => {
    // Our song was playing and Spotify moved on by itself: stop and wait for a swipe.
    if (lastSeenUri.current === playUri && snap.trackUri !== playUri && !snap.paused) void player.pause();
    lastSeenUri.current = snap.trackUri;
  }, [snap.trackUri, snap.paused, playUri, player]);

  const resumeHere = () => {
    if (!snap.deviceId || !playUri) return;
    playWithRetry(api, snap.deviceId, playUri, snap.positionMs).catch((error: unknown) => onErrorRef.current(error));
  };

  return { snap, resumeHere };
}
