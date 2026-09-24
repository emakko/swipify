export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000)) || 0;
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
