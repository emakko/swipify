import { describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../test/memoryStorage';
import { createAuth, SCOPES } from './auth';
import { AuthError } from './errors';

const NOW = 1_000_000;
const TOKENS_KEY = 'spotify-swipe:tokens';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup() {
  const storage = memoryStorage();
  const fetchMock = vi.fn<typeof fetch>();
  const navigate = vi.fn<(url: string) => void>();
  const auth = createAuth({
    clientId: 'client-123',
    redirectUri: 'http://127.0.0.1:5173/callback',
    storage,
    fetch: fetchMock,
    now: () => NOW,
    navigate,
  });
  return { auth, storage, fetchMock, navigate };
}

const storeTokens = (storage: Storage, expiresAt: number) =>
  storage.setItem(
    TOKENS_KEY,
    JSON.stringify({ accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt, scopes: SCOPES }),
  );

const formBody = (call: Parameters<typeof fetch>) => new URLSearchParams(String(call[1]?.body));

describe('getAccessToken', () => {
  it('returns the stored token while it is valid', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW + 3_600_000);
    expect(await auth.getAccessToken()).toBe('old-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes shortly before expiry and stores the rotated refresh token', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW + 30_000);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));

    expect(await auth.getAccessToken()).toBe('new-access');

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    const body = formBody(fetchMock.mock.calls[0]);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(body.get('client_id')).toBe('client-123');
    expect(JSON.parse(storage.getItem(TOKENS_KEY)!)).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: NOW + 3_600_000,
      scopes: SCOPES,
    });
  });

  it('keeps the old refresh token when Spotify does not send a new one', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 }));
    await auth.getAccessToken();
    expect(JSON.parse(storage.getItem(TOKENS_KEY)!).refreshToken).toBe('old-refresh');
  });

  it('shares one refresh between concurrent callers', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 }));
    expect(await Promise.all([auth.getAccessToken(), auth.getAccessToken()])).toEqual(['new-access', 'new-access']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('logs out when Spotify rejects the refresh token', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('stays logged in when the refresh fails because of the network', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(TypeError);
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('keeps another tab’s rotated tokens when its own refresh is rejected', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockImplementationOnce(async () => {
      // Another tab refreshed first and rotated the refresh token.
      storage.setItem(
        TOKENS_KEY,
        JSON.stringify({ accessToken: 'tab-access', refreshToken: 'tab-refresh', expiresAt: NOW + 3_600_000, scopes: SCOPES }),
      );
      return json({ error: 'invalid_grant' }, 400);
    });
    expect(await auth.getAccessToken()).toBe('tab-access');
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('stays logged out when logout happens during a refresh', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    let respond!: (res: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));
    const pending = auth.getAccessToken();
    auth.logout();
    respond(json({ access_token: 'new-access', expires_in: 3600 }));
    await expect(pending).rejects.toBeInstanceOf(AuthError);
    expect(storage.getItem(TOKENS_KEY)).toBeNull();
  });

  it('refreshes again after an earlier refresh has settled', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'a1', expires_in: 0 }))
      .mockResolvedValueOnce(json({ access_token: 'a2', expires_in: 3600 }));
    expect(await auth.getAccessToken()).toBe('a1');
    expect(await auth.getAccessToken()).toBe('a2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stays logged in when the token endpoint fails with a server error', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(auth.getAccessToken()).rejects.toMatchObject({ status: 500 });
    expect(auth.isLoggedIn()).toBe(true);
  });

  it('treats corrupt stored tokens as logged out', async () => {
    const { auth, storage } = setup();
    storage.setItem(TOKENS_KEY, '{not json');
    expect(auth.isLoggedIn()).toBe(false);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects with AuthError when not logged in', async () => {
    const { auth } = setup();
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('forceRefresh', () => {
  it('refreshes even while the stored token looks valid', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW + 3_600_000);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 }));
    expect(await auth.forceRefresh('old-access')).toBe('new-access');
  });

  it('returns the current token when the rejected one was already replaced', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW + 3_600_000);
    expect(await auth.forceRefresh('older-access')).toBe('old-access');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('login and callback', () => {
  it('redirects to Spotify with a PKCE challenge, all scopes and a stored state', async () => {
    const { auth, storage, navigate } = setup();
    await auth.login();
    const url = new URL(navigate.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('scope')).toBe(SCOPES.join(' '));
    expect(url.searchParams.get('state')).toBe(storage.getItem('spotify-swipe:state'));
  });

  it('exchanges the code using the stored verifier', async () => {
    const { auth, storage, fetchMock } = setup();
    storage.setItem('spotify-swipe:verifier', 'verifier-abc');
    storage.setItem('spotify-swipe:state', 'state-xyz');
    fetchMock.mockResolvedValueOnce(json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }));

    await auth.handleCallback('?code=the-code&state=state-xyz');

    const body = formBody(fetchMock.mock.calls[0]);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('verifier-abc');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5173/callback');
    expect(auth.isLoggedIn()).toBe(true);
    expect(storage.getItem('spotify-swipe:verifier')).toBeNull();
    expect(storage.getItem('spotify-swipe:state')).toBeNull();
  });

  it('rejects a callback whose state does not match', async () => {
    const { auth, storage, fetchMock } = setup();
    storage.setItem('spotify-swipe:verifier', 'verifier-abc');
    storage.setItem('spotify-swipe:state', 'state-xyz');
    await expect(auth.handleCallback('?code=c&state=evil')).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback when no state was stored or returned', async () => {
    const { auth, storage, fetchMock } = setup();
    storage.setItem('spotify-swipe:verifier', 'verifier-abc');
    await expect(auth.handleCallback('?code=c')).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forgets the verifier and state after a rejected callback', async () => {
    const { auth, storage } = setup();
    storage.setItem('spotify-swipe:verifier', 'verifier-abc');
    storage.setItem('spotify-swipe:state', 'state-xyz');
    await expect(auth.handleCallback('?code=c&state=evil')).rejects.toBeInstanceOf(AuthError);
    expect(storage.getItem('spotify-swipe:verifier')).toBeNull();
    expect(storage.getItem('spotify-swipe:state')).toBeNull();
  });

  it('rejects a callback without a code', async () => {
    const { auth, storage, fetchMock } = setup();
    storage.setItem('spotify-swipe:verifier', 'verifier-abc');
    storage.setItem('spotify-swipe:state', 'state-xyz');
    await expect(auth.handleCallback('?state=state-xyz')).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback where the user cancelled', async () => {
    const { auth } = setup();
    await expect(auth.handleCallback('?error=access_denied')).rejects.toThrow(/cancelled/);
  });

  it('logout forgets the tokens', () => {
    const { auth, storage } = setup();
    storeTokens(storage, NOW + 3_600_000);
    auth.logout();
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe('scopes', () => {
  it('requests Liked Songs access', () => {
    expect(SCOPES).toEqual(expect.arrayContaining(['user-library-read', 'user-library-modify']));
  });

  it('treats a login made before a scope was added as logged out', () => {
    const { auth, storage } = setup();
    storage.setItem(
      TOKENS_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 3_600_000, scopes: ['streaming'] }),
    );
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.needsNewScopes()).toBe(true);
  });

  it('treats a login without a stored scope list as needing new scopes', () => {
    const { auth, storage } = setup();
    storage.setItem(TOKENS_KEY, JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 3_600_000 }));
    expect(auth.isLoggedIn()).toBe(false);
    expect(auth.needsNewScopes()).toBe(true);
  });

  it('does not ask for new scopes when nobody is logged in', () => {
    const { auth } = setup();
    expect(auth.needsNewScopes()).toBe(false);
  });

  it('keeps the scope list across a refresh', async () => {
    const { auth, storage, fetchMock } = setup();
    storeTokens(storage, NOW);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'new-access', expires_in: 3600 }));
    await auth.getAccessToken();
    expect(auth.isLoggedIn()).toBe(true);
  });
});
