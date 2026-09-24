<p align="center"><img src="docs/banner.png" alt="Swipify: swipe right to keep, left to remove."></p>

# Swipify

Tinder for your playlists: songs play in random order; swipe right to keep, left to remove.
Switch to **Remove duplicates** at the top of the playlist list to clear out songs that are in a
playlist twice, or once as a single and once from the album.

<!-- Add a screenshot or GIF of the swipe screen at docs/screenshot.png -->
![Swipify swipe screen](docs/screenshot.png)

## Requirements

- **Spotify Premium** — playback in the browser only works with Premium.
- A **desktop browser**: Chrome, Edge or Firefox.
- **[Node.js](https://nodejs.org) 22.12 or newer** (the LTS installer is fine). Check with `node -v`.
  Using nvm? `nvm use` picks the right version from `.nvmrc`.

## Get it

    git clone https://github.com/emakko/swipify.git
    cd swipify

No git? Use **Code → Download ZIP** on GitHub, unzip it and open a terminal in the folder.

## Setup (once)

Swipify runs on your own computer and talks to Spotify through a free Spotify app that you create.

1. Go to https://developer.spotify.com/dashboard and log in.
2. **Create app**: any name and description. Set the Redirect URI to **exactly**
   `http://127.0.0.1:5173/callback`, tick **Web API** and **Web Playback SDK**, and save.
3. Open the app's **Settings** and copy the **Client ID**.
4. In the Swipify folder, run:

       npm install
       npm run setup

   Paste the Client ID when asked. (This writes it to `.env`; you can also copy `.env.example`
   to `.env` and fill it in by hand.)

## Run

    npm start

Open **http://127.0.0.1:5173** (not `localhost` — Spotify rejects it) and click **Connect Spotify**.

## Keys

← remove · → keep · Space play/pause · Ctrl+Z undo last swipe

## Tips

- Try it on a copy of a playlist first (in Spotify: playlist → ⋯ → Add to other playlist → New playlist).
- Removals happen immediately. Use Undo, or History → Restore, to put songs back at their original spot.
- Restore puts a song back at its original position on a best-effort basis: if the playlist was
  edited elsewhere in the meantime, the position may be off.
- **Liked Songs** is the first tile in the picker. A left swipe un-likes the song. Undo or Restore
  likes it again, but Spotify puts it at the top of Liked Songs with today's date — the original
  "date added" can't be kept.
- If you logged in before Liked Songs support was added, the app asks you to reconnect once so
  Spotify can grant the extra permissions.
- **Remove duplicates** keeps the copy highest in the playlist. Everything starts ticked — untick
  what you want to keep. "Same song, other release" means the same title and artists on a
  different track (single vs. album, remaster). Undo on the result screen puts everything back;
  other-release removals can also be restored later from History, exact copies can't.

## Troubleshooting

**"INVALID_CLIENT: Invalid redirect URI"** — the Redirect URI in your Spotify app's Settings must be
exactly `http://127.0.0.1:5173/callback`: `http`, not `https`; `127.0.0.1`, not `localhost`; no trailing slash.

**"User not registered in the Developer Dashboard"** — new Spotify apps are in Development Mode, where
only allowlisted accounts can log in. Add the Spotify account's email under your app's
Dashboard → **User Management**.

**"No Spotify Client ID configured"** — run `npm run setup`, then stop `npm start` (Ctrl+C) and start
it again. The Client ID is only read on startup.

**The page doesn't load** — `npm start` must keep running in its terminal while you use Swipify.
Start it again if you closed that window.

**No sound, or the player never shows up** — Spotify Premium is required, and it must be a desktop
browser. Check that the Spotify app has **Web Playback SDK** ticked in its Settings.

**"Port 5173 is already in use"** — another copy of Swipify (or another dev server) is running.
Close it first; the port can't change because it's part of the Redirect URI.

**An `EBADENGINE` warning or odd errors during `npm install`** — your Node.js is too old. Install
the current LTS from https://nodejs.org.

## Privacy

There is no Swipify server. The app runs in your browser and only talks to Spotify
(`accounts.spotify.com`, `api.spotify.com` and Spotify's player from `sdk.scdn.co`).

**Stored in your browser only** (local storage): your Spotify login tokens and the History of
removed songs per playlist. Nothing else is saved, and nothing is sent anywhere but Spotify.

**What Swipify asks Spotify for, and why:**

- Read your playlists and Liked Songs — to show the picker and load the songs.
- Change your playlists and Liked Songs — to remove songs on a left swipe and put them back on Undo or Restore.
- Play music and control playback — to play songs in the browser.
- Read your name, email, country and subscription — required by Spotify's in-browser player. Swipify
  itself doesn't use your email.

**To revoke access**, go to https://www.spotify.com/account/apps/ and remove the app you created.
To clear the local data, use your browser's "clear site data" for `127.0.0.1:5173`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
