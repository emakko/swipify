import { describe, expect, it, vi } from 'vitest';
import { createApi } from './api';
import { ApiError, AuthError } from './errors';

const BASE = 'https://api.spotify.com/v1';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function setup() {
  const fetchMock = vi.fn<typeof fetch>();
  const forceRefresh = vi.fn(async () => 'fresh-token');
  const sleep = vi.fn(async (_ms: number) => {});
  const api = createApi({ getAccessToken: async () => 'token-1', forceRefresh, fetch: fetchMock, sleep });
  return { api, fetchMock, forceRefresh, sleep };
}

const authHeader = (call: Parameters<typeof fetch>) =>
  (call[1]?.headers as Record<string, string>).Authorization;

const sentBody = (call: Parameters<typeof fetch>) => JSON.parse(String(call[1]?.body));

const trackItem = (uri: string) => ({ type: 'track', uri, name: uri, duration_ms: 1 });

describe('createApi', () => {
  it('sends the bearer token and maps the profile', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ id: 'me', display_name: 'Tester' }));
    expect(await api.getMe()).toEqual({ id: 'me', displayName: 'Tester' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/me`);
    expect(authHeader(fetchMock.mock.calls[0])).toBe('Bearer token-1');
  });

  it('refreshes the token once on 401 and retries', async () => {
    const { api, fetchMock, forceRefresh } = setup();
    fetchMock
      .mockResolvedValueOnce(json({ error: { status: 401, message: 'expired' } }, 401))
      .mockResolvedValueOnce(json({ id: 'me', display_name: null }));
    expect(await api.getMe()).toEqual({ id: 'me', displayName: null });
    expect(forceRefresh).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchMock.mock.calls[1])).toBe('Bearer fresh-token');
  });

  it('gives up with AuthError when the retry is also 401', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockImplementation(async () => json({}, 401));
    await expect(api.getMe()).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('waits for Retry-After on 429 and retries', async () => {
    const { api, fetchMock, sleep } = setup();
    fetchMock
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ id: 'me', display_name: null }));
    await api.getMe();
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying 429 after three attempts', async () => {
    const { api, fetchMock, sleep } = setup();
    fetchMock.mockImplementation(async () => json({}, 429, { 'Retry-After': '1' }));
    await expect(api.getMe()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('turns error bodies into ApiError with Spotify’s message', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ error: { status: 403, message: 'Insufficient client scope' } }, 403));
    const error = await api.removeItems('p1', ['spotify:track:a']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: 'Insufficient client scope' });
  });

  it('follows pagination for playlist items and falls back to the legacy track field', async () => {
    const { api, fetchMock } = setup();
    const nextUrl = `${BASE}/playlists/p1/items?offset=50&limit=50&market=from_token&additional_types=track,episode`;
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ is_local: false, item: trackItem('spotify:track:a') }], next: nextUrl }))
      .mockResolvedValueOnce(json({ items: [{ is_local: false, track: trackItem('spotify:track:b') }], next: null }));

    const rows = await api.getPlaylistItems('p1');

    expect(rows).toEqual([
      { is_local: false, item: trackItem('spotify:track:a') },
      { is_local: false, item: trackItem('spotify:track:b') },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${BASE}/playlists/p1/items?limit=50&market=from_token&additional_types=track,episode`,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(nextUrl);
  });

  it('refuses to follow a pagination link that points outside the Spotify API', async () => {
    const { api, fetchMock } = setup();
    const evilNext = 'https://evil.example.com/steal-token';
    fetchMock.mockResolvedValueOnce(
      json({ items: [{ is_local: false, item: trackItem('spotify:track:a') }], next: evilNext }),
    );
    const error = await api.getPlaylistItems('p1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, message: 'Unexpected URL from Spotify' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps playlists using items.total, falling back to tracks.total', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      json({
        items: [
          { id: 'p1', name: 'One', collaborative: false, owner: { id: 'me' }, images: [{ url: 'x.jpg' }], items: { total: 12 } },
          { id: 'p2', name: 'Two', collaborative: true, owner: { id: 'other' }, images: null, tracks: { total: 3 } },
        ],
        next: null,
      }),
    );
    expect(await api.getMyPlaylists()).toEqual([
      { id: 'p1', name: 'One', imageUrl: 'x.jpg', total: 12, ownerId: 'me', collaborative: false },
      { id: 'p2', name: 'Two', imageUrl: null, total: 3, ownerId: 'other', collaborative: true },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/me/playlists?limit=50`);
  });

  it('removes items with DELETE /playlists/{id}/items', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ snapshot_id: 's' }));
    await api.removeItems('p1', ['spotify:track:a']);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${BASE}/playlists/p1/items`);
    expect(call[1]?.method).toBe('DELETE');
    expect(sentBody(call)).toEqual({ items: [{ uri: 'spotify:track:a' }] });
  });

  it('adds items at a position with POST /playlists/{id}/items', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ snapshot_id: 's' }, 201));
    await api.addItems('p1', ['spotify:track:a'], 3);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${BASE}/playlists/p1/items`);
    expect(call[1]?.method).toBe('POST');
    expect(sentBody(call)).toEqual({ uris: ['spotify:track:a'], position: 3 });
  });

  it('starts playback on a device and accepts an empty 204 response', async () => {
    const { api, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.play('dev1', 'spotify:track:a', 5000)).resolves.toBeUndefined();
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(`${BASE}/me/player/play?device_id=dev1`);
    expect(call[1]?.method).toBe('PUT');
    expect(sentBody(call)).toEqual({ uris: ['spotify:track:a'], position_ms: 5000 });
  });
});
