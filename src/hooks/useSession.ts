import { useSyncExternalStore } from 'react';
import type { SessionController, SessionSnapshot } from '../session/controller';

export function useSessionSnapshot(controller: SessionController): SessionSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
