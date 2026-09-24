export interface RawItem {
  type: 'track' | 'episode';
  uri: string;
  name: string;
  duration_ms: number;
  is_playable?: boolean;
  artists?: { name: string }[];
  album?: { name: string; images?: { url: string }[] };
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
}

export interface Deck {
  cards: Card[];
  /** Rows that cannot be swiped: local files, podcast episodes, deleted items. */
  skipped: number;
  /** Number of rows in the playlist, swipeable or not. */
  totalRows: number;
}

export function buildDeck(rows: RawPlaylistRow[], random: () => number = Math.random): Deck {
  const byUri = new Map<string, Card>();
  let skipped = 0;

  rows.forEach((row, index) => {
    const item = row.item;
    if (row.is_local || !item || item.type !== 'track') {
      skipped++;
      return;
    }
    const existing = byUri.get(item.uri);
    if (existing) {
      existing.positions.push(index);
      return;
    }
    byUri.set(item.uri, {
      uri: item.uri,
      name: item.name,
      artists: (item.artists ?? []).map((artist) => artist.name),
      album: item.album?.name ?? '',
      imageUrl: item.album?.images?.[0]?.url ?? null,
      durationMs: item.duration_ms,
      isPlayable: item.is_playable !== false,
      positions: [index],
    });
  });

  return { cards: shuffle([...byUri.values()], random), skipped, totalRows: rows.length };
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
