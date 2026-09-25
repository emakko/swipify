import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../test/memoryStorage';
import { createHistoryStore, forgetPresent, type RemovedEntry } from './historyStore';

const entry = (uri: string, removedAt = 1, positions = [0]): RemovedEntry => ({
  uri,
  name: uri,
  artists: ['Artist'],
  imageUrl: null,
  positions,
  sessionId: 's1',
  removedAt,
});

describe('createHistoryStore', () => {
  it('stores entries per playlist, newest first', () => {
    const store = createHistoryStore(memoryStorage());
    store.add('p1', entry('a', 1));
    store.add('p1', entry('b', 2));
    store.add('p2', entry('c', 3));
    expect(store.load('p1').map((e) => e.uri)).toEqual(['b', 'a']);
    expect(store.load('p2').map((e) => e.uri)).toEqual(['c']);
  });

  it('replaces an existing entry for the same song', () => {
    const store = createHistoryStore(memoryStorage());
    store.add('p1', entry('a', 1, [0]));
    store.add('p1', entry('a', 5, [3]));
    expect(store.load('p1')).toEqual([entry('a', 5, [3])]);
  });

  it('removes an entry', () => {
    const store = createHistoryStore(memoryStorage());
    store.add('p1', entry('a'));
    store.add('p1', entry('b'));
    store.remove('p1', 'a');
    expect(store.load('p1').map((e) => e.uri)).toEqual(['b']);
  });

  it('survives a reload by reading from storage', () => {
    const storage = memoryStorage();
    createHistoryStore(storage).add('p1', entry('a'));
    expect(createHistoryStore(storage).load('p1')).toEqual([entry('a')]);
  });

  it('ignores corrupt stored data', () => {
    const storage = memoryStorage();
    storage.setItem('spotify-swipe:history:p1', '{not json');
    expect(createHistoryStore(storage).load('p1')).toEqual([]);
  });

  it('drops malformed stored entries instead of failing', () => {
    const storage = memoryStorage();
    storage.setItem('spotify-swipe:history:pl', JSON.stringify([null, { uri: 'x' }, 'junk', entry('a')]));
    const store = createHistoryStore(storage);
    expect(store.load('pl')).toEqual([entry('a')]);
    store.add('pl', entry('b', 2));
    expect(store.load('pl').map((e) => e.uri)).toEqual(['b', 'a']);
  });

  it('treats stored JSON that is not a list as empty', () => {
    const storage = memoryStorage();
    storage.setItem('spotify-swipe:history:pl', '{"uri":"a"}');
    expect(createHistoryStore(storage).load('pl')).toEqual([]);
  });

  it('keeps working in memory when storage writes fail', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const store = createHistoryStore(storage);
    store.add('p1', entry('a'));
    expect(store.load('p1').map((e) => e.uri)).toEqual(['a']);
  });

  it('works without any storage', () => {
    const store = createHistoryStore(null);
    store.add('p1', entry('a'));
    expect(store.load('p1').map((e) => e.uri)).toEqual(['a']);
  });
});

describe('forgetPresent', () => {
  it('drops entries for songs that are in the playlist again', () => {
    const store = createHistoryStore(memoryStorage());
    store.add('p1', entry('a'));
    store.add('p1', entry('b'));
    forgetPresent(store, 'p1', ['b', 'z']);
    expect(store.load('p1').map((e) => e.uri)).toEqual(['a']);
  });
});
