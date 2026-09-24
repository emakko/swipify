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
