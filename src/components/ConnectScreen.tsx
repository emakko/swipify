interface Props {
  clientIdMissing: boolean;
  error?: string;
  onConnect: () => void;
}

export function ConnectScreen({ clientIdMissing, error, onConnect }: Props) {
  return (
    <main className="center">
      <h1>Swipify</h1>
      <p className="muted">Swipe through a playlist. Right keeps a song, left removes it.</p>
      {clientIdMissing ? (
        <p className="error">
          No Spotify Client ID configured. Copy <code>.env.example</code> to <code>.env</code>, paste your Client
          ID, then restart <code>npm run dev</code>.
        </p>
      ) : (
        <button className="primary" onClick={onConnect}>
          Connect Spotify
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}
