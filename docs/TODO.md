# To do / ideas for later

## Planned
- **Multi-sprint / swimlane boards.** Zones with several rules (`column = value`, e.g. `status = To Do` and `sprint = S3`); a generator that lays out a grid of zones (rows = sprint, epic or any dropdown column, columns = status) with headers, like a classic scrum wall; a sprint selector in the View menu. Decision so far: keep one `Tasks` table with a `sprint` column rather than one Sheet tab per sprint; maybe a later "Archive this sprint" that copies finished rows to a dated tab. Epics are plain notes with sub-tasks (a row per epic is a possible layout).
- Multi-selection extras: undo for group moves/deletes of notes and zones, copy/paste of zones and strokes, selecting the strokes drawn on notes.
- **Resizable notes** (a resize handle). Needs a size per note in the `board` JSON, and links/zones/snap to stop assuming a fixed note size.
- Test the zoomed-out rendering on desktop and phones; if it still struggles, a simplified drawing mode below ~20 % zoom.

- **Stamps, next steps**: filter / legend by stamp ("only the 🔥"); a custom or editable list of stamps; if a closed stack should show its sub-tasks' stamps, draw them at the *bottom* of the parent note (not at the top right, which would mix with its own stamps) — to decide when we see how busy it gets.
- Column emoji: it is keyed by the column's header, so renaming a column in the Columns page drops its emoji (re-pick it); an emoji can only be chosen for existing columns (after Apply for new ones).

## Ideas
- 🔒 on a note whose predecessor isn't in the last zone.
- Auto-scroll the board under an open panel.
- List / table view.
- Creating a Sheet from the app.
- Per-board settings stored in `_board`.
