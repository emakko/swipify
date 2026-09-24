import { describe, expect, it } from 'vitest';
import { clampIndex, restoreIndices } from './positions';

describe('restoreIndices', () => {
  it('returns the original index when nothing else is removed', () => {
    expect(restoreIndices([3], [])).toEqual([3]);
  });

  it('shifts left by the still-removed songs that were above it', () => {
    expect(restoreIndices([3], [1, 5])).toEqual([2]);
  });

  it('restores duplicate positions in ascending order', () => {
    expect(restoreIndices([4, 1], [])).toEqual([1, 4]);
  });

  it('handles duplicates with another removed song between them', () => {
    expect(restoreIndices([1, 3], [2])).toEqual([1, 2]);
  });

  it('rebuilds the original list when replayed against it', () => {
    let list = ['A', 'C', 'E']; // B (1) and D (3) were removed from A..E
    const insert = (song: string, index: number) => {
      list = [...list.slice(0, index), song, ...list.slice(index)];
    };
    restoreIndices([3], [1]).forEach((i) => insert('D', i));
    restoreIndices([1], []).forEach((i) => insert('B', i));
    expect(list).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('clampIndex', () => {
  it('keeps indices inside 0..length', () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(7, 5)).toBe(5);
    expect(clampIndex(-1, 5)).toBe(0);
  });
});
