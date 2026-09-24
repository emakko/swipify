export interface RawItem {
  type: 'track' | 'episode';
  uri: string;
  name: string;
  duration_ms: number;
  is_playable?: boolean;
  artists?: { name: string }[];
  album?: { name: string; images?: { url: string }[] };
  /** Present when Spotify substituted this track; the original (playlist) URI. */
  linked_from?: { uri: string } | null;
}

export interface RawPlaylistRow {
  is_local: boolean;
  item: RawItem | null;
}

export interface Card {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  imageUrl: string | null;
  durationMs: number;
  isPlayable: boolean;
  /** Every 0-based index at which this song appears in the playlist. */
  positions: number[];
  /** URI to play; may differ from `uri` when Spotify relinks the track. */
  playUri: string;
}

export interface Deck {
  cards: Card[];
  /** Rows that cannot be swiped: local files, podcast episodes, deleted items. */
  skipped: number;
  /** Number of rows in the playlist, swipeable or not. */
  totalRows: number;
}

/** One card per song, in order of first appearance, plus the number of rows that can't be swiped. */
export function collectCards(rows: RawPlaylistRow[]): { cards: Card[]; skipped: number } {
  const byUri = new Map<string, Card>();
  let skipped = 0;

  rows.forEach((row, index) => {
    const item = row.item;
    if (row.is_local || !item || item.type !== 'track') {
      skipped++;
      return;
    }
    // Spotify may relink an unavailable track to a substitute; the playlist row (and
    // every playlist-editing call) still needs the original URI, from `linked_from`.
    const uri = item.linked_from?.uri ?? item.uri;
    const existing = byUri.get(uri);
    if (existing) {
      existing.positions.push(index);
      return;
    }
    byUri.set(uri, {
      uri,
      name: item.name,
      artists: (item.artists ?? []).map((artist) => artist.name),
      album: item.album?.name ?? '',
      imageUrl: item.album?.images?.[0]?.url ?? null,
      durationMs: item.duration_ms,
      isPlayable: item.is_playable !== false,
      positions: [index],
      playUri: item.uri,
    });
  });

  return { cards: [...byUri.values()], skipped };
}

export function buildDeck(rows: RawPlaylistRow[], random: () => number = Math.random): Deck {
  const { cards, skipped } = collectCards(rows);
  return { cards: shuffle(cards, random), skipped, totalRows: rows.length };
}

/** Fisher–Yates shuffle returning a new array. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
