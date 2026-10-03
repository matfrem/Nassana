# Nassana

An infinite 2D board (pan and zoom like Miro) that shows the rows of a Google Sheet as sticky notes.
Move, color, draw on, link and group the notes into zones (a scrum board); everything is written back to the Sheet,
which stays the single source of truth.

- **Live app:** https://matfrem.github.io/Nassana/
- **Stack:** React 18 + TypeScript + Vite, no backend. The browser talks to the Google Sheets API directly.

## Documentation

| | |
|---|---|
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | How to use the app: modes, notes, zones, drawing, links, filters, the columns page, touch gestures. |
| [docs/SHEET_FORMAT.md](docs/SHEET_FORMAT.md) | What the app reads and writes in your Sheet: the `Tasks` tab, the `_board` tab, every JSON format. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Code map, how the main mechanisms work, design decisions, known limits and ideas. |

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-checks, then builds to dist/
```

Open the app, press **Choose a Sheet from Google Drive** (or paste a link) and sign in. **Try the demo** needs no Sheet.

A Sheet needs a tab named **`Tasks`** with at least the columns `id` and `title`. If the tab or the header row is missing,
the app offers to create it. Full format: [docs/SHEET_FORMAT.md](docs/SHEET_FORMAT.md).

## Google Cloud setup (once)

1. Create a project in the Google Cloud Console and enable **Google Sheets API** and **Google Picker API**.
2. OAuth consent screen: user type *External* (or *Internal* inside a Workspace organisation). While the app is in *Testing*,
   add each user under *Test users*.
3. Credentials → **OAuth client ID** (Web application). Authorized JavaScript origins: `http://localhost:5173` and
   `https://<user>.github.io`.
4. Credentials → **API key**, restricted to the website `https://<user>.github.io/*` and to the *Google Picker API*.
5. Scope: **`drive.file`** only. The app can only touch the Sheets a user explicitly picks in the Google Picker.
6. Put the IDs in `src/config.ts`, or set `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_API_KEY` at build time. They are public by
   design (the key is restricted to the site's origin and to the Picker API).

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main` (and to the working branch listed in the
workflow). Required once, in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

- With *Deploy from a branch* GitHub serves the raw source files and the page stays blank (the symptom is a 404 on `/src/main.tsx`).
- GitHub Pages caches `index.html` for about 10 minutes. After a deployment, reload with a changed query string
  (`…/Nassana/?v=2`) to skip a stale cache.

## What is not here yet

- Tests: `npm test` (unit) and `npm run test:e2e` (Playwright, fake Sheet) — see [Testing](docs/ARCHITECTURE.md#testing).
- No real-time collaboration: changes of other people appear when the board refreshes (every 30 s in read-only mode, or on ↻).
- Offline use, undo/redo for everything but strokes, converting a column's existing values when its type changes.
