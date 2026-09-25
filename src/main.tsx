import { MotionConfig } from 'motion/react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Spotify only accepts the 127.0.0.1 redirect URI, not localhost — send the browser
// there before anything (auth, the player) starts up on the wrong origin.
if (location.hostname === 'localhost') {
  location.replace(location.href.replace('localhost', '127.0.0.1'));
} else {
  // No StrictMode: its double-run effects would redeem the one-time login code twice
  // and create two Spotify players.
  createRoot(document.getElementById('root')!).render(
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>,
  );
}
