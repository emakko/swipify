import type { Card } from './deck';

/** A song that is in the playlist more than once; the copy at `keep` stays. */
export interface ExactCopies {
  key: string;
  card: Card;
  keep: number;
  remove: number[];
}

/** Another release of `kept` (same title and artists, different track); removed entirely. */
export interface OtherRelease {
  key: string;
  card: Card;
  kept: Card;
}

export interface Duplicates {
  exact: ExactCopies[];
  otherReleases: OtherRelease[];
}

export type RemovalOp =
  | { kind: 'release'; card: Card }
  | { kind: 'copies'; card: Card; keep: number; remove: number[] };

/** Expects `collectCards` output: cards in playlist order, positions ascending. */
export function findDuplicates(cards: Card[]): Duplicates {
  const exact = cards
    .filter((card) => card.positions.length > 1)
    .map((card) => ({ key: `copies:${card.uri}`, card, keep: card.positions[0], remove: card.positions.slice(1) }));

  // Cards are in playlist order, so the first card seen for a song is the one that stays.
  const firstBySong = new Map<string, Card>();
  const otherReleases: OtherRelease[] = [];
  for (const card of cards) {
    const song = songKey(card);
    const kept = firstBySong.get(song);
    if (kept) otherReleases.push({ key: `release:${card.uri}`, card, kept });
    else firstBySong.set(song, card);
  }
  return { exact, otherReleases };
}

/** The ops for every duplicate not in `unticked`, in the order they must run. */
export function planRemoval(found: Duplicates, unticked: ReadonlySet<string>): RemovalOp[] {
  const releases = found.otherReleases.filter((release) => !unticked.has(release.key));
  // Removing a release removes its extra copies too.
  const released = new Set(releases.map((release) => release.card.uri));
  const ops: RemovalOp[] = [
    ...releases.map((release) => ({ kind: 'release' as const, card: release.card })),
    ...found.exact
      .filter((copies) => !unticked.has(copies.key) && !released.has(copies.card.uri))
      .map((copies) => ({ kind: 'copies' as const, card: copies.card, keep: copies.keep, remove: copies.remove })),
  ];
  return ops.sort((a, b) => removedRows(a)[0] - removedRows(b)[0]);
}

/** Playlist rows the ops remove. */
export function countRemoved(ops: RemovalOp[]): number {
  return ops.reduce((count, op) => count + removedRows(op).length, 0);
}

/**
 * Positions for a History entry written by this run: the original indices minus the
 * exact copies the run removes before them. Other entries of the run are subtracted
 * later by `restoreIndices`, so a Restore lands in the right place.
 */
export function historyPositions(positions: number[], ops: RemovalOp[]): number[] {
  const copies = ops.flatMap((op) => (op.kind === 'copies' ? op.remove : []));
  return positions.map((position) => position - copies.filter((copy) => copy < position).length);
}

function removedRows(op: RemovalOp): number[] {
  return op.kind === 'release' ? op.card.positions : op.remove;
}

function songKey(card: Card): string {
  const normalize = (text: string) => text.trim().toLowerCase();
  return JSON.stringify([normalize(card.name), card.artists.map(normalize).sort()]);
}
