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
- [x] Zones = scrum board: a note dropped in a zone takes the zone's name as its `status`
- [x] Custom properties: `xxx#` columns become pills on notes; details panel; quick filter; color-by; zone counters + WIP limit
- [x] Move tool for strokes (press a stroke and drag; board strokes and note strokes)
- [x] Links between notes: dotted line with an arrow, drag from one note to another (rows of type `link` in `_board`)
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

## Zones (scrum board)

A zone is a rectangle with a name; its name is the status. Zones are rows of type `zone` in the `_board` tab:
`{"x","y","w","h","name","color"}`. Notes get a `status` column (created on first use).

- Dropping a note in a zone sets the note's `status` to the zone's name. Dropping it outside every zone keeps its status.
- The Sheet is the source of truth: on load, a note with no saved position goes into the zone named like its status,
  and a note sitting in a zone whose status names a *different* zone moves there. Notes outside every zone stay put.
- Moving a zone carries the notes inside it, and the board strokes drawn entirely inside it. Renaming or resizing a zone gives its name as status to the notes inside.

## Properties

- `title` and `description` are fixed columns. Any column whose header ends with `#` (e.g. `dueDate#`, `prio#`) is shown
  as a pill on the note. Other custom columns only appear in the details panel. Columns are matched by name.
- Types come from the Sheet itself when it says something (dropdown validation, checkbox, date format) and otherwise
  from the values: dates (overdue = red, due within 2 days = orange), numbers, checkboxes, links, priorities
  (`high`/`medium`/`low`, `P1`...). Dropdown lists, including lists read from another range, become `<select>`s in the panel.
- Tap a note to open its panel (editable in Edit mode). Tap a pill to filter on that value. The `◐` button colors notes
  by a property (kept per device). Zones show how many notes they hold; the `⏱ Limit` button sets a WIP limit.
- Zoomed out, notes show only their title; pills appear at about 45% zoom and the description at about 80%.

## Editing notes and zones

In Edit mode, tap a note or a zone's title strip to select it; the bottom bar offers colors, **Details**, and (for notes)
**Duplicate**, plus Delete. Double-tap opens the details directly. Notes and zones are renamed in their details panel;
a zone's panel also holds its color and work-in-progress limit. Dates are typed with the numeric keypad (`15012030`),
picked from the calendar button, or set with the Today / Tomorrow / +1 week shortcuts.

## Links

The **⤳ Link** tool (Edit mode): press a note, drag to another note, let go. A dotted line with an arrow pointing at the
second note is drawn border to border and follows the notes. Tap a line to cycle its arrows (→ at the end, ↔ both ends, none) or delete it; a note's details
panel lists its links and can remove them. Deleting a note deletes its links. A link is a row `id | link | {"from","to","arrow"}`
in the `_board` tab (`arrow` is `one`, `both` or `none`; older rows with a boolean are still read), so adding or removing one never rewrites a task row.

## Touch

A second finger always turns the gesture into pan + zoom, even when the first finger is holding a note, a zone or
a resize handle: nothing is moved while two fingers are down, and the finger left over does not start dragging afterwards.

## Colors from the Sheet

When notes are colored by a column (the `◐` button), each value takes the background color the Sheet gives to the cells
holding it (a fill, or the result of conditional formatting), read with the dropdown lists on load / refresh. Values whose
cells have no fill keep the app's palette (or a red/orange/green tone for priorities). Note text switches to light on dark fills.

## Columns page

Edit mode → `◐` → **Edit columns…** opens a page that edits the Tasks tab's real columns: rename, order (↑↓), show on notes
(the `#` suffix), type (text, number, date, checkbox, dropdown), dropdown values with a color each, add, delete, and hide
the columns the app manages (`id`, `title`, `description`, `status`, `board`, `drawing`) in the Sheet. Changes are staged in
the page; **Apply** lists them, re-checks that nobody changed the Sheet's structure, and sends them in a single `batchUpdate`
(so the Sheet's version history can undo it). Dropdowns become data validation; their colors become one conditional-format
rule per value, which the board reads back when coloring notes.

## Coloring by a column or by status

`◐` → **Color notes by**: any custom column, or **Status** (each status takes the color of the zone with that name).
In Edit mode the legend's dots are color pickers: a color picked there is kept in the `_board` tab (rows of type `color`)
and wins over the Sheet's own color. This exists because the Sheets API cannot read the colors of dropdown *chips*. Colors found
in the Sheet are cell fills / conditional formatting; a fill shared by several values of a column (a row or banding color) is
ignored. Rows that have a title but no id are listed in a warning with a **Give them an id** button.
