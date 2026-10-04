# To do / ideas for later

## Planned
- **Multi-sprint / swimlane boards.** Zones with several rules (`column = value`, e.g. `status = To Do` and `sprint = S3`); a generator that lays out a grid of zones (rows = sprint, epic or any dropdown column, columns = status) with headers, like a classic scrum wall; a sprint selector in the View menu. Decision so far: keep one `Tasks` table with a `sprint` column rather than one Sheet tab per sprint; maybe a later "Archive this sprint" that copies finished rows to a dated tab. Epics are plain notes with sub-tasks (a row per epic is a possible layout).
- **Multi-selection** (Shift/Ctrl to add or remove), for notes and drawing objects: move together, delete, copy/paste, color. Design sketch: one selection set of `{kind: note | stroke | zone, id}` replacing today's three single selections (a single selection is a set of one). Ctrl/Cmd+click (and Shift+click) toggles an item; Shift+drag on the background draws a selection rectangle; on touch a "Select" tool (tap toggles, drag draws the rectangle). Dragging or arrow-keying any member moves them all (notes inside a selected, moving zone are not moved twice; strokes drawn on a note follow it); Delete asks once ("Delete 5 notes?"); Ctrl+C/V copies the set keeping relative layout and the links/parents between its members; the selection bar shows "5 selected" with color/duplicate/delete; the details panel opens only for a single note. Esc or a tap on the background clears it.
- **Resizable notes** (a resize handle). Needs a size per note in the `board` JSON, and links/zones/snap to stop assuming a fixed note size.
- Test the zoomed-out rendering on desktop and phones; if it still struggles, a simplified drawing mode below ~20 % zoom.

## Ideas
- 🔒 on a note whose predecessor isn't in the last zone.
- Auto-scroll the board under an open panel.
- List / table view.
- Creating a Sheet from the app.
- Per-board settings stored in `_board`.
