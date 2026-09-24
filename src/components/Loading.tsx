/** Bouncing equalizer bars above a status message while we wait on Spotify. */
export function Loading({ children }: { children: string }) {
  return (
    <div className="loading" role="status">
      <span className="eq" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      {children}
    </div>
  );
}
