import { describe, expect, it } from 'vitest';
import { buildDeck, shuffle, type RawItem, type RawPlaylistRow } from './deck';

// With random() just below 1, Fisher–Yates never swaps, so order is preserved.
const keepOrder = () => 0.999999;

function track(uri: string, extra: Partial<RawItem> = {}): RawPlaylistRow {
  return {
    is_local: false,
    item: {
      type: 'track',
      uri,
      name: `Song ${uri}`,
      duration_ms: 200_000,
      artists: [{ name: 'Artist' }],
      album: { name: 'Album', images: [{ url: 'big.jpg' }, { url: 'small.jpg' }] },
      ...extra,
    },
  };
}

describe('buildDeck', () => {
  it('maps a track row to a card', () => {
    const deck = buildDeck([track('spotify:track:a', { is_playable: true })], keepOrder);
    expect(deck.cards).toEqual([
      {
        uri: 'spotify:track:a',
        name: 'Song spotify:track:a',
        artists: ['Artist'],
        album: 'Album',
        imageUrl: 'big.jpg',
        durationMs: 200_000,
        isPlayable: true,
        positions: [0],
      },
    ]);
    expect(deck.skipped).toBe(0);
    expect(deck.totalRows).toBe(1);
  });

  it('treats a missing is_playable as playable and false as unplayable', () => {
    const deck = buildDeck(
      [track('spotify:track:a'), track('spotify:track:b', { is_playable: false })],
      keepOrder,
    );
    expect(deck.cards.map((c) => c.isPlayable)).toEqual([true, false]);
  });

  it('handles missing artists, album and images', () => {
    const deck = buildDeck(
      [{ is_local: false, item: { type: 'track', uri: 'spotify:track:a', name: 'A', duration_ms: 1 } }],
      keepOrder,
    );
    expect(deck.cards[0]).toMatchObject({ artists: [], album: '', imageUrl: null });
  });

  it('skips local files, episodes and missing items but keeps their row indices', () => {
    const rows: RawPlaylistRow[] = [
      { is_local: true, item: { type: 'track', uri: 'spotify:local:x', name: 'Local', duration_ms: 1 } },
      track('spotify:track:a'),
      { is_local: false, item: { type: 'episode', uri: 'spotify:episode:e', name: 'Pod', duration_ms: 1 } },
      { is_local: false, item: null },
      track('spotify:track:b'),
    ];
    const deck = buildDeck(rows, keepOrder);
    expect(deck.cards.map((c) => [c.uri, c.positions])).toEqual([
      ['spotify:track:a', [1]],
      ['spotify:track:b', [4]],
    ]);
    expect(deck.skipped).toBe(3);
    expect(deck.totalRows).toBe(5);
  });

  it('merges duplicates of the same song into one card with every position', () => {
    const deck = buildDeck(
      [track('spotify:track:a'), track('spotify:track:b'), track('spotify:track:a')],
      keepOrder,
    );
    expect(deck.cards.map((c) => [c.uri, c.positions])).toEqual([
      ['spotify:track:a', [0, 2]],
      ['spotify:track:b', [1]],
    ]);
    expect(deck.totalRows).toBe(3);
  });

  it('handles an empty playlist', () => {
    expect(buildDeck([], keepOrder)).toEqual({ cards: [], skipped: 0, totalRows: 0 });
  });
});

describe('shuffle', () => {
  it('is deterministic for a given random source', () => {
    expect(shuffle(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate its input and keeps every element', () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffle(input, Math.random);
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
