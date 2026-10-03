# Architecture

A single-page React 18 + TypeScript app built with Vite, hosted as static files on GitHub Pages. **No backend:** the browser signs in
with Google and calls the Sheets API directly. The Sheet is the database (formats: [SHEET_FORMAT.md](SHEET_FORMAT.md)).

## Code map

| Path | Role |
|---|---|
| `src/main.tsx`, `App.tsx` | Entry, hash router (`#/`, `#/demo`, `#/sheet/<id>`), `ErrorBoundary.tsx` (a crash shows a message, not a blank page). |
| `Home.tsx`, `recent.ts` | Landing page, recent Sheets (localStorage). |
| `BoardView.tsx` | **The orchestrator**: all board state (tasks, zones, strokes, links, colors…), loading, polling, the save queue, every edit handler, toolbar and bars. Big on purpose: one place owns the state. |
| `board/Board.tsx` | The viewport: camera, wheel/pinch/pan, and the **gesture state machine** for every tool (pan, pen, eraser, move, zone, link). Renders zones, links, notes, ink. |
| `board/StickyNote.tsx`, `ZoneView.tsx` | One note / one zone: dragging, tap and double-tap, inline title editing, pills, drawing layer, resize handle. |
| `board/InkLayer.tsx`, `LinksLayer.tsx` | SVG layers inside the world: board strokes, dotted links. |
| `board/camera.ts`, `ink.ts`, `links.ts`, `zones.ts` | Pure logic: coordinate math, stroke simplify/encode/decode/hit-test, link geometry/encoding, zone rules (`zoneAt`, `applyZones`). |
| `fields.ts` | Custom columns: type inference, pills, date handling, `toCell`, text color for a background. |
| `DetailPanel.tsx`, `ZonePanel.tsx`, `DateField.tsx` | Side panel / bottom sheet for a note or a zone. |
| `ColumnsPage.tsx` | The columns editor (staged drafts, validation, summary). |
| `google/auth.ts` | Google Identity Services token client, `drive.file` scope, token kept in memory. |
| `google/picker.ts` | Google file picker (`setFileIds` limits it to one file). |
| `google/sheets.ts` | All Sheets reads/writes for tasks, `_board` rows, field metadata. |
| `google/columns.ts` | Reads the tab's structure and builds the single `batchUpdate` of the columns page (pure `buildRequests`). |
| `config.ts`, `constants.ts`, `types.ts` | Public Google IDs, sizes/palettes, shared types. |

`localStorage` keys: `nassana.signedIn`, `nassana.recent`, `nassana.colorBy.<sheetId>`, `nassana.hidden.<sheetId>`. Nothing else is stored locally.

## Main mechanisms

### World, camera and zoom-independent UI
Everything lives in a `.world` div transformed by `translate(camera.x, camera.y) scale(camera.zoom)`; the zoom is also exposed as a CSS variable
(`--zoom`) so selection outlines, link dots, resize handles and halos keep a constant on-screen size (`calc(3px / var(--zoom))`).
Zooming keeps the world point under the cursor/fingers fixed (`zoomAt`). Rendering is DOM for notes and SVG for ink/links: plenty for
a few hundred notes and it keeps text crisp and selectable.

### Gestures (the delicate part)
- Pointer events everywhere; the viewport has `touch-action: none`. Notes and zones handle their own drags and stop propagation, so
  **the board registers touches in the capture phase** (`onPointerDownCapture`): that is how a second finger is seen even when the first one
  is holding a note or a zone.
- With two touches the board enters `pinch` mode (pan by the midpoint + zoom by the spread), bumps an `epoch` counter and cancels what was in
  progress. Notes/zones get a `gesture()` getter; they stop dragging when `multi` is true or the epoch changed since their pointerdown, so the
  finger left over never resumes a drag. A window-level `pointerup/cancel` listener drops lifted fingers even if their element is gone.
- Taps vs drags use a 4 px slop; double-tap is two taps within 350 ms and 30 px. A mouse's middle/right button always pans.
- Tools are modes of one machine (`pan | draw | erase | move | zone | link | pinch`): a pointerdown picks the mode, move/up act on it.

### Saving
- Edits update React state at once (optimistic) and mark what is *dirty*: per task `{title, board, drawing, status, description, cols}`,
  plus sets of dirty zones, strokes, links and colors.
- A flush runs 800 ms after the last edit (and on **Done**). It builds patches **only for the changed cells**, reads the tab once, finds each row by `id`
  and writes with one `values.batchUpdate`. Writes are chained in a promise queue (`enqueue`) so a rename never races the creation of its row.
- Creation/deletion are immediate queue jobs. On failure the optimistic change is rolled back (new items removed) or the board is reloaded
  (`load(true)`) and the badge shows the error with **Retry**; dirty marks are kept for the next attempt.
- Auto-placed notes (no saved position) are flagged `autoPlaced` and written on the first flush of an edit session, so the layout never shifts.
- While editing, polling is paused; leaving Edit mode flushes, then reloads.

### Loading and refresh
`load()` fetches the tab and the `_board` data in parallel; it then applies zone rules (`applyZones`) to the notes. Dropdown lists, date formats and
cell colors come from a separate grid-data call, made only on explicit loads (not on the 30 s background poll). Background failures are silent.
Errors with a known repair (missing tab, empty header, missing columns, no access yet) show a button that fixes it.

### Properties
`columnsOf` lists the non-reserved header cells; `buildFields` types each column (Sheet metadata first, then the values); `chipFor` makes the pill
(and its tone); `toCell` converts a typed value back to what the Sheet should hold. A fixed `valueOf(task, key)` lets `status` be colored/filtered like a column.
Colors per value, in order: picked in the legend (`color` rows) → zone of that name (status) → the Sheet's fill / conditional format (a fill shared by
several values is discarded as a row/banding color) → tone → palette. Text color switches to light on dark fills (`inkFor`).

### Zones and status
`zoneAt` returns the topmost zone under a point; a note belongs to the zone containing its centre. `applyZones` implements the load-time rules
(unplaced note → zone of its status; note in the wrong zone → zone of its status; otherwise untouched) and lays moved notes on a grid inside the zone.
Drops, renames and resizes push the zone's name into the status of the notes inside.

### Drawing
Strokes are polylines simplified with Ramer-Douglas-Peucker at about one screen pixel, stored as one-decimal deltas, and re-simplified with a growing
tolerance until the cell is under 45 000 characters. A stroke belongs to the note under its first point (stored in note coordinates in `drawing`) or to the board
(`_board`). The move tool hit-tests with a 14 px tolerance and clamps note strokes so they can't leave their note entirely.

### Columns page
Local **drafts** per column → `buildRequests` turns them into one ordered `batchUpdate` (drop color rules → delete columns → reorder within the slots custom
columns already occupy → append new columns → write headers → validation/format/color rules → hide), computing final indexes by simulating the grid.
`applyColumns` re-reads the structure and refuses if its signature changed since the page opened. The order logic was checked with a small grid simulator.

## Design decisions

- **The Sheet is the truth, no backend.** Zero hosting cost, everything inspectable and editable in Sheets, access control = the Sheet's sharing.
- **`drive.file` + Picker** instead of full Sheets access: a non-sensitive scope (no "unverified app" wall for every user), and the app provably only touches
  files the user picked.
- **One row per item in `_board`** (zones, strokes, links, colors) rather than one big JSON cell: appends never conflict between editors, and the 50 000-char
  cell limit never bites the whole board.
- **Vector strokes, not images**: tiny, editable (move/erase), crisp at any zoom.
- **Native Sheets features for column config** (validation, formats, conditional formats, hidden columns) so the Sheet stays usable on its own.

## Gotchas learned the hard way

- GitHub Pages must use the **GitHub Actions** source, or it serves the raw sources (blank page, 404 on `/src/main.tsx`). `index.html` is cached ~10 min.
- The Sheets API **cannot read the colors of dropdown chips** (only cell fills and conditional formats), hence the legend color pickers.
- `UNFORMATTED_VALUE` returns dates as serial numbers (days since 1899-12-30) and checkboxes as booleans: hence the type inference and `toCell`.
- A click after `setPointerCapture` is retargeted to the capturing element: interactive bits inside notes (pills) stop `pointerdown` propagation.
- Google's OAuth consent screen in *Testing* mode only lets listed test users in.

## Testing

- **Unit** (Vitest, `src/**/*.test.ts`): `npm test`. Pure logic: ink encoding, zones, links, fields, Sheets helpers, columns requests, view state.
- **End-to-end** (Playwright Test, `tests/e2e`): `npm run test:e2e`. The Google APIs are replaced by an in-memory `FakeSheet` through request
  interception; touch gestures use real `Input.dispatchTouchEvent`. If the browser isn't installed: `npx playwright install chromium`, or set
  `CHROMIUM_PATH` to an existing Chromium binary.
- `npm run test:all` runs both. CI: `.github/workflows/test.yml`.

Per-browser view state (color-by, hidden values, filter, camera) lives in `localStorage` under `nassana.view.<sheetId>` (`src/viewState.ts`).

## Known limits and ideas

- No real-time sync: other people's changes arrive on refresh (30 s in read-only). Two editors moving the same note: last write wins.
- Changing a column's type doesn't convert existing values; hide/filter/color-by choices live on the device, not in the Sheet.
- Undo covers strokes only; deleting a note/zone/column is final (use Sheets' version history).
- Ideas: 🔒 on a note whose predecessor isn't in the last zone, auto-scroll the board under an open panel, list/table view, creating a Sheet from the app,
  per-board settings stored in `_board`.
