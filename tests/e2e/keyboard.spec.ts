import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, center, drag, note, noteCenter, openBoard, startEditing, zoneRow } from './helpers'

const sheet = () =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'status'],
      ['a', 'Alpha', board(-200, -100), ''],
      ['b', 'Beta', board(200, -100), ''],
    ],
    _board: [['id', 'type', 'data'], ['s1', 'stroke', '{"c":"#3B82F6","w":4,"p":[-300,200,200,260]}']],
  })

const xOf = (s: FakeSheet, id: string) => JSON.parse(String(s.rows('Tasks').find((r) => r[0] === id)![2])).x as number

test('arrow keys move the selected note by one grid step; Delete asks, then deletes; Ctrl+C / Ctrl+V pastes a copy', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const c = await noteCenter(page, 'Alpha')
  await page.mouse.click(c.x - 40, c.y - 40)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => xOf(s, 'a')).toBe(-120)

  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.note')).toHaveCount(3)
  await expect.poll(() => s.rows('Tasks').length).toBe(4)
  await page.keyboard.press('Control+v') // pastes again
  await expect(page.locator('.note')).toHaveCount(4)

  let asked = ''
  page.once('dialog', (d) => {
    asked = d.message()
    void d.accept()
  })
  await page.keyboard.press('Delete') // the pasted copy is selected
  await expect(page.locator('.note')).toHaveCount(3)
  expect(asked).toContain('Delete')
})

test('typing in a field never triggers the shortcuts', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const c = await noteCenter(page, 'Alpha')
  await page.mouse.click(c.x - 40, c.y - 40)
  await page.getByRole('button', { name: /Details/ }).click()
  await page.getByLabel('Description').fill('hello')
  await page.getByLabel('Description').press('Backspace')
  await page.getByLabel('Description').press('ArrowLeft')
  await expect(page.locator('.note')).toHaveCount(2)
  expect(xOf(s, 'a')).toBe(-200)
})

test('a right click selects the note and opens its details', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  await note(page, 'Beta').click({ button: 'right' })
  await expect(page.getByRole('complementary', { name: 'Note details' })).toBeVisible()
  await expect(note(page, 'Beta')).toHaveClass(/selected/)
})

test('with the Move tool: arrows nudge the picked stroke, Delete removes it, Undo brings back, undoes moves too', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await page.getByRole('button', { name: /Draw/ }).click()
  await page.getByRole('button', { name: 'Move' }).click()
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled() // nothing to undo yet
  const mid = await center(page, '.ink path:not(.stroke-halo)')
  await page.mouse.click(mid.x, mid.y)
  const y0 = JSON.parse(s.board('stroke')[0]).p[1]
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => JSON.parse(s.board('stroke')[0]).p[1]).toBe(y0 + 80)
  await expect(undo).toBeEnabled()
  await undo.click() // one step back
  await expect.poll(() => JSON.parse(s.board('stroke')[0]).p[1]).toBe(y0 + 40)
  await undo.click()
  await expect.poll(() => JSON.parse(s.board('stroke')[0]).p[1]).toBe(y0)

  const again = await center(page, '.ink path:not(.stroke-halo)')
  await page.mouse.click(again.x, again.y)
  await page.keyboard.press('Delete')
  await expect.poll(() => s.board('stroke')).toHaveLength(0)
  await undo.click() // the deleted stroke comes back
  await expect.poll(() => s.board('stroke')).toHaveLength(1)
  await expect(undo).toBeDisabled()
})

test('with notes colored by a column, the manual color buttons are disabled', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'status'], ['a', 'Alpha', board(0, 0), 'X']],
  })
  await openBoard(page, s)
  await startEditing(page)
  await page.getByRole('button', { name: 'Filter options' }).click()
  await page.getByRole('button', { name: /^Status/ }).click()
  const c = await noteCenter(page, 'Alpha')
  await page.mouse.click(c.x - 40, c.y - 40)
  await expect(page.getByRole('button', { name: 'More colors' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /^Color #/ }).first()).toBeDisabled()
})

test('links in a description become "Open Link N" buttons in the details', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'description'], ['a', 'Alpha', board(0, 0), 'See https://example.com/a, and (https://example.org/b?x=1). Not http://'], ['b', 'Beta', board(300, 0), 'no link']],
  })
  await openBoard(page, s)
  await note(page, 'Alpha').click({ button: 'right' })
  const links = page.locator('.open-link')
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveText(/Open Link 1/)
  await expect(links.nth(0)).toHaveAttribute('href', 'https://example.com/a')
  await expect(links.nth(1)).toHaveAttribute('href', 'https://example.org/b?x=1')
  await expect(links.nth(1)).toHaveAttribute('target', '_blank')
  await note(page, 'Beta').click({ button: 'right' })
  await expect(page.locator('.open-link')).toHaveCount(0)
})

test('an open details panel follows the selection: tap another note or zone and it shows that one', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'status'], ['a', 'Alpha', board(-300, -100), ''], ['b', 'Beta', board(0, -100), ''], ['c', 'Gamma', board(300, -100), '']],
    _board: [['id', 'type', 'data'], zoneRow('z1', 'Box', -300, 150, 400, 250)],
  })
  await openBoard(page, s)
  await startEditing(page)
  await note(page, 'Alpha').click({ button: 'right' })
  const panel = page.getByRole('complementary', { name: 'Note details' })
  await expect(panel.getByLabel('Title')).toHaveValue('Alpha')
  const b = await noteCenter(page, 'Beta')
  await page.mouse.click(b.x - 60, b.y - 60)
  await expect(panel.getByLabel('Title')).toHaveValue('Beta') // same panel, new note
  const header = (await page.locator('.zone-header').first().boundingBox())!
  await page.mouse.click(header.x + 30, header.y + 10)
  await expect(page.getByRole('complementary', { name: 'Zone details' })).toBeVisible()
  await expect(panel).toHaveCount(0)
  const b2 = await noteCenter(page, 'Beta')
  await page.mouse.click(b2.x - 60, b2.y - 60)
  await expect(page.getByRole('complementary', { name: 'Note details' }).getByLabel('Title')).toHaveValue('Beta')
})
