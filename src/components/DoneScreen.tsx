interface Props {
  kept: number;
  removed: number;
  skipped: number;
  canUndo: boolean;
  onUndo: () => void;
  onShowHistory: () => void;
  onPickAnother: () => void;
}

export function DoneScreen({ kept, removed, skipped, canUndo, onUndo, onShowHistory, onPickAnother }: Props) {
  return (
    <div className="done">
      <h2>All done!</h2>
      <p>
        Kept {kept} · Removed {removed}
        {skipped > 0 && ` · Skipped ${skipped}`}
      </p>
      <div className="row">
        {canUndo && <button onClick={onUndo}>↩ Undo last</button>}
        <button onClick={onShowHistory}>History</button>
        <button className="primary" onClick={onPickAnother}>
          Pick another playlist
        </button>
      </div>
    </div>
  );
}
