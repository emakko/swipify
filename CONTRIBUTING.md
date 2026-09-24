# Contributing

Follow the setup in the [README](README.md) first, then:

    npm start        # dev server at http://127.0.0.1:5173
    npm test         # unit tests (Vitest)
    npm run build    # type-check and build into dist/

CI runs `npm test` and `npm run build` on every push and pull request.

## Layout

- `src/spotify/` — PKCE login, Web API client, Web Playback SDK wrapper
- `src/core/` — deck shuffling, playlist/position logic, persisted swipe history
- `src/session/` — swipe session controller (keep, remove, undo, restore)
- `src/dedupe/` — remove-duplicates run controller (remove, retry, undo, restore)
- `src/components/`, `src/hooks/` — React UI
- `scripts/setup.mjs` — the `npm run setup` Client ID prompt

## Manual checklist

Run through this against a real Spotify account before merging changes to swiping, history or restore:

- Include a region-locked or relinked track in the test playlist if you have one.
- Reload the page right after a left swipe — History must still list the song.
- Re-add a removed song in the Spotify app, then reopen the playlist here — it must not be
  listed in History anymore.
- Liked Songs: swipe a song left, check it is un-liked in Spotify, Restore it from History, and check
  it is liked again (at the top).
- Remove duplicates on a copy of a playlist with a song three times, a single + album version and
  a local file: check the order in Spotify afterwards, then Undo and check it matches the original.
- Remove duplicates, reload, open the playlist again in Remove duplicates and Restore the other
  release from History.
