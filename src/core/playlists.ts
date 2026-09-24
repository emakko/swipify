/**
 * Stands in for the user's Liked Songs, which Spotify stores as a library rather than a
 * playlist. Real playlist IDs are 22 base-62 characters, so this can never collide.
 */
export const LIKED_SONGS_ID = 'liked';

export interface PlaylistSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  total: number;
  ownerId: string;
  collaborative: boolean;
}

/** Spotify only lets you edit playlists you own or collaborate on. */
export function editablePlaylists(all: PlaylistSummary[], meId: string): PlaylistSummary[] {
  return all.filter((playlist) => playlist.ownerId === meId || playlist.collaborative);
}
