import type { Card } from './deck';

export type Decision = 'keep' | 'remove' | 'restored';

export interface UndoEntry {
  uri: string;
  decision: 'keep' | 'remove';
}

export interface SessionState {
  /** Shuffled deck; the order never changes during a session. */
  cards: Card[];
  /** Decision per song URI. A card without a decision is still to be swiped. */
  decisions: Record<string, Decision>;
  /** Swipes that can be undone, oldest first. */
  undoStack: UndoEntry[];
}

export type SessionAction =
  | { type: 'keep'; uri: string }
  | { type: 'remove'; uri: string }
  | { type: 'undo' }
  | { type: 'restored'; uri: string }
  | { type: 'removalFailed'; uri: string }
  | { type: 'restoreFailed'; uri: string };

export interface SessionCounts {
  kept: number;
  removed: number;
  decided: number;
  total: number;
}

export function initialSession(cards: Card[]): SessionState {
  return { cards, decisions: {}, undoStack: [] };
}

/** The first card without a decision, so undone or failed cards reappear automatically. */
export function currentCard(state: SessionState): Card | null {
  return state.cards.find((card) => !state.decisions[card.uri]) ?? null;
}

export function sessionCounts(state: SessionState): SessionCounts {
  const decisions = Object.values(state.decisions);
  return {
    kept: decisions.filter((d) => d !== 'remove').length,
    removed: decisions.filter((d) => d === 'remove').length,
    decided: decisions.length,
    total: state.cards.length,
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'keep':
    case 'remove':
      if (currentCard(state)?.uri !== action.uri) return state;
      return {
        ...state,
        decisions: { ...state.decisions, [action.uri]: action.type },
        undoStack: [...state.undoStack, { uri: action.uri, decision: action.type }],
      };
    case 'undo': {
      const last = state.undoStack[state.undoStack.length - 1];
      if (!last) return state;
      return {
        ...state,
        decisions: omit(state.decisions, last.uri),
        undoStack: state.undoStack.slice(0, -1),
      };
    }
    case 'restored':
      if (state.decisions[action.uri] !== 'remove') return state;
      return {
        ...state,
        decisions: { ...state.decisions, [action.uri]: 'restored' },
        undoStack: withoutUri(state.undoStack, action.uri),
      };
    case 'removalFailed':
      if (state.decisions[action.uri] !== 'remove') return state;
      return {
        ...state,
        decisions: omit(state.decisions, action.uri),
        undoStack: withoutUri(state.undoStack, action.uri),
      };
    case 'restoreFailed':
      // The song is still removed on Spotify, so the UI must say so too.
      if (!state.cards.some((card) => card.uri === action.uri)) return state;
      return {
        ...state,
        decisions: { ...state.decisions, [action.uri]: 'remove' },
        undoStack: [...withoutUri(state.undoStack, action.uri), { uri: action.uri, decision: 'remove' }],
      };
  }
}

function omit(decisions: Record<string, Decision>, uri: string): Record<string, Decision> {
  const next = { ...decisions };
  delete next[uri];
  return next;
}

function withoutUri(stack: UndoEntry[], uri: string): UndoEntry[] {
  return stack.filter((entry) => entry.uri !== uri);
}
