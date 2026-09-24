import { useEffect, useState } from 'react';
import { formatTime } from '../core/format';
import { usePlayerSnapshot } from '../hooks/usePlayer';
import type { WebPlayer } from '../spotify/player';

export function PlayerControls({ player }: { player: WebPlayer }) {
  const snap = usePlayerSnapshot(player);
  const [, setTick] = useState(0);
  const [dragMs, setDragMs] = useState<number | null>(null);

  useEffect(() => {
    if (snap.paused) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [snap.paused]);

  const live = snap.positionMs + (snap.paused ? 0 : Date.now() - snap.updatedAt);
  const position = dragMs ?? Math.min(live, snap.durationMs);

  const commitSeek = (input: HTMLInputElement) => {
    if (dragMs !== null) void player.seek(dragMs);
    setDragMs(null);
    input.blur(); // hand the arrow keys back to swiping
  };

  return (
    <div className="player">
      <button
        className="play"
        aria-label={snap.paused ? 'Play' : 'Pause'}
        onClick={(e) => {
          e.currentTarget.blur(); // otherwise Space would toggle twice (button + shortcut)
          void player.togglePlay();
        }}
      >
        {snap.paused ? '▶' : '❚❚'}
      </button>
      <span className="time">{formatTime(position)}</span>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={snap.durationMs || 1}
        step={1000}
        value={position}
        onChange={(e) => setDragMs(Number(e.target.value))}
        onPointerUp={(e) => commitSeek(e.currentTarget)}
        onKeyUp={(e) => commitSeek(e.currentTarget)}
      />
      <span className="time">{formatTime(snap.durationMs)}</span>
    </div>
  );
}
