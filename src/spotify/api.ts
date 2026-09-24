import type { RawItem, RawPlaylistRow } from '../core/deck';
import { LIKED_SONGS_ID, type PlaylistSummary } from '../core/playlists';
import { ApiError, AuthError } from './errors';

const BASE = 'https://api.spotify.com/v1';
const MAX_RATE_LIMIT_RETRIES = 3;

export interface ApiDeps {
  getAccessToken: () => Promise<string>;
  forceRefresh: () => Promise<string>;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface SpotifyApi {
  getMe(): Promise<{ id: string; displayName: string | null }>;
  getMyPlaylists(): Promise<PlaylistSummary[]>;
  getLikedSongsTotal(): Promise<number>;
  /** `LIKED_SONGS_ID` reads, un-likes and re-likes Liked Songs instead of a playlist. */
  getPlaylistItems(playlistId: string): Promise<RawPlaylistRow[]>;
  removeItems(playlistId: string, uris: string[]): Promise<void>;
  addItems(playlistId: string, uris: string[], position: number): Promise<void>;
  play(deviceId: string, uri: string, positionMs?: number): Promise<void>;
}

interface Page<T> {
  items: T[];
  next: string | null;
  total?: number;
}

interface RawPlaylist {
  id: string;
  name: string;
  collaborative: boolean;
  owner: { id: string };
  images: { url: string }[] | null;
  items?: { total: number };
  /** Deprecated since February 2026; kept as a fallback. */
  tracks?: { total: number };
}

interface RawRow {
  is_local: boolean;
  item?: RawItem | null;
  /** Deprecated since February 2026; kept as a fallback. */
  track?: RawItem | null;
}

export function createApi(deps: ApiDeps): SpotifyApi {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    const isAbsolute = pathOrUrl.startsWith('https://');
    if (isAbsolute && !pathOrUrl.startsWith(BASE)) {
      // Never send the bearer token to a host other than Spotify's API — a paginated
      // `next` link is server-supplied and must not be trusted blindly.
      throw new ApiError(0, 'Unexpected URL from Spotify');
    }
    const url = isAbsolute ? pathOrUrl : BASE + pathOrUrl;
    let token = await deps.getAccessToken();
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const res = await deps.fetch(url, {
        method,
        headers:
          body === undefined
            ? { Authorization: `Bearer ${token}` }
            : { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (res.status === 401) {
        if (refreshed) throw new AuthError();
        token = await deps.forceRefresh();
        refreshed = true;
        continue;
      }
      if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep((Number(res.headers.get('Retry-After')) || 1) * 1000);
        continue;
      }

      const text = await res.text();
      if (!res.ok) throw new ApiError(res.status, spotifyMessage(text) ?? res.statusText);
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  async function getAll<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    let next: string | null = path;
    while (next) {
      const page: Page<T> = await request<Page<T>>('GET', next);
      all.push(...page.items);
      next = page.next;
    }
    return all;
  }

  const playlistPath = (playlistId: string) => `/playlists/${encodeURIComponent(playlistId)}/items`;
  // Spotify takes library URIs in the query string, not the body.
  const libraryPath = (uris: string[]) => `/me/library?uris=${uris.map(encodeURIComponent).join(',')}`;

  return {
    async getMe() {
      const me = await request<{ id: string; display_name: string | null }>('GET', '/me');
      return { id: me.id, displayName: me.display_name };
    },

    async getMyPlaylists() {
      const playlists = await getAll<RawPlaylist>('/me/playlists?limit=50');
      return playlists.map((p) => ({
        id: p.id,
        name: p.name,
        imageUrl: p.images?.[0]?.url ?? null,
        total: p.items?.total ?? p.tracks?.total ?? 0,
        ownerId: p.owner.id,
        collaborative: p.collaborative,
      }));
    },

    async getLikedSongsTotal() {
      const page = await request<Page<unknown>>('GET', '/me/tracks?limit=1');
      return page.total ?? 0;
    },

    async getPlaylistItems(playlistId) {
      if (playlistId === LIKED_SONGS_ID) {
        const saved = await getAll<{ track: RawItem | null }>('/me/tracks?limit=50&market=from_token');
        return saved.map((row) => ({ is_local: false, item: row.track }));
      }
      const rows = await getAll<RawRow>(
        `${playlistPath(playlistId)}?limit=50&market=from_token&additional_types=track,episode`,
      );
      return rows.map((row) => ({ is_local: row.is_local, item: row.item ?? row.track ?? null }));
    },

    async removeItems(playlistId, uris) {
      if (playlistId === LIKED_SONGS_ID) {
        await request('DELETE', libraryPath(uris));
        return;
      }
      await request('DELETE', playlistPath(playlistId), { items: uris.map((uri) => ({ uri })) });
    },

    async addItems(playlistId, uris, position) {
      // Liked Songs has no positions: a re-liked song goes to the top.
      if (playlistId === LIKED_SONGS_ID) {
        await request('PUT', libraryPath(uris));
        return;
      }
      await request('POST', playlistPath(playlistId), { uris, position });
    },

    async play(deviceId, uri, positionMs = 0) {
      await request('PUT', `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        uris: [uri],
        position_ms: positionMs,
      });
    },
  };
}

function spotifyMessage(text: string): string | null {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? null;
  } catch {
    return null;
  }
}
