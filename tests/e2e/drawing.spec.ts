import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, center, drag, openBoard, startEditing, stroke } from './helpers'

const two = () =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board'],
      ['a', 'Alpha', board(-300, -90)],
      ['b', 'Beta', board(100, -90)],
    ],
  })

async function pickPen(page: import('@playwright/test').Page) {
  await startEditing(page)
  await page.getByRole('button', { name: 'Draw' }).click()
}

test('a stroke that starts on a note belongs to it; erase and undo work', async ({ page }) => {
  const sheet = two()
  await openBoard(page, sheet)
  await pickPen(page)

  const box = (await page.locator('.note').first().boundingBox())!
  await stroke(page, [[box.x + 30, box.y + 120], [box.x + 90, box.y + 140], [box.x + 160, box.y + 150]])
  // the `drawing` column is created and holds the stroke in note coordinates
  await expect.poll(() => sheet.rows('Tasks')[0]).toEqual(['id', 'title', 'board', 'drawing'])
  const cell = () => JSON.parse(String(sheet.cell('Tasks', 'D2') || '[]'))
  await expect.poll(() => cell()).toHaveLength(1)
  expect(cell()[0].p[0]).toBeGreaterThan(20) // first point near x = 30, relative to the note
  expect(cell()[0].p[0]).toBeLessThan(40)
  await expect(page.locator('.note-ink path:not(.stroke-halo)')).toHaveCount(1)
  await expect(page.locator('.ink path')).toHaveCount(0) // nothing on the board layer

  // the eraser removes it, and the cell is emptied
  await page.getByRole('button', { name: 'Eraser' }).click()
  await drag(page, { x: box.x + 40, y: box.y + 124 }, { x: box.x + 70, y: box.y + 134 })
  await expect.poll(() => sheet.cell('Tasks', 'D2')).toBe('')

  // draw again on the second note, then undo
  await page.getByRole('button', { name: 'Pen' }).click()
  const box2 = (await page.locator('.note').nth(1).boundingBox())!
  await stroke(page, [[box2.x + 30, box2.y + 60], [box2.x + 100, box2.y + 100]])
  await expect.poll(() => String(sheet.cell('Tasks', 'D3')).length).toBeGreaterThan(10)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => sheet.cell('Tasks', 'D3')).toBe('')
})

test('a stroke on empty space is a board stroke: the _board tab is created on the first one', async ({ page }) => {
  const sheet = two()
  await openBoard(page, sheet)
  await pickPen(page)
  await page.getByRole('button', { name: 'Ink #3B82F6' }).click()
  await page.getByRole('button', { name: 'Thick' }).click()
  await stroke(page, [[120, 600], [260, 640], [400, 600]])

  await expect.poll(() => sheet.rows('_board')[0]).toEqual(['id', 'type', 'data'])
  await expect.poll(() => sheet.board('stroke')).toHaveLength(1)
  const s = JSON.parse(sheet.board('stroke')[0])
  expect(s.c).toBe('#3B82F6')
  expect(s.w).toBeGreaterThan(5) // thick
  expect(s.p.length).toBeGreaterThanOrEqual(4)
  await expect(page.locator('.ink path:not(.stroke-halo)')).toHaveCount(1)

  // survives a reload (it is read back from the Sheet)
  await page.reload()
  await expect(page.locator('.ink path')).toHaveCount(1)

  // undo deletes its row
  await pickPen(page)
  await stroke(page, [[120, 700], [300, 720]])
  await expect.poll(() => sheet.board('stroke')).toHaveLength(2)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => sheet.board('stroke')).toHaveLength(1)
})

test('the move tool drags a stroke; a note stroke always keeps a part inside its note', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'drawing'],
      ['a', 'Note', board(-90, -90), '[{"c":"#E5484D","w":3,"p":[30,100,100,0]}]'],
    ],
    _board: [['id', 'type', 'data'], ['s1', 'stroke', '{"c":"#3B82F6","w":4,"p":[-300,60,200,0]}']],
  })
  await openBoard(page, sheet)
  await pickPen(page)
  await page.getByRole('button', { name: 'Move' }).click()

  // the board stroke: pick it and drag it
  const before = JSON.parse(sheet.board('stroke')[0]).p
  const mid = await center(page, '.ink path:not(.stroke-halo)')
  await drag(page, mid, { x: mid.x + 60, y: mid.y + 40 })
  await expect.poll(() => JSON.parse(sheet.board('stroke')[0]).p[0]).toBeGreaterThan(before[0] + 40)
  await expect(page.locator('.ink .stroke-halo')).toHaveCount(1) // it shows as selected

  // the note stroke, dragged far to the right: it stops with 12 px still inside the 180 px note
  const noteStroke = await center(page, '.note-ink path:not(.stroke-halo)')
  await drag(page, noteStroke, { x: noteStroke.x + 600, y: noteStroke.y })
  await expect.poll(() => JSON.parse(String(sheet.cell('Tasks', 'D2')))[0].p[0]).toBeCloseTo(168, 0)

  // tapping empty space drops the selection; selecting the board stroke again allows deleting it
  await page.mouse.click(900, 760)
  await expect(page.locator('.stroke-halo')).toHaveCount(0)
  const start = (await page.locator('.ink path:not(.stroke-halo)').first().boundingBox())!
  await page.mouse.click(start.x + 12, start.y + start.height / 2)
  await page.getByRole('button', { name: 'Delete stroke' }).click()
  await expect.poll(() => sheet.board('stroke')).toHaveLength(0)
})
