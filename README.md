# Swipify

Tinder for your playlists: songs play in random order; swipe right to keep, left to remove.
Needs Spotify Premium and a desktop browser (Chrome, Edge or Firefox).

## One-time setup

1. Go to https://developer.spotify.com/dashboard and log in.
2. **Create app**: any name/description; Redirect URI **exactly** `http://127.0.0.1:5173/callback`;
   tick **Web API** and **Web Playback SDK**; save.
3. Open the app's **Settings**, copy the **Client ID**.
4. In this folder: copy `.env.example` to `.env` and paste the Client ID after `VITE_SPOTIFY_CLIENT_ID=`.
   Restart `npm run dev` after editing `.env` — Vite only reads it on startup.
5. `npm install`
6. In Development Mode, Spotify only lets allowlisted accounts log in. If login fails with
   "user not registered", add your account under the app's Dashboard → **User Management**.

## Run

    npm run dev

Open **http://127.0.0.1:5173** (not `localhost` — Spotify rejects it).

## Keys

← remove · → keep · Space play/pause · Ctrl+Z undo last swipe

## Tips

- Removals happen immediately. Use Undo, or History → Restore, to put songs back at their original spot.
- Restore puts a song back at its original position on a best-effort basis: if the playlist was
  edited elsewhere in the meantime, the position may be off.
- **Liked Songs** is the first tile in the picker. A left swipe un-likes the song. Undo or Restore
  likes it again, but Spotify puts it at the top of Liked Songs with today's date — the original
  "date added" can't be kept.
- If you logged in before Liked Songs support was added, the app asks you to reconnect once so
  Spotify can grant the extra permissions.
- Try it on a copy of a playlist first (in Spotify: playlist → ⋯ → Add to other playlist → New playlist).

## Development

    npm test         # unit tests (Vitest)
    npm run build    # type-check and build into dist/

- `src/spotify/` — PKCE login, Web API client, Web Playback SDK wrapper
- `src/core/` — deck shuffling, playlist/position logic, persisted swipe history
- `src/session/` — swipe session controller (keep, remove, undo, restore)
- `src/components/`, `src/hooks/` — React UI

## Manual checklist

- Include a region-locked or relinked track in the test playlist if you have one.
- Reload the page right after a left swipe — History must still list the song.
- Re-add a removed song in the Spotify app, then reopen the playlist here — it must not be
  listed in History anymore.
- Liked Songs: swipe a song left, check it is un-liked in Spotify, Restore it from History, and check
  it is liked again (at the top).
