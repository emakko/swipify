import { createRoot } from 'react-dom/client';

// No StrictMode: its double-run effects would redeem the one-time login code twice.
createRoot(document.getElementById('root')!).render(<h1>Spotify Swipe</h1>);
