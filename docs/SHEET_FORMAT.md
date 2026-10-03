# What the app reads and writes in your Sheet

The Sheet is the single source of truth. The app keeps no database: everything below lives in two tabs of the file you picked.

## The `Tasks` tab (required)

Row 1 is a header. Columns are matched **by name** (case-insensitive, trimmed), so their order and any extra column don't matter.
One row = one task = one note. Rows are always found by `id`, never by position, so sorting or inserting rows in the Sheet is safe.

| Column | Required | Written by | Content |
|---|---|---|---|
| `id` | yes | you / the app | Unique and stable text or number. New notes get 8 hex characters. Rows with a title but no id are skipped (the app can write ids for you). |
| `title` | yes | you / the app | The note's text. |
| `description` | no | you / the app | Longer text, shown small on the note when zoomed in. |
| `status` | no | the app / you | Free text. Equals the name of the zone the note sits in. See [Zones](USER_GUIDE.md#zones-a-scrum-board). |
| `board` | no | the app | `{"x":-270,"y":-107,"color":"#FFE066"}`: position of the note's top-left corner in board units and its color. The note is 180 × 180. Missing or invalid: the note is laid out automatically (5 per row, step 220) below the placed ones, and saved on the next edit. |
| `drawing` | no | the app | Strokes drawn on this note, see below. |
| *anything else* | no | you | **Custom properties.** A header ending in `#` (`dueDate#`) is shown as a pill on the note; the others only in the details panel. |

Created on first use: `board`, `drawing`, `status`, `description` (the app appends the header cell). Hide them in the Sheet if you
like (columns page, or Sheets' own *Hide column*): the app doesn't care.

### Property types

Read from the Sheet when it says something, otherwise guessed from the values (first match wins):

1. **Dropdown**: data validation *List of items* or *List from a range* → values offered in the details panel.
2. **Checkbox**: data validation *Checkbox*, or only `TRUE`/`FALSE` values.
3. **Date**: number format *Date*/*Date time*, a *Date* validation, ISO text (`2026-10-03`), or a date-like name (`due`, `deadline`…) with plausible serial numbers.
4. **Number**, **link** (all values `http(s)://…`), else **text**.

Writes keep the column's own representation: a date in a date-formatted column is written as a serial number, a checkbox as a boolean, and so on.

### `drawing` format

A JSON array of strokes, in **note coordinates** (0–180, origin at the note's top-left):

```json
[{"c":"#E5484D","w":3,"p":[39.5,158,65.8,26.3,105.3,13.2]}]
```

`c` color, `w` line width, `p` the polyline as `x0,y0,dx1,dy1,dx2,dy2…`: the first point is absolute, the following ones are
**deltas** from the previous point; one decimal. A Sheets cell holds 50 000 characters; the app keeps each cell under 45 000 by
simplifying strokes (Ramer-Douglas-Peucker, with a growing tolerance) and refuses a stroke that still doesn't fit.

## The `_board` tab (created on first use)

Everything that is not a task: one row per item, header `id | type | data`, `data` being JSON.

| `type` | `id` | `data` |
|---|---|---|
| `stroke` | 8 hex | `{"c","w","p"}` as above, in **board coordinates**. |
| `zone` | 8 hex | `{"x","y","w","h","name","color","limit"}`. `name` is also the status; `limit` (optional) is the work-in-progress limit; `color` is `#rrggbb`. |
| `link` | 8 hex | `{"from":"<task id>","to":"<task id>","arrow":"one"}`; `arrow` is `one` (head at `to`), `both` or `none`. Older rows with a boolean are still read (`true` = `one`, `false` = `none`). |
| `parent` | `parent:<child id>` | The id of the child's parent note (a stack of tasks). One row per sub-task; no row = free note. |
| `open` | `open:<parent id>` | `1`. The stack of that note is spread open; no row = tucked away (shared by everyone). |
| `color` | `color:<column key>\|<value>` | `{"key":"priority#","value":"a","color":"#FF8800"}`: the color picked in the legend for one value of a column; `key` is the lowercased header (or `status`), `value` is lowercased and trimmed. |

Adding or removing an item appends or deletes a row; editing one rewrites its `data` cell. Links whose notes no longer exist are
ignored when drawing. Unknown or malformed rows are skipped, never fatal.

## Sheets features the app uses

| For | Sheets feature |
|---|---|
| Reading everything | `values.get` (whole tab) and `spreadsheets.get` with grid data for the first 100 rows: data validation, number formats, cell fills, conditional-format colors. |
| Saving | `values.batchUpdate` (only the cells that changed), `values.append`, `deleteDimension` for deleted rows. |
| The columns page | One `spreadsheets.batchUpdate`: `deleteDimension`, `moveDimension`, `insertDimension`/`appendDimension`, `updateCells` (headers), `setDataValidation`, `repeatCell` (date format), `addConditionalFormatRule`/`deleteConditionalFormatRule` (one `TEXT_EQ` rule per dropdown value), `updateDimensionProperties` (hide). |

## Editing by hand

Safe: sorting, filtering, inserting or deleting task rows, adding columns, editing titles/statuses/properties, changing dropdown lists.
Changes show up when the board refreshes. Editing `board`, `drawing` or `_board` JSON by hand works but is easy to get wrong; a malformed
cell is ignored (the note is re-placed automatically).
