export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class AuthError extends Error {
  constructor(message = 'Spotify login expired') {
    super(message);
    this.name = 'AuthError';
  }
}

export function describeError(error: unknown): string {
  if (error instanceof AuthError) return 'Your Spotify login expired — please reconnect.';
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return 'Spotify refused the change — you may not have permission to edit this playlist.';
    }
    if (error.status === 404) return 'Spotify could not find that playlist, song or player.';
    return `Spotify error ${error.status}: ${error.message}`;
  }
  if (error instanceof TypeError) return `Network error — check your connection. (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}
