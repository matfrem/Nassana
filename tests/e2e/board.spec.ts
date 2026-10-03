import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, doubleTap, drag, note, noteCenter, openBoard, startEditing } from './helpers'

const today = () => Math.floor(Date.now() / 86_400_000) + 25_569 // today as a Sheets serial number

/** Three notes with a dropdown, a date, a number, a checkbox, a dropdown fed from a list and a link. */
function richSheet() {
  const s = new FakeSheet({
    Tasks: [
      ['id', 'title', 'description', 'board', 'prio#', 'dueDate#', 'points#', 'done#', 'team', 'url#'],
      ['1', 'Ship it', 'Release the thing to everyone', board(-300, -100), 'High', today() - 3, 5, true, 'Alpha', 'https://www.example.com/x'],
      ['2', 'Write docs', '', board(-80, -100), 'Low', today() + 1, 2, false, 'Beta', ''],
      ['3', 'Plain note', '', board(140, -100), '', '', '', '', '', ''],
    ],
  })
  const validation = (type: string, values: string[] = []) => ({ dataValidation: { condition: { type, values: values.map((v) => ({ userEnteredValue: v })) } } })
  s.grid = {
    sheets: [
      {
        data: [
          {
            rowData: [
              {
                values: [
                  {}, {}, {}, {},
                  validation('ONE_OF_LIST', ['High', 'Medium', 'Low']), // prio#
                  { userEnteredFormat: { numberFormat: { type: 'DATE' } } }, // dueDate#
                  {},
                  validation('BOOLEAN'), // done#
                  validation('ONE_OF_RANGE', ["='Lists'!A1:A3"]), // team
                ],
              },
            ],
          },
        ],
      },
    ],
  }
  s.lists.Lists = [['Alpha'], ['Beta'], ['Gamma']]
  return s
}

test('shows pills with their tones, and the description when zoomed in', async ({ page }) => {
  await openBoard(page, richSheet())
  const ship = note(page, 'Ship it').locator('.chip')
  await expect(ship.nth(0)).toHaveText('High')
  await expect(ship.nth(0)).toHaveClass(/tone-red/) // a priority
  await expect(ship.nth(1)).toHaveClass(/tone-red/) // a date three days ago
  await expect(ship.nth(2)).toHaveText('#5')
  await expect(ship.nth(3)).toHaveClass(/tone-green/) // a ticked checkbox
  await expect(ship.nth(4)).toHaveText(/example\.com/)
  await expect(note(page, 'Write docs').locator('.chip').nth(1)).toHaveClass(/tone-orange/) // due tomorrow
  await expect(note(page, 'Plain note').locator('.chip')).toHaveCount(0)
  await expect(note(page, 'Ship it').locator('.note-desc')).toHaveText('Release the thing to everyone')
})

test.describe('details panel', () => {
  test.use({ locale: 'fr-FR' }) // dates are typed day first

  test('opens on tap when read-only, and edits every kind of field in Edit mode', async ({ page }) => {
    const sheet = richSheet()
    await openBoard(page, sheet)
    const panel = page.getByRole('complementary', { name: 'Note details' })

    await note(page, 'Ship it').click({ position: { x: 20, y: 20 } })
    await expect(panel.getByRole('heading', { name: 'Ship it' })).toBeVisible() // read-only: a heading, no inputs
    await expect(panel.locator('input')).toHaveCount(0)
    await panel.getByRole('button', { name: 'Close details' }).click()

    await startEditing(page)
    await doubleTap(page, await noteCenter(page, 'Write docs'))
    const field = (name: string) => panel.locator(`label:has(span:text-is("${name}"))`)

    // dropdown values come from the Sheet's validation, or from another range
    await expect(field('prio').locator('option')).toHaveText(['', 'High', 'Medium', 'Low'])
    await expect(field('team').locator('option')).toHaveText(['', 'Alpha', 'Beta', 'Gamma'])

    await field('prio').locator('select').selectOption('Medium')
    await field('dueDate').locator('input[type=text]').fill('15012030') // digits only, as on a phone keypad
    await field('dueDate').locator('input[type=text]').press('Enter')
    await field('done').locator('input').check()
    await field('points').locator('input').fill('8')
    await panel.locator('textarea').fill('Docs for v2')

    const serial = Math.floor(Date.UTC(2030, 0, 15) / 86_400_000) + 25_569
    await expect.poll(() => sheet.cell('Tasks', 'C3')).toBe('Docs for v2')
    await expect.poll(() => sheet.cell('Tasks', 'E3')).toBe('Medium')
    await expect.poll(() => sheet.cell('Tasks', 'F3')).toBe(serial) // a date column gets a real date
    await expect.poll(() => sheet.cell('Tasks', 'G3')).toBe(8) // a number, not text
    await expect.poll(() => sheet.cell('Tasks', 'H3')).toBe(true) // a boolean
  })

  test('refuses an impossible date and offers shortcuts', async ({ page }) => {
    const sheet = richSheet()
    await openBoard(page, sheet)
    await startEditing(page)
    await doubleTap(page, await noteCenter(page, 'Write docs'))
    const panel = page.getByRole('complementary', { name: 'Note details' })
    const date = panel.locator('label:has(span:text-is("dueDate")) input[type=text]')
    await date.fill('31/02/2030')
    await date.press('Enter')
    await expect(date).toHaveAttribute('aria-invalid', 'true')
    await panel.getByRole('button', { name: 'Clear' }).click()
    await expect.poll(() => sheet.cell('Tasks', 'F3')).toBe('')
    await panel.getByRole('button', { name: 'Tomorrow' }).click()
    await expect.poll(() => sheet.cell('Tasks', 'F3')).toBe(today() + 1)
  })
})

test('saves a moved note by its row id, even when rows are out of order', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['extra', 'title', 'id', 'board'],
      ['x', 'Second', '2', board(300, 0)],
      ['y', 'First', '1', board(0, 0)],
    ],
  })
  await openBoard(page, sheet)
  await startEditing(page)
  const c = await noteCenter(page, 'First')
  await drag(page, c, { x: c.x, y: c.y + 90 })
  await expect.poll(() => JSON.parse(String(sheet.cell('Tasks', 'D3'))).y).toBeGreaterThan(80)
  expect(JSON.parse(String(sheet.cell('Tasks', 'D3'))).x).toBeCloseTo(0, -1)
  expect(sheet.cell('Tasks', 'D2')).toBe(board(300, 0)) // the other note's cell was not touched
  await expect(page.locator('.badge')).toHaveText('Saved ✓')
})

test('adds, recolors, renames, duplicates and deletes a note', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'board'],
      ['b', 'Beta', board(0, 0)],
      ['a', 'Alpha', board(220, 0)],
      ['c', 'Gamma', board(440, 0)],
    ],
  })
  page.on('dialog', (d) => d.accept())
  await openBoard(page, sheet)
  await startEditing(page)

  // add: the title opens for typing
  await page.getByRole('button', { name: 'Add note' }).click()
  await page.keyboard.type('Buy milk')
  await page.keyboard.press('Enter')
  await expect.poll(() => sheet.rows('Tasks').at(-1)?.[1]).toBe('Buy milk')
  expect(String(sheet.rows('Tasks').at(-1)?.[0])).toMatch(/^[0-9a-f]{8}$/)

  // recolor (Alpha is row 3)
  await note(page, 'Alpha').click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: 'Color #FFADAD' }).click()
  await expect.poll(() => JSON.parse(String(sheet.cell('Tasks', 'C3'))).color).toBe('#FFADAD')

  // rename through the details panel
  await page.getByRole('button', { name: '☰ Details' }).click()
  await page.getByLabel('Title').fill('Alpha v2')
  await expect.poll(() => sheet.cell('Tasks', 'B3')).toBe('Alpha v2')
  await page.getByRole('button', { name: 'Close details' }).click()

  // duplicate
  await note(page, 'Alpha v2').click({ position: { x: 20, y: 20 } })
  const rows = sheet.rows('Tasks').length
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect.poll(() => sheet.rows('Tasks').length).toBe(rows + 1)
  expect(sheet.rows('Tasks').at(-1)?.[1]).toBe('Alpha v2')
  expect(JSON.parse(String(sheet.rows('Tasks').at(-1)?.[2])).color).toBe('#FFADAD')

  // delete Beta: its row goes
  await note(page, 'Beta').click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: '🗑 Delete' }).click()
  await expect.poll(() => sheet.rows('Tasks').some((r) => r[0] === 'b')).toBe(false)
})

test('offers to create the header row of an empty Tasks tab', async ({ page }) => {
  const sheet = new FakeSheet({ Tasks: [] })
  await openBoard(page, sheet, { waitForNote: false })
  await expect(page.getByText('It needs a header row')).toBeVisible()
  await page.getByRole('button', { name: 'Add header row now' }).click()
  await expect.poll(() => sheet.rows('Tasks')[0]).toEqual(['id', 'title', 'board'])
  await expect(page.getByText('No tasks yet')).toBeVisible()
})

test('gives ids to rows that have none, on request', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['', 'id', 'title', 'board'],
      ['', 't1', 'Has an id', board(0, 0)],
      ['', '', 'No id one', ''],
      ['', '', 'No id two', ''],
    ],
  })
  page.on('dialog', (d) => d.accept())
  await openBoard(page, sheet)
  await expect(page.locator('.warnings')).toContainText('2 row(s) skipped')
  await page.getByRole('button', { name: 'Give them an id' }).click()
  await expect.poll(() => [sheet.cell('Tasks', 'B3'), sheet.cell('Tasks', 'B4')].every((v) => /^[0-9a-f]{8}$/.test(String(v)))).toBe(true)
  await expect(page.locator('.note')).toHaveCount(3)
})
