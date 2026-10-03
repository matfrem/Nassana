# Nassana

Infinite 2D board (Miro-style pan / zoom) that displays the rows of a Google Sheet as sticky notes.
Each note's position and color are stored in the `board` column of the Sheet.

## Development

```bash
npm install
npm run dev
```

## Deployment

GitHub Pages via `.github/workflows/deploy.yml` (on push to `main`).
In the repo: Settings → Pages → Source: **GitHub Actions**.

## Status

- [x] Infinite canvas: pan, cursor-centered zoom, touch pinch
- [x] Read-only / Edit mode, note dragging (placeholder data)
- [x] Google sign-in + reading the Sheet (read-only, polls every 30s)
- [x] Saving positions (debounced, by row id)
- [x] Add note, color, rename, delete (Edit mode: tap a note to select it)
- [x] Drawing on the board (pen, eraser, undo; strokes stored one per row in the `_board` tab)
- [x] Drawing on notes (a stroke started on a note belongs to it; stored in the `drawing` column)
- [x] Two-finger pan + zoom on touch screens

## Sheet format

A tab named `Tasks` with a header row. Columns are matched by name (case-insensitive), extra columns are ignored:

| id | title | board |
|----|-------|-------|
| 1  | Call the client | `{"x":0,"y":0,"color":"#FFE066"}` |

`id` must be unique and stable. `board` is optional: rows without a position are laid out automatically.

## Google Cloud setup

- OAuth client (Web application) with authorized JavaScript origins: `http://localhost:5173` and the Pages origin.
- APIs enabled: Google Sheets API, Google Picker API.
- API key restricted to the Pages origin and to the Picker API.
- Scope: `drive.file` only. The app can only touch Sheets the user picks in the Google Picker.

Override the built-in public IDs with `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_API_KEY` if needed.

## Drawing storage

Strokes live in a tab named `_board` (created on the first stroke), one row per stroke:

| id | type | data |
|----|------|------|
| 3f9a1c2b | stroke | `{"c":"#E5484D","w":3,"p":[x0,y0,dx,dy,...]}` |

`p` is the simplified polyline in board coordinates (first point absolute, then deltas).
A Sheets cell holds 50 000 characters at most, so strokes are simplified until they fit.

Strokes drawn **on a note** are stored in the note's own `drawing` column (created on first use):
a JSON array of `{"c","w","p"}` in note coordinates, so they follow the note and are clipped to it.
