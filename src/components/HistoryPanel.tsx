import type { RemovedEntry } from '../core/historyStore';

interface Props {
  entries: RemovedEntry[];
  sessionId: string;
  /** Shown above the list, e.g. how Restore behaves for this playlist. */
  note?: string;
  onRestore: (uri: string) => void;
  onClose: () => void;
}

export function HistoryPanel({ entries, sessionId, note, onRestore, onClose }: Props) {
  return (
    <aside className="history" aria-label="Removed songs">
      <header>
        <h2>Removed songs</h2>
        <button className="link" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      {note && <p className="muted">{note}</p>}
      {entries.length === 0 ? (
        <p className="muted">Nothing removed yet.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.uri}>
              {entry.imageUrl ? <img src={entry.imageUrl} alt="" /> : <div className="no-art small">♪</div>}
              <div className="grow">
                <strong>{entry.name}</strong>
                <span className="muted">
                  {entry.artists.join(', ')}
                  {entry.sessionId !== sessionId && ` · ${new Date(entry.removedAt).toLocaleDateString()}`}
                </span>
              </div>
              <button onClick={() => onRestore(entry.uri)}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
