import { expect, test, type Page } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, drag, note, openBoard, startEditing, zoneRow } from './helpers'

const viewMenu = (page: Page) => page.getByRole('button', { name: 'View options' }).click()
const menuItem = (page: Page, name: string | RegExp) => page.locator('.menu button', { hasText: name })
async function colorBy(page: Page, name: string | RegExp) {
  await viewMenu(page)
  await menuItem(page, name).click()
}
const visibleTitles = (page: Page) => page.locator('.note:not(.ghost) .note-title').allTextContents().then((t) => t.sort())
const legend = (page: Page) => page.locator('.viewbar .legend-item button')
const bg = (page: Page, title: string) => note(page, title).evaluate((e) => (e as HTMLElement).style.background)

const fill = (red: number, green = 0, blue = 0) => ({ effectiveFormat: { backgroundColor: { red, green, blue } } })
const cell = (value: string, f: object = {}) => ({ effectiveValue: { stringValue: value }, ...f })
const gridRow = (...cells: object[]) => ({ values: cells })

test('colors by the Sheet\'s own colors, ignores row fills shared by several values, and keeps text readable', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'project#', 'Priority', 'board'],
      ['1', 'One', 'BSN', 'A', board(-420, -90)],
      ['2', 'Two', 'TZ', 'B', board(-210, -90)],
      ['3', 'Three', 'DARK', 'C', board(0, -90)],
      ['4', 'Four', 'NOFILL', 'Z', board(210, -90)],
    ],
  })
  const peach = fill(0.99, 0.9, 0.8) // a ROW fill: the same behind A, B and C
  sheet.grid = {
    sheets: [
      {
        data: [
          {
            rowData: [
              gridRow({}, {}, cell('BSN', fill(0.72, 0.88, 0.8)), cell('A', peach)),
              gridRow({}, {}, cell('TZ', fill(0.98, 0.74)), cell('B', peach)), // blue omitted, as the API does for 0
              gridRow({}, {}, cell('DARK', fill(0.1, 0.3, 0.15)), cell('C', peach)),
              gridRow({}, {}, cell('NOFILL'), cell('Z', fill(0.7, 0.9, 0.7))),
            ],
          },
        ],
      },
    ],
  }
  await openBoard(page, sheet)

  await colorBy(page, /^project/)
  expect(await bg(page, 'One')).toBe('rgb(184, 224, 204)')
  expect(await bg(page, 'Two')).toBe('rgb(250, 189, 0)')
  expect(await bg(page, 'Three')).toBe('rgb(26, 77, 38)')
  expect(await note(page, 'Three').evaluate((e) => (e as HTMLElement).style.color)).toBe('rgb(245, 245, 245)') // dark fill: light text
  expect(await note(page, 'One').evaluate((e) => (e as HTMLElement).style.color)).toBe('rgb(31, 35, 40)')
  expect(['rgb(184, 224, 204)', 'rgb(250, 189, 0)', 'rgb(26, 77, 38)']).not.toContain(await bg(page, 'Four')) // no fill: palette

  await colorBy(page, /^Priority/)
  const peachRgb = 'rgb(252, 229, 204)'
  for (const t of ['One', 'Two', 'Three']) expect(await bg(page, t)).not.toBe(peachRgb) // the shared row fill is not "the color of A/B/C"
  expect(await bg(page, 'Four')).toBe('rgb(179, 230, 179)') // a color that belongs to one value only is kept
})

test('colors by status with the zone colors; in Edit mode the legend dots pick colors that are shared', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'status', 'board'],
      ['1', 'One', 'En Cours', board(-420, -90)],
      ['2', 'Two', 'To Review', board(-210, -90)],
      ['3', 'Three', 'Backlog', board(0, -90)], // no zone of that name
    ],
    _board: [['id', 'type', 'data'], [...zoneRow('z1', 'En Cours', -600, 300)].map((v, i) => (i === 2 ? String(v).replace('#60A5FA', '#60a5fa') : v)), [...zoneRow('z2', 'To Review', -200, 300, 300, 300, { color: '#C084FC' })]],
  })
  await openBoard(page, sheet)
  await colorBy(page, /^Status/)
  expect(await bg(page, 'One')).toBe('rgb(96, 165, 250)') // the zone's blue
  expect(await bg(page, 'Two')).toBe('rgb(192, 132, 252)') // the zone's purple

  await startEditing(page)
  await page.getByLabel('Color of Backlog').fill('#ff8800')
  await expect.poll(() => sheet.board('color').map((d) => JSON.parse(d))).toEqual([{ key: 'status', value: 'backlog', color: '#ff8800' }])
  expect(await bg(page, 'Three')).toBe('rgb(255, 136, 0)')
})

test('tapping a legend item hides/shows its value; hidden values add up, survive a change of column and a reload', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'status', 'Priority', 'board'],
      ['1', 'Alpha', 'To Do', 'A', board(-600, -100)],
      ['2', 'Beta', 'Done', 'B', board(-400, -100)],
      ['3', 'Gamma', 'Done', 'Z', board(-200, -100)],
      ['4', 'Delta', 'En Cours', 'A', board(0, -100)],
      ['5', 'Epsilon', 'To Do', 'Z', board(200, -100)],
      ['6', 'Loose', '', 'B', board(400, -100)],
    ],
  })
  await openBoard(page, sheet)
  await colorBy(page, /^Status/)
  const toggle = (name: string) => page.locator('.viewbar .legend-item button', { hasText: name }).first().click()

  await toggle('Done')
  expect(await visibleTitles(page)).toEqual(['Alpha', 'Delta', 'Epsilon', 'Loose'])
  await toggle('To Do')
  expect(await visibleTitles(page)).toEqual(['Delta', 'Loose'])
  await expect(page.locator('.note.ghost')).toHaveCount(4) // the hidden ones stay as grey shapes: their spot is not free
  await toggle('Done') // shown again; To Do stays hidden
  expect(await visibleTitles(page)).toEqual(['Beta', 'Delta', 'Gamma', 'Loose'])

  // the menu says how many values of a column are visible
  await viewMenu(page)
  await expect(menuItem(page, /^Status/)).toHaveText('Status (2/3)')
  await expect(menuItem(page, /^Priority/)).toHaveText('Priority')
  await menuItem(page, /^Priority/).click()

  // another column's legend; the status filter is still there, as ONE pill for the column
  await expect(page.locator('.viewbar .filter')).toHaveText(['Status: 1 hidden ✕'])
  await toggle('Z')
  expect(await visibleTitles(page)).toEqual(['Beta', 'Delta', 'Loose'])

  await page.reload() // kept in this browser
  await page.locator('.note').first().waitFor()
  expect(await visibleTitles(page)).toEqual(['Beta', 'Delta', 'Loose'])
  await expect(page.locator('.viewbar .filter')).toHaveText(['Status: 1 hidden ✕', 'Show all'])

  await page.getByRole('button', { name: 'Show all' }).click()
  expect(await visibleTitles(page)).toHaveLength(6)
})

test('tapping a pill on a note shows only that value, and the choice is remembered', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'team#', 'board'],
      ['1', 'Alpha', 'LD', board(0, -90)],
      ['2', 'Beta', 'LA', board(220, -90)],
    ],
  })
  await openBoard(page, sheet)
  await note(page, 'Alpha').locator('.chip').click()
  await expect(note(page, 'Beta')).toHaveClass(/dim/)
  await expect(note(page, 'Alpha')).not.toHaveClass(/dim/)
  await expect(page.locator('.viewbar .filter')).toHaveText('Only team: LD ✕')
  await page.reload()
  await expect(note(page, 'Beta')).toHaveClass(/dim/)
  await page.locator('.viewbar .filter').click()
  await expect(note(page, 'Beta')).not.toHaveClass(/dim/)
})

test('remembers where this browser was looking', async ({ page }) => {
  const sheet = new FakeSheet({ Tasks: [['id', 'title', 'board'], ['1', 'Alpha', board(0, 0)], ['2', 'Beta', board(300, 0)]] })
  await openBoard(page, sheet)
  const transform = () => page.locator('.world').evaluate((e) => (e as HTMLElement).style.transform)
  await drag(page, { x: 800, y: 600 }, { x: 700, y: 520 })
  await page.waitForTimeout(700) // the camera is saved shortly after it stops moving
  const moved = await transform()
  await page.reload()
  await page.locator('.note').first().waitFor()
  expect(await transform()).toBe(moved)

  // "Fit to content" brings everything back
  await viewMenu(page)
  await page.getByRole('button', { name: '⤢ Fit to content' }).click()
  expect(await transform()).not.toBe(moved)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 400, height: 800 } })

  test('the legend uses the whole width, and many hidden values take one pill', async ({ page }) => {
    const poles = ['Tech', 'DC / PROD', 'LD / LA', 'Anim', 'Tech Art', 'LD', '3D', 'LA', 'GD', 'SFX']
    const rows: (string | number)[][] = [['id', 'title', 'pole#', 'board']]
    poles.forEach((p, i) => rows.push([String(i), `Task ${i}`, p, board(i * 200, 0)]))
    await openBoard(page, new FakeSheet({ Tasks: rows }))
    await colorBy(page, /^pole/)
    for (const p of poles.slice(0, 8)) await page.locator('.viewbar .legend-item button', { hasText: new RegExp(`^${p.replace('/', '\\/')}$`) }).click()
    const bar = (await page.locator('.viewbar').boundingBox())!
    expect(bar.width).toBeGreaterThan(330) // it used to wrap at half the screen
    await expect(page.locator('.viewbar .legend-item')).toHaveCount(10)
    await viewMenu(page)
    await expect(menuItem(page, /^pole/)).toHaveText('pole (2/10)')
  })
})
