import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Spotify only accepts loopback IPs (not "localhost") as redirect URIs.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: { environment: 'node' },
});
