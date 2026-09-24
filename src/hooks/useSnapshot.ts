import { useSyncExternalStore } from 'react';

interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export function useSnapshot<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
