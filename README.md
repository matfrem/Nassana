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
- [ ] Saving positions, color, renaming
- [ ] Drawing on the board
- [ ] Creating / deleting tasks

## Sheet format

A tab named `Tasks` with a header row. Columns are matched by name (case-insensitive), extra columns are ignored:

| id | title | board |
|----|-------|-------|
| 1  | Call the client | `{"x":0,"y":0,"color":"#FFE066"}` |

`id` must be unique and stable. `board` is optional: rows without a position are laid out automatically.
