import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// No StrictMode: its double-run effects would redeem the one-time login code twice
// and create two Spotify players.
createRoot(document.getElementById('root')!).render(<App />);
