# User guide

## Opening a board

- **Home:** *Choose a Sheet from Google Drive* opens the Google file picker; or paste a Sheet link. Recent Sheets are listed.
- A board has its own address, `…/Nassana/#/sheet/<id>`: share that link. Anyone who opens it signs in with Google and presses
  **Choose this Sheet** once (the app can only open Sheets a user picked; they still need access to the Sheet itself).
- `#/demo` is a local demo with placeholder notes; nothing is saved.

## Two modes

- **Read-only** (default): pan, zoom, tap a note for its details, filter, color. Nothing can be moved by accident.
  The board refreshes by itself every 30 s; **↻** refreshes now.
- **Edit** (**✎ Edit**, leave with **✓ Done** or Esc): everything below. You need edit rights on the Sheet; otherwise
  saving fails with an explicit message.

The badge at the bottom left shows *Read-only / Edit mode / Saving… / Saved ✓*, or the error and a **Retry** button.
Changes are saved about 0.8 s after the last action, cell by cell, never by overwriting whole rows.

## Moving around

Mouse: drag the background to pan, wheel to zoom (centered on the cursor), middle/right button pans while a tool is active.
Touch: one finger pans; **two fingers pan and zoom together, from anywhere**, even when the first finger is on a note or a zone
(nothing is moved while two fingers are down). Zoom is clamped to 10 %–400 %. At low zoom notes show only their title; pills
appear from about 45 % and the description from about 80 %.

## Notes

In Edit mode:

- **＋ Note** adds a note in a free spot at the centre of the screen and opens its title for typing (Enter validates, Esc cancels).
- **Drag** a note to move it. **Tap** selects it: the bottom bar offers 6 colors, **☰ Details**, **⧉ Duplicate** (title,
  description, status, properties and drawing; not its links) and **🗑 Delete** (also deletes the row in the Sheet, and its links).
- **Double-tap** opens the details directly. In read-only mode a single tap does.

### Details panel

Title, description, status and every other column of the row. Fields use the right control: dropdown (values read from the
Sheet's data validation, including lists in another range), checkbox, number, link, and a date field that works with the phone's
numeric keypad (`15012030`), a 📅 calendar button and *Today / Tomorrow / +1 week / Clear* shortcuts. A note's links are listed
at the bottom. Changing the status moves the note into the zone of that name.

### Properties shown on notes

Any column whose header ends with `#` (`dueDate#`, `prio#`…) is shown as a pill on the note. Types are read from the Sheet
(dropdown, checkbox, date format) or guessed from the values: **dates** turn orange within 2 days and red when overdue,
**priorities** (`high`/`medium`/`low`, `P1`…) are red/orange/green, links show their site name. Columns without `#` appear only
in the details panel. `title` and `description` are fixed.

## Zones: a scrum board

**▭ Zone** then drag on the board to draw a rectangle. A zone's name *is* the status:

- Dropping a note in a zone sets the note's `status` to the zone's name (outside every zone, the status is kept).
- The Sheet is the source of truth. When the board loads: a note with no saved position goes into the zone named like its status;
  a note sitting in a zone whose status names a *different* zone moves there. Notes outside every zone stay put, and a status that
  matches no zone is ignored. These automatic moves are saved the next time someone edits.
- **Moving a zone** carries the notes inside it and the board strokes drawn entirely inside it. Renaming or resizing a zone gives
  its name as status to the notes inside it.
- Each zone shows how many notes it holds; with a **work-in-progress limit** the counter turns red above it (`5/3`).
- In the zone tool: **Add Backlog / In progress / Done** (on an empty board) and **One zone per status (N)**, which creates a zone for
  every status in the Sheet that has none and moves the matching notes into it.

Tap a zone's title strip to select it (color, **Details**, Delete); in **Details** you set its name, color and limit. Double-tap
opens Details directly. The round handle at the bottom right resizes. Deleting a zone leaves its notes where they are.

## Drawing

**✏ Draw** opens the drawing bar: **pen**, **move ✥**, **eraser ⌫**, 6 colors, thin/thick, **undo ↶**.

- A stroke that **starts on a note belongs to that note** (it follows the note and is clipped to it); anywhere else it is a board stroke.
- **Move** (✥): press a stroke and drag it (a note stroke always keeps part of itself inside its note); 🗑 deletes the selected stroke.
- The eraser removes whole strokes. Undo removes the last stroke you drew.
- Each note's drawing and each board stroke has a size budget (a Sheets cell holds 50 000 characters); strokes are simplified to fit,
  and the app tells you when a note's drawing is full.

## Links

**⤳ Link**: press a note, drag to another one, let go. A dotted line with an arrow pointing at the second note is drawn between
their borders and follows them. Tap the line (Edit mode, no tool) to cycle **→ arrow / ↔ both ways / — no arrow** or delete it.
Links are not drawn between overlapping notes, and a link to a hidden note is hidden.

## Stacks: tasks and sub-tasks

- A note with sub-tasks shows other post-its peeking out from under it, slightly tilted, and a badge `▤ 3` (number of sub-tasks).
- Tap the badge: the sub-tasks slide out from under the stack and appear around it, joined to it by dotted lines (badge `▾ 3`). Tap again: they slide back under it and disappear. Sub-tasks can have sub-tasks (a tree): each level has its own badge.
- Make a sub-task: select a note → **＋ Sub-task**; or **Parent** in the details; or **drag a note over another one, hold half a second** (the target gets a dashed outline) and release. Loops are refused (a note can't go under its own sub-task).
- **⇱ Unparent** (next to Duplicate / Delete) frees a sub-task; so does Parent = none in the details.
- The link is stored in a `parent` column of the `Tasks` tab (added automatically). Sub-tasks are ordinary notes: move them anywhere, own status/zone/color/links. A tucked sub-task is hidden wherever it sits.
- Open/closed is shared through the Sheet (Edit mode); in read-only mode your toggles are local. Deleting a parent hands its sub-tasks to its own parent.
- While you drag a note it lifts: shadow and a slight tilt.
- Dragged notes snap onto the dots of the background (40 units apart).

## Colors, filters and hiding

The **◐** button:

- **View → Fit to content** recenters the board. **Color notes by** a column (menu entries show `label (visible/total)` when a filter is active) or by **Status** (zone colors). A legend appears under the toolbar.
- Where the colors come from, in order: a color you picked in the legend (Edit mode: the dots are color pickers; shared, stored in the
  Sheet), the zone of that name (status), the Sheet's own cell fill or conditional format, a tone for priorities, then a palette.
  The Sheets API cannot read the colors of dropdown *chips*, which is why you pick them here. A fill shared by several values of a
  column (a row or banding color) is ignored.
- **Tap a legend item to hide that value** (every note with it disappears, with its links); tap again to show it. Hidden values add up,
  stay when you switch the "color by" column (those of other columns are summed up in one pill per column, e.g. `Status: 2 hidden ✕`, plus **Show all**) and are
  remembered on this device.
- **Tap a pill on a note** to show only that value (`Only Priority: A ✕` clears it).
- **⚙ Edit columns…** (Edit mode) opens the columns page.

## Columns page

Edits the real columns of the `Tasks` tab, like you would in Sheets:

- Rename, reorder (↑ ↓), **Show on notes** (the `#` suffix), **Hidden in the Sheet**, delete.
- Type: Text, Number, Date, Checkbox, Dropdown. A dropdown has an editable list of values, each with a color (written as one
  conditional-format rule per value, so the Sheet itself shows the colors).
- **Managed by the app** (`id`, `title`, `description`, `status`, `board`, `drawing`): cannot be renamed or deleted, only hidden in the
  Sheet; a missing `description` or `status` can be added.
- Changes are staged. **Apply** lists them, checks nobody changed the Sheet's structure meanwhile, then sends everything in one
  request: the Sheet's version history can undo it. Changing a type does not convert existing values.

## Warnings

- *N row(s) skipped: empty id*: those rows have a title but no id, so the board can't show them. **Give them an id** writes a fresh id
  in each. If some are section headings rather than tasks, don't, or delete them from the Sheet.
- *N row(s) skipped: duplicate id*: ids must be unique; the first row wins.

The view (color-by, hidden values, filter, camera) is remembered per browser and per Sheet.
