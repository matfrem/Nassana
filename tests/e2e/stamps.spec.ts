import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, note, noteCenter, openBoard, startEditing } from './helpers'

const sheet = (stamps?: [string, string]) =>
  new FakeSheet({
    Tasks: stamps
      ? [['id', 'title', 'board', 'stamps'], ['a', 'Alpha', board(-300, -100), stamps[0]], ['b', 'Beta', board(0, -100), stamps[1]]]
      : [['id', 'title', 'board'], ['a', 'Alpha', board(-300, -100)], ['b', 'Beta', board(0, -100)]],
  })

const cell = (s: FakeSheet, id: string) => {
  const rows = s.rows('Tasks')
  const col = rows[0].indexOf('stamps')
  return col < 0 ? undefined : rows.find((r) => r[0] === id)?.[col]
}
const select = async (page: import('@playwright/test').Page, title: string) => {
  const c = await noteCenter(page, title)
  await page.mouse.click(c.x - 60, c.y - 60)
}

test('stamps are shown from the Sheet, stacked at the top right, with more than three in a second column on the left', async ({ page }) => {
  await openBoard(page, sheet(['fire,bomb', 'fire,bomb,star,bug,nope']))
  await expect(page.locator('.stamps')).toHaveCount(2)
  await expect(page.locator('.stamps').first().locator('.stamp')).toHaveText(['🔥', '💣'])
  const second = page.locator('.stamps').nth(1)
  await expect(second.locator('.stamp-col')).toHaveCount(2) // 4 known stamps: 3 + 1 ('nope' is ignored)
  const cols = await second.locator('.stamp-col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left))
  expect(cols[1]).toBeLessThan(cols[0]) // the next column is to the left
  const noteBox = (await note(page, 'Beta').boundingBox())!
  const first = (await page.locator('.stamps').nth(1).locator('.stamp').first().boundingBox())!
  expect(first.x + first.width).toBeGreaterThan(noteBox.x + noteBox.width) // sticks out of the note
  expect(first.y).toBeLessThan(noteBox.y + 20)
})

test('the Stamps button adds and removes stamps, saved in a stamps column that is created on demand', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await select(page, 'Alpha')
  await page.getByRole('button', { name: 'Stamps' }).click()
  await page.getByRole('button', { name: 'Stamp Fire' }).click()
  await page.getByRole('button', { name: 'Stamp Bomb' }).click() // the grid stays open
  await expect(page.locator('.stamps .stamp')).toHaveText(['🔥', '💣'])
  await expect.poll(() => cell(s, 'a')).toBe('fire,bomb')
  expect(s.rows('Tasks')[0]).toEqual(['id', 'title', 'board', 'stamps'])
  await page.getByRole('button', { name: 'Stamp Fire' }).click() // again: removes it
  await expect(page.locator('.stamps .stamp')).toHaveText(['💣'])
  await expect.poll(() => cell(s, 'a')).toBe('bomb')
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('stamps follow a duplicate, and apply to every note of a multi-selection', async ({ page }) => {
  const s = sheet(['fire', ''])
  await openBoard(page, s)
  await startEditing(page)
  await select(page, 'Alpha')
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.locator('.stamps')).toHaveCount(2)
  await expect.poll(() => s.rows('Tasks').filter((r) => r[3] === 'fire').length).toBe(2)

  await page.keyboard.press('Control+a')
  await page.getByRole('button', { name: 'Stamps' }).click()
  const star = page.getByRole('button', { name: 'Stamp Star' })
  await star.click()
  await expect(page.locator('.stamps .stamp', { hasText: '⭐' })).toHaveCount(3) // all three notes
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(450) // (two quick taps would be a double tap)
  await star.click() // everyone has it: removes it from all
  await expect(page.locator('.stamps .stamp', { hasText: '⭐' })).toHaveCount(0)
  await expect(page.locator('.stamps .stamp', { hasText: '🔥' })).toHaveCount(2)
})

test('stamps of a tucked sub-task are not drawn', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'parent', 'stamps'], ['a', 'Parent', board(-100, 0), '', ''], ['b', 'Child', board(200, 0), 'a', 'fire']],
  })
  await openBoard(page, s)
  await expect(page.locator('.stamps')).toHaveCount(0)
})

test('stamps are big, and "Show stamps" / "Show property chips" in the View menu hide them (remembered)', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'stamps', 'prio#'], ['a', 'Alpha', board(-100, -100), 'fire', 'High']],
  })
  await openBoard(page, s)
  const stamp = (await page.locator('.stamp').first().boundingBox())!
  expect(stamp.width).toBeGreaterThanOrEqual(55)
  await expect(page.locator('.chip')).toHaveCount(1)
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByLabel('Show stamps').uncheck()
  await page.getByLabel('Show property chips').uncheck()
  await expect(page.locator('.stamps')).toHaveCount(0)
  await expect(page.locator('.chip')).toHaveCount(0)
  await page.reload()
  await page.locator('.note').first().waitFor()
  await expect(page.locator('.stamps')).toHaveCount(0)
  await expect(page.locator('.chip')).toHaveCount(0)
})

test('a double tap on a stamp toggles it once and closes the menu', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await select(page, 'Alpha')
  await page.getByRole('button', { name: 'Stamps' }).click()
  await page.getByRole('button', { name: 'Stamp Fire' }).dblclick()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.stamps .stamp')).toHaveText(['🔥'])
  await expect.poll(() => cell(s, 'a')).toBe('fire')
  // and again on a stamp that is already there: it is removed, the menu closes
  await page.getByRole('button', { name: 'Stamps' }).click()
  await page.getByRole('button', { name: 'Stamp Fire' }).dblclick()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.stamps')).toHaveCount(0)
  await expect.poll(() => cell(s, 'a')).toBe('')
})
