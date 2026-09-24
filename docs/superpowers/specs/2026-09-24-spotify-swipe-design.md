# Spotify Swipe — Design

Date: 2026-09-24
Status: Approved in conversation, pending written-spec review

## 1. Goal

A personal, Tinder-style web app for cleaning up your own Spotify playlists. You pick one
playlist, its songs play in random order in the browser, and for each song you swipe:

- **Right = keep** (song stays in the playlist)
- **Left = remove** (song is removed from the Spotify playlist immediately)

Success = you can work through a whole playlist quickly, every left swipe is reflected in
Spotify, and any mistake can be undone or restored.

## 2. Decisions & constraints

| Topic | Decision |
|---|---|
| Account | User has Spotify Premium (required for in-browser playback via Web Playback SDK) |
| Platform | PC browser only, runs locally at `http://127.0.0.1:5173` |
| Stack | Vite + React + TypeScript, frontend only (no backend), framer-motion for swipe |
| Auth | Authorization Code with PKCE, in-browser; only a Client ID (no client secret) |
| Removal | Immediate on left swipe; undo of last swipe; session history with per-song Restore |
| Scope per session | One playlist at a time |
| Playback | Full track from 0:00, with play/pause and seek bar; never auto-swipes |
| Resume | Not supported — every session reshuffles all songs from scratch |
| Users | Single user (the Spotify developer app owner) in Spotify development mode |

Spotify constraints that shape the design:

- Only playlists the user **owns or collaborates on** can be edited; others are hidden.
- Spotify no longer accepts `localhost` redirect URIs — must use `127.0.0.1`.
- Spotify changed some playlist endpoints in 2026 (e.g. `/tracks` → `/items`). Exact
  endpoint paths and response shapes **must be verified against current Spotify docs**
  during implementation, not assumed.
- Development-mode apps require the owner to have Premium and are limited to allowlisted users.

## 3. Screens & user flow

1. **Connect** — "Connect Spotify" button starts PKCE login. Client ID comes from
   `.env` (`VITE_SPOTIFY_CLIENT_ID`). Tokens are stored in `localStorage` and refreshed
   automatically, so a reload stays logged in.
2. **Playlist picker** — grid of editable playlists (cover, name, song count).
3. **Swipe** — one card at a time: album art, title, artist(s), album, progress
   (`23 / 140`). Songs are shuffled; each plays from 0:00 in the tab.
   - Drag/fling right → green KEEP stamp → next song.
   - Drag/fling left → red REMOVE stamp → song removed from the playlist → next song.
   - Buttons: ✕ (remove), ↩ (undo), ♥ (keep).
   - Keys: `←` remove, `→` keep, `Space` play/pause, `Ctrl+Z` undo last swipe.
   - Undo reverts the last swipe of either kind; undoing a remove re-adds the song and
     shows its card again.
   - A "Start swiping" button is the first interaction and also unlocks browser audio.
   - **History** button opens a side panel listing songs removed in this session (and
     earlier sessions of this playlist still stored locally), each with **Restore**.
     Restore puts the song back at its original position.
4. **Done** — summary ("Kept 118 · Removed 22 · Skipped 3"), link to History,
   "Pick another playlist".

Edge cases:

- **Local files and podcast episodes** are excluded from the deck and counted as "skipped".
- **Unavailable (region-locked) tracks** get a card marked "can't play" and can still be
  swiped.
- **Duplicates within a playlist** get a single card. Removing removes all copies
  (Spotify removes by URI); restoring re-adds a copy at each original position.
- **Removal history persists** in `localStorage` per playlist so a reload does not lose
  the ability to restore. Swipe progress itself is not persisted.
- If playback is taken over by another device, the card shows
  "Playback moved to another device — Resume here".
- A song ending without a swipe simply stops and waits for a decision.

## 4. Architecture

Project root: `C:\Users\Marco\Desktop\spotify-swipe\`

```
src/
  spotify/
    auth.ts          PKCE (verifier/challenge), login redirect, callback code exchange,
                     token storage, refresh
    api.ts           fetch wrapper: bearer header, 401 → refresh & retry once,
                     429 → wait Retry-After then retry; pagination helper.
                     getMe, getMyPlaylists, getPlaylistItems, removeItems, addItems
    player.ts        Web Playback SDK wrapper: load SDK script, create device,
                     play(uri) on our device, pause/resume/seek, activateElement,
                     emits { position, duration, paused, activeElsewhere, error }
  core/              pure logic, no network, fully unit-tested
    deck.ts          playlist items → cards: filter local/episodes (count skipped),
                     merge duplicates (keep every original position), shuffle with
                     injectable RNG
    session.ts       reducer over the shuffled deck. Actions: keep, remove, undo,
                     restore, removalFailed, restoreFailed. State: current index,
                     kept/removed/skipped counts, undo stack, removed list
    positions.ts     restore index = original index − (number of still-removed
                     positions that were before it)
    historyStore.ts  localStorage persistence of removed songs per playlist
                     (track info, original positions, removedAt)
  hooks/
    useSession.ts    wires reducer ↔ api: optimistic update, API call, rollback +
                     toast on failure, writes historyStore
    usePlayer.ts     React wrapper around player.ts; plays the current card's URI
  components/
    ConnectScreen, PlaylistPicker, SwipeScreen, SwipeCard, PlayerControls,
    HistoryPanel, DoneScreen, Toast
  App.tsx            screen state machine (no router) + /callback handling
```

### Data flow — left swipe

1. `SwipeCard` detects the fling → `useSession.remove()`.
2. Reducer marks the card removed and advances → UI moves on instantly.
3. `api.removeItems(playlistId, [uri])` removes it in Spotify; on success the entry is
   written to `historyStore`.
4. On failure → `removalFailed` action: card returns, toast explains the error.

Restore and undo-of-remove use the same path with `api.addItems(playlistId, [uri],
position)` where `position` comes from `positions.ts`.

### OAuth scopes

`playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`,
`playlist-modify-private`, `streaming`, `user-read-private`, `user-read-email`,
`user-read-playback-state`, `user-modify-playback-state`.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Access token expired | Silent refresh, request retried once |
| Refresh fails | Return to Connect screen; removal history kept |
| 429 rate limit | Wait `Retry-After`, retry |
| Remove/restore fails (403, network) | Roll back state, toast with reason |
| Player account/Premium error | Explicit message on the swipe screen |
| Player initialization error | Message that the browser is unsupported |
| Playback moved to another device | "Resume here" prompt on the card |
| Playlist edited elsewhere mid-session | Removal by URI still works; restore position is best-effort |

## 6. Testing

- **Vitest unit tests, written test-first** for `core/`: deck filtering / duplicate
  merging / seeded shuffle, session reducer transitions, restore-position math,
  historyStore round-trip.
- **PKCE helper tests**: verifier format, S256 challenge against a known vector.
- **api.ts tests with mocked `fetch`**: 401 → refresh → retry, 429 → Retry-After,
  pagination.
- **Manual end-to-end**: user logs in themselves (Claude never handles passwords) and
  uses a **duplicate test playlist**. Claude may then drive the browser pane to verify
  swipe → removed in Spotify → restore → back in Spotify at the same position.

## 7. Out of scope

- Mobile / phone browsers, hosting online
- Multiple playlists per session
- Resuming progress across sessions
- Snippet / chorus-start playback modes
- Multi-user support
