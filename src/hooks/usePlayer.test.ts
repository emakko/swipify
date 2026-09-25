import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, AuthError } from '../spotify/errors';
import { playWithRetry } from './usePlayer';

afterEach(() => {
  vi.useRealTimers();
});

describe('playWithRetry', () => {
  it('plays once when Spotify accepts', async () => {
    const play = vi.fn(async () => {});
    await playWithRetry({ play }, 'dev', 'spotify:track:a', 5000);
    expect(play).toHaveBeenCalledExactlyOnceWith('dev', 'spotify:track:a', 5000);
  });

  it('retries a 404 once after a second, while the device registers', async () => {
    vi.useFakeTimers();
    const play = vi.fn<(d: string, u: string, p?: number) => Promise<void>>();
    play.mockRejectedValueOnce(new ApiError(404, 'Device not found')).mockResolvedValueOnce();
    const done = playWithRetry({ play }, 'dev', 'spotify:track:a');
    await vi.advanceTimersByTimeAsync(999);
    expect(play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('rethrows a second 404', async () => {
    vi.useFakeTimers();
    const play = vi.fn(async () => {
      throw new ApiError(404, 'Device not found');
    });
    const done = expect(playWithRetry({ play }, 'dev', 'spotify:track:a')).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    for (const error of [new ApiError(403, 'Premium required'), new AuthError(), new TypeError('Failed to fetch')]) {
      const play = vi.fn(async () => {
        throw error;
      });
      await expect(playWithRetry({ play }, 'dev', 'spotify:track:a')).rejects.toBe(error);
      expect(play).toHaveBeenCalledTimes(1);
    }
  });

  it('skips the retry once the user has moved to another card', async () => {
    vi.useFakeTimers();
    let current = true;
    const play = vi.fn<(d: string, u: string, p?: number) => Promise<void>>();
    play.mockRejectedValueOnce(new ApiError(404, 'Device not found'));
    const done = playWithRetry({ play }, 'dev', 'spotify:track:a', 0, () => current);
    current = false;
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(play).toHaveBeenCalledTimes(1);
  });
});
