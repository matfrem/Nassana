export const NOTE_SIZE = 180
/** Spacing between notes when auto-placing tasks that have no position yet. */
export const NOTE_STEP = 220

export const NOTE_COLORS = ['#FFE066', '#FFADAD', '#9BF6FF', '#CAFFBF', '#FFC6FF', '#FDFFB6']

export const INK_COLORS = ['#E5484D', '#3B82F6', '#30A46C', '#F5C518', '#111111', '#FFFFFF']
/** Pen widths in screen pixels. */
export const PEN_WIDTHS = { thin: 3, thick: 8 } as const

export const ZONE_COLORS = ['#94A3B8', '#60A5FA', '#34D399', '#FBBF24', '#F87171', '#C084FC']
/** Height of a zone's title strip (the part you grab to move it), in world units. */
export const ZONE_HEADER = 48
export const ZONE_MIN_SIZE = 140
/** Spacing of the background dots, in world units: dragged notes snap their top-left corner onto them. */
export const GRID = 40
export const ZONE_TITLE_SIZE = 26
export const ZONE_TITLE_SIZES = { min: 14, max: 80 } as const
/** Side of the (mostly empty) SVG layers for strokes and links, centred on the origin: big enough to never clip the drawing. */
export const SPAN = 60_000
