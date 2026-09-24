import { ApiError, AuthError } from './errors';
import { codeChallenge, generateVerifier } from './pkce';

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'streaming',
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
];

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TOKENS_KEY = 'spotify-swipe:tokens';
const VERIFIER_KEY = 'spotify-swipe:verifier';
const STATE_KEY = 'spotify-swipe:state';
/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface AuthDeps {
  clientId: string;
  redirectUri: string;
  storage: Storage;
  fetch: typeof fetch;
  now: () => number;
  navigate: (url: string) => void;
}

export interface Auth {
  isLoggedIn(): boolean;
  login(): Promise<void>;
  handleCallback(search: string): Promise<void>;
  getAccessToken(): Promise<string>;
  forceRefresh(): Promise<string>;
  logout(): void;
}

/** Authorization Code with PKCE, entirely in the browser (no client secret). */
export function createAuth(deps: AuthDeps): Auth {
  const { storage } = deps;
  let refreshing: Promise<string> | null = null;

  function readTokens(): Tokens | null {
    try {
      const raw = storage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  }

  function saveTokens(response: TokenResponse, previousRefreshToken = ''): Tokens {
    const tokens: Tokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? previousRefreshToken,
      expiresAt: deps.now() + response.expires_in * 1000,
    };
    storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    return tokens;
  }

  async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
    const res = await deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: deps.clientId, ...params }),
    });
    if (res.status === 400 || res.status === 401) {
      throw new AuthError(`Spotify rejected the login (${res.status})`);
    }
    if (!res.ok) throw new ApiError(res.status, 'Token request failed');
    return (await res.json()) as TokenResponse;
  }

  function refresh(): Promise<string> {
    refreshing ??= (async () => {
      const tokens = readTokens();
      if (!tokens?.refreshToken) throw new AuthError('Not logged in');
      try {
        const response = await requestToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
        return saveTokens(response, tokens.refreshToken).accessToken;
      } catch (error) {
        // Only a rejected refresh token means the login is gone; network errors are retryable.
        if (error instanceof AuthError) storage.removeItem(TOKENS_KEY);
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    isLoggedIn: () => readTokens() !== null,

    async login() {
      const verifier = generateVerifier();
      const state = generateVerifier(16);
      storage.setItem(VERIFIER_KEY, verifier);
      storage.setItem(STATE_KEY, state);
      const params = new URLSearchParams({
        client_id: deps.clientId,
        response_type: 'code',
        redirect_uri: deps.redirectUri,
        scope: SCOPES.join(' '),
        code_challenge_method: 'S256',
        code_challenge: await codeChallenge(verifier),
        state,
      });
      deps.navigate(`${AUTHORIZE_URL}?${params}`);
    },

    async handleCallback(search) {
      const params = new URLSearchParams(search);
      const denied = params.get('error');
      if (denied) throw new AuthError(`Spotify login was cancelled (${denied}).`);
      const code = params.get('code');
      const verifier = storage.getItem(VERIFIER_KEY);
      if (!code || !verifier || params.get('state') !== storage.getItem(STATE_KEY)) {
        throw new AuthError('The login response did not match. Please try again.');
      }
      const response = await requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: deps.redirectUri,
        code_verifier: verifier,
      });
      saveTokens(response);
      storage.removeItem(VERIFIER_KEY);
      storage.removeItem(STATE_KEY);
    },

    async getAccessToken() {
      const tokens = readTokens();
      if (!tokens) throw new AuthError('Not logged in');
      if (tokens.expiresAt - EXPIRY_MARGIN_MS > deps.now()) return tokens.accessToken;
      return refresh();
    },

    forceRefresh: refresh,

    logout() {
      storage.removeItem(TOKENS_KEY);
    },
  };
}
