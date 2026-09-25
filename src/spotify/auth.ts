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
  'user-library-read',
  'user-library-modify',
];

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
// Keys keep the app's old name so existing logins and History survive the rename to Swipify.
const TOKENS_KEY = 'spotify-swipe:tokens';
const VERIFIER_KEY = 'spotify-swipe:verifier';
const STATE_KEY = 'spotify-swipe:state';
/** Refresh this long before the access token actually expires. */
const EXPIRY_MARGIN_MS = 60_000;

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  /** Scopes requested at login; a login made before a scope was added must be redone. */
  scopes?: string[];
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
  /** Tokens exist, but from a login that did not ask for every scope the app now needs. */
  needsNewScopes(): boolean;
  login(): Promise<void>;
  handleCallback(search: string): Promise<void>;
  getAccessToken(): Promise<string>;
  /** Refresh after Spotify rejected `rejectedToken`, unless it was already replaced. */
  forceRefresh(rejectedToken?: string): Promise<string>;
  logout(): void;
}

/** Authorization Code with PKCE, entirely in the browser (no client secret). */
export function createAuth(deps: AuthDeps): Auth {
  const { storage } = deps;
  let refreshing: Promise<string> | null = null;
  /** Bumped by logout, so a refresh still in flight does not save its tokens afterwards. */
  let generation = 0;

  function readTokens(): Tokens | null {
    try {
      const raw = storage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  }

  function saveTokens(response: TokenResponse, previous?: Tokens): Tokens {
    const tokens: Tokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? previous?.refreshToken ?? '',
      expiresAt: deps.now() + response.expires_in * 1000,
      scopes: previous ? previous.scopes : SCOPES,
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
      const startedIn = generation;
      try {
        const response = await requestToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
        if (startedIn !== generation) throw new AuthError('Not logged in');
        return saveTokens(response, tokens).accessToken;
      } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        // Another tab may have rotated the refresh token first: use its tokens instead.
        const current = readTokens();
        if (startedIn === generation && current?.refreshToken && current.refreshToken !== tokens.refreshToken) {
          return current.accessToken;
        }
        // Only a rejected refresh token means the login is gone; network errors are retryable.
        if (current?.refreshToken === tokens.refreshToken) storage.removeItem(TOKENS_KEY);
        throw error;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function hasAllScopes(tokens: Tokens): boolean {
    return SCOPES.every((scope) => tokens.scopes?.includes(scope));
  }

  return {
    isLoggedIn() {
      const tokens = readTokens();
      return tokens !== null && hasAllScopes(tokens);
    },

    needsNewScopes() {
      const tokens = readTokens();
      return tokens !== null && !hasAllScopes(tokens);
    },

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
      const state = storage.getItem(STATE_KEY);
      // Each login attempt's verifier and state are single-use, whatever the outcome.
      storage.removeItem(VERIFIER_KEY);
      storage.removeItem(STATE_KEY);
      if (!code || !verifier || !state || params.get('state') !== state) {
        throw new AuthError('The login response did not match. Please try again.');
      }
      const response = await requestToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: deps.redirectUri,
        code_verifier: verifier,
      });
      saveTokens(response);
    },

    async getAccessToken() {
      const tokens = readTokens();
      if (!tokens) throw new AuthError('Not logged in');
      if (tokens.expiresAt - EXPIRY_MARGIN_MS > deps.now()) return tokens.accessToken;
      return refresh();
    },

    async forceRefresh(rejectedToken) {
      const tokens = readTokens();
      // A concurrent request already swapped the rejected token for a new one.
      if (rejectedToken && tokens && tokens.accessToken !== rejectedToken) return tokens.accessToken;
      return refresh();
    },

    logout() {
      generation++;
      storage.removeItem(TOKENS_KEY);
      storage.removeItem(VERIFIER_KEY);
      storage.removeItem(STATE_KEY);
    },
  };
}
