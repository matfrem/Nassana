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
- [ ] Google sign-in + reading the Sheet
- [ ] Saving positions, color, renaming
- [ ] Drawing on the board
- [ ] Creating / deleting tasks
