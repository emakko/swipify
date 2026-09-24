import { describe, expect, it } from 'vitest';
import { collectCards, type RawItem, type RawPlaylistRow } from './deck';
import { countRemoved, findDuplicates, historyPositions, planRemoval } from './duplicates';

function track(uri: string, name = uri, artists = ['Artist'], extra: Partial<RawItem> = {}): RawPlaylistRow {
  return {
    is_local: false,
    item: {
      type: 'track',
      uri,
      name,
      duration_ms: 1000,
      artists: artists.map((artist) => ({ name: artist })),
      album: { name: `Album ${uri}` },
      ...extra,
    },
  };
}

const find = (rows: RawPlaylistRow[]) => findDuplicates(collectCards(rows).cards);

describe('findDuplicates', () => {
  it('finds nothing in a playlist without duplicates', () => {
    expect(find([track('a'), track('b')])).toEqual({ exact: [], otherReleases: [] });
  });

  it('keeps the first of several exact copies', () => {
    const { exact } = find([track('a'), track('b'), track('a'), track('a')]);
    expect(exact.map((e) => [e.key, e.card.uri, e.keep, e.remove])).toEqual([['copies:a', 'a', 0, [2, 3]]]);
  });

  it('matches relinked tracks by their playlist URI', () => {
    const { exact } = find([track('a'), track('a-relinked', 'a', ['Artist'], { linked_from: { uri: 'a' } })]);
    expect(exact.map((e) => [e.card.uri, e.keep, e.remove])).toEqual([['a', 0, [1]]]);
  });

  it('treats the same title and artists on another release as the same song', () => {
    const { otherReleases } = find([
      track('single', 'Blinding Lights', ['The Weeknd', 'Max']),
      track('x'),
      track('album', ' blinding lights ', ['max', 'The Weeknd ']),
    ]);
    expect(otherReleases.map((r) => [r.key, r.card.uri, r.kept.uri])).toEqual([['release:album', 'album', 'single']]);
  });

  it('does not match the same title by different artists', () => {
    expect(find([track('a', 'Hurt', ['Johnny Cash']), track('b', 'Hurt', ['Nine Inch Nails'])]).otherReleases).toEqual(
      [],
    );
  });
});

// Rows: 0 a "Song", 1 b "Song" (other release of a), 2 b, 3 c, 4 c.
const rows = [track('a', 'Song'), track('b', 'Song'), track('b', 'Song'), track('c'), track('c')];

describe('planRemoval', () => {
  it('removes a release with all its copies once, ordered by first removed row', () => {
    const ops = planRemoval(find(rows), new Set());
    expect(ops.map((op) => [op.kind, op.card.uri])).toEqual([
      ['release', 'b'],
      ['copies', 'c'],
    ]);
    expect(countRemoved(ops)).toBe(3);
  });

  it('skips unticked rows', () => {
    const keepRelease = planRemoval(find(rows), new Set(['release:b']));
    expect(keepRelease.map((op) => [op.kind, op.card.uri])).toEqual([
      ['copies', 'b'],
      ['copies', 'c'],
    ]);
    expect(countRemoved(keepRelease)).toBe(2);
    expect(planRemoval(find(rows), new Set(['release:b', 'copies:b', 'copies:c']))).toEqual([]);
  });
});

describe('historyPositions', () => {
  it('subtracts the exact copies the run removes before each position', () => {
    const ops = planRemoval(find(rows), new Set());
    expect(historyPositions([1, 2], ops)).toEqual([1, 2]);
    expect(historyPositions([5], ops)).toEqual([4]);
  });
});
