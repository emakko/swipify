import { useEffect, useRef } from 'react';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const id = window.setTimeout(() => onDismissRef.current(), 6000);
    return () => window.clearTimeout(id);
  }, [message]);

  return (
    <div className="toast" role="alert">
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
