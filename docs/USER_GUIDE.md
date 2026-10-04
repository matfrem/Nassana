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

The panel stays open while you select other notes or zones: it follows the selection. Properties show the column's emoji (when it has one) and, for dropdowns, the color of each value.

Title, description, status and every other column of the row. Fields use the right control: dropdown (values read from the
Sheet's data validation, including lists in another range), checkbox, number, link, and a date field that works with the phone's
numeric keypad (`15012030`), a 📅 calendar button and *Today / Tomorrow / +1 week / Clear* shortcuts. A note's links are listed
at the bottom. Changing the status moves the note into the zone of that name.

### Properties shown on notes

Pills of dropdown columns are colored like the legend: the color picked in the app, else the Sheet's own color, else a tone (priorities), else a palette color.


Custom columns can be shown as a pill on the note (**Columns → Show on notes**, a setting kept in the board, never in the Sheet). Columns whose header already ends with `#` (`dueDate#`, `prio#`… from older versions) start as shown; the app never adds or removes a `#` itself. Types are read from the Sheet
(dropdown, checkbox, date format) or guessed from the values: **dates** turn orange within 2 days and red when overdue,
**priorities** (`high`/`medium`/`low`, `P1`…) are red/orange/green, links show their site name. Columns that are not shown appear only
in the details panel. `title` and `description` are fixed.

## Stamps

Select a note (or several) and tap **★ Stamps**: a grid of 32 stamps opens (🔥 💣 ⭐ ✅ …). Tap a stamp to put it on the note, tap again to take it off; the grid stays open so you can stamp several, and **Close** ends it. A **double tap** on a stamp adds or removes it and closes the grid. With several notes selected, a stamp they all carry is removed from all, otherwise it is added to all. Stamps sit at the top right of the note, sticking out and stacked; after three, a new column starts to its left. A duplicate keeps its stamps; the stamps of a note tucked in a closed stack are not drawn. They are stored in a `stamps` column of `Tasks` (created when needed): the stamp ids separated by commas, e.g. `fire,bomb`.

## Keyboard shortcuts (Edit mode, on a computer)

| Keys | What |
|---|---|
| ← ↑ → ↓ | Move the selected note, or the picked stroke with the Move tool, by one grid step (40 units) |
| Delete / Backspace | Delete the selected note (asks first) or the picked stroke |
| Ctrl/⌘ + C, Ctrl/⌘ + V | Copy and paste a note (a paste is a duplicate; paste again for more) |
| Ctrl/⌘ + A | Select every visible note |
| Esc | Clear the selection, or (nothing selected) leave Edit mode |

Right-click on a note selects it and opens its details. **Undo** in the drawing bar undoes the last drawing action — a stroke added, erased, deleted or moved (up to 100 steps) — and is greyed out when there is nothing left. While notes are colored by a column, the manual color buttons are not offered.

## Selecting several things at once (Edit mode)

- **Computer**: Ctrl/⌘ or Shift + click adds or removes a note, a zone (its title strip) or a drawing stroke (with the Move tool); Shift + drag on the background draws a selection rectangle (notes and strokes it touches, zones it fully contains).
- **Phone**: ⋯ → **⬚ Select**: tap notes, zones or drawing strokes to add or remove them, drag to select a rectangle. While the Select tool is on, only its bar (with the count and **Done**) is shown; press **Done** to get the actions bar.
- The bar then reads "N selected": colors for the selected notes, **Duplicate**, **Delete** (one confirmation), ✕ to clear. Esc or a tap on the background clears too.
- Dragging any selected item (or the arrow keys) moves them all, snapped to the grid. The **✥ Move** button of the bar (the only way on a phone, and for drawing strokes, which are not draggable in the normal mode) lets you drag **anywhere on the board** to move the whole selection; press it again to leave. A selected zone carries its notes and the strokes inside it, each moved once. Dragging a member never makes it a sub-task.
- Ctrl+C / Ctrl+V on several notes pastes copies to the right of the group, with the same layout, the same sub-task structure and the links between them.
- **☰ Details** in the selection bar opens the properties for all selected notes: the first note's values are shown, a **≠** marks a property that differs on the others, and any change is applied to all of them (description, status, dropdowns, dates, parent…). The title is not editable there. Setting a **Parent** makes every selected note a sub-task of it. **⇱ Unparent** also works on a selection.
- Not covered yet (see [TODO](TODO.md)): undo of group moves and deletes, copying zones and strokes.

## Other tools: the ⋯ menu

Rarely used tools live under **⋯**: **▭ Zone** (draw a zone) and **⬚ Select**. Zones, like notes, snap to the grid when dragged.

## Links in descriptions

Every `http(s)://…` link found in a note's description gets an **↗ Open Link N** button under the text in the details panel (it opens in a new tab).

## Zones: a scrum board

A zone has a **title** (and a title size), and an optional **auto-assign status**. With a status, notes dropped in it get that status; with none (the default for a zone you draw yourself) it just groups notes. When the title is empty, the status is shown as the title. Edit all of it in the zone's details (double-tap its header); tapping the header text renames the title.


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
- Tap the badge: the sub-tasks slide out from under the stack and appear around it, joined to it by thin solid lines (badge `▾ 3`; dotted lines are the links you draw). Tap again: they slide back under it and disappear. Sub-tasks can have sub-tasks (a tree): each level has its own badge.
- Make a sub-task: select a note → **＋ Sub-task**; or **Parent** in the details; or **drag a note over another one, hold half a second** (the target gets a dashed outline) and release. Loops are refused (a note can't go under its own sub-task).
- **⇱ Unparent** (next to Duplicate / Delete) frees a sub-task; so does Parent = none in the details.
- The link is stored in a `parent` column of the `Tasks` tab (added automatically). Sub-tasks are ordinary notes: move them anywhere, own status/zone/color/links. A tucked sub-task is hidden wherever it sits.
- Open/closed is shared through the Sheet (Edit mode); in read-only mode your toggles are local. Deleting a parent hands its sub-tasks to its own parent.
- While you drag a note it lifts: shadow and a slight tilt.
- Dragged notes snap onto the dots of the background (40 units apart).

## Color picker

The 🎨 button (next to the quick swatches of a note, a zone or the pen), the legend dots and the dropdown colors in the Columns page open one picker: **On this board** (colors already used, most used first), **Recent** (your last picks, kept in this browser), the **Google Sheets palette**, and **Custom** (hue / saturation / lightness sliders and a hex field). The color applies live; **Done** (or a tap outside) keeps it, **Cancel** puts the previous color back.

## Colors, filters and hiding

The **◐ Filter** button (color and columns) — and, separately, the **👁 View** button (Fit to content, Show links / stamps / property chips, and **Show background**: Dots, a plain **Color…** picked in the color picker, or Empty; remembered per browser). The ◐ Filter button:

- **View → Fit to content** recenters the board; **View → Zoom 100%** resets the zoom (pinch or Ctrl+wheel to zoom otherwise: the − / % / + buttons are gone); **View → Show links**, **Show stamps** and **Show property chips** hide or show the dotted links, the stamps and the pills on notes (remembered per browser; the lines to sub-tasks stay). **Color notes by** a column (menu entries show `label (visible/total)` when a filter is active) or by **Status** (zone colors). A legend appears under the toolbar.
- Where the colors come from, in order: a color you picked in the legend (Edit mode: the dots are color pickers; shared, stored in the
  Sheet), the zone of that name (status), the Sheet's own cell fill or conditional format, a tone for priorities, then a palette.
  The Sheets API cannot read the colors of dropdown *chips*, which is why you pick them here. A fill shared by several values of a
  column (a row or banding color) is ignored.
- **Tap a legend item to hide that value** (every note with it turns into a faint grey shape that can't be touched, so its spot stays taken; its links fade); tap again to show it. Hidden values add up,
  stay when you switch the "color by" column (those of other columns are summed up in one pill per column, e.g. `Status: 2 hidden ✕`, plus **Show all**) and are
  remembered on this device.
- **Tap a pill on a note** to show only that value (`Only Priority: A ✕` clears it).
- **⚙ Edit columns…** (Edit mode) opens the columns page.

## Columns page

The preview at the top is drawn by the board's own code: a sample note with the pills (emoji and value colors included), a description and a stamp.

Each existing column has an **Emoji** dropdown: the emoji is shown before the value in every pill of that column. It is saved in the board (`_board`), not in the Sheet, and applies at once (no Apply needed). **↗ Open in Google Sheets** at the bottom opens the Sheet in a new tab.


Edits the real columns of the `Tasks` tab, like you would in Sheets:

- Rename, reorder (↑ ↓), **Show on notes** (a board setting, applied at once), **Hidden in the Sheet**, delete.
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
