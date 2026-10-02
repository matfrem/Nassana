import type { Task } from './types'

const COLORS = ['#FFE066', '#FFADAD', '#9BF6FF', '#CAFFBF', '#FFC6FF', '#FDFFB6']

const TITLES = [
  'Prepare the meeting',
  'Review the contract',
  'Call the client',
  'Homepage mockup',
  'Update the docs',
  'Fix bug #42',
  'Plan the sprint',
  'Order equipment',
  'Code review',
  'Send the invoice',
  'Design workshop',
  'Tech watch',
]

/** Placeholder data until Google Sheets is wired in. */
export function demoTasks(): Task[] {
  return TITLES.map((title, i) => ({
    id: `demo-${i}`,
    title,
    board: {
      x: (i % 4) * 220 - 330,
      y: Math.floor(i / 4) * 220 - 220,
      color: COLORS[i % COLORS.length],
    },
  }))
}
