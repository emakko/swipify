import { describe, expect, it } from 'vitest';
import { editablePlaylists, type PlaylistSummary } from './playlists';

const playlist = (id: string, ownerId: string, collaborative = false): PlaylistSummary => ({
  id,
  name: id,
  imageUrl: null,
  total: 1,
  ownerId,
  collaborative,
});

describe('editablePlaylists', () => {
  it('keeps playlists the user owns or that are collaborative', () => {
    const all = [playlist('mine', 'me'), playlist('followed', 'other'), playlist('shared', 'other', true)];
    expect(editablePlaylists(all, 'me').map((p) => p.id)).toEqual(['mine', 'shared']);
  });
});
