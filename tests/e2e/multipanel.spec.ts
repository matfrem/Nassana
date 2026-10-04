import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, noteCenter, openBoard, startEditing } from './helpers'

const validation = (values: string[]) => ({ dataValidation: { condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) } } })

const sheet = () => {
  const s = new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'prio#', 'team', 'description', 'parent'],
      ['a', 'Alpha', board(-500, -100), 'High', 'x', 'first', ''],
      ['b', 'Beta', board(-250, -100), 'Low', 'x', 'second', 'p'],
      ['c', 'Gamma', board(0, -100), 'Low', 'y', 'third', ''],
      ['p', 'Parent', board(250, -100), '', '', '', ''],
    ],
    _board: [['id', 'type', 'data'], ['colicon:prio#', 'colicon', '🔥'], ['open:p', 'open', '1']],
  })
  s.grid = { sheets: [{ data: [{ rowData: [{ values: [{}, {}, {}, validation(['High', 'Medium', 'Low'])] }] }] }] }
  return s
}
const col = (s: FakeSheet, id: string, name: string) => {
  const rows = s.rows('Tasks')
  return rows.find((r) => r[0] === id)?.[rows[0].indexOf(name)]
}
const corner = async (page: import('@playwright/test').Page, title: string) => {
  const c = await noteCenter(page, title)
  return { x: c.x - 60, y: c.y - 60 }
}

test('the properties show the column emoji instead of a #, and each dropdown value in its color', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const a = await corner(page, 'Alpha')
  await page.mouse.click(a.x, a.y)
  await page.getByRole('button', { name: /Details/ }).click()
  const label = page.locator('.panel label', { has: page.locator('select') }).filter({ hasText: 'prio' }).first()
  await expect(label.locator('span')).toHaveText(/🔥 prio/i)
  await expect(page.locator('.panel')).not.toContainText('#')
  const color = await label.locator('select').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(color).toBe('rgb(255, 173, 173)') // High: the red tone, like its pill
})

test('the panel edits several notes: first note shown, ≠ where they differ, changes apply to all, no title', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const a = await corner(page, 'Alpha')
  const b = await corner(page, 'Beta')
  const c = await corner(page, 'Gamma')
  await page.mouse.click(a.x, a.y)
  await page.keyboard.down('Control')
  await page.mouse.click(b.x, b.y)
  await page.waitForTimeout(450)
  await page.mouse.click(c.x, c.y)
  await page.keyboard.up('Control')
  await expect(page.getByText('3 selected')).toBeVisible()
  await page.getByRole('button', { name: /Details/ }).click()
  const panel = page.getByRole('complementary', { name: 'Note details' })
  await expect(panel.getByRole('heading', { name: '3 notes' })).toBeVisible()
  await expect(panel.getByLabel('Title')).toHaveCount(0) // titles stay per note
  await expect(panel.getByLabel('Description')).toHaveValue('first') // the first selected note's value
  await expect(panel.locator('label', { hasText: 'Description' }).locator('i.differs')).toHaveCount(1)
  await expect(panel.locator('label', { hasText: 'prio' }).locator('i.differs')).toHaveCount(1)
  await expect(panel.locator('label', { hasText: 'team' }).locator('i.differs')).toHaveCount(1) // x, x, y

  await panel.locator('label', { hasText: 'prio' }).locator('select').selectOption('Medium')
  await expect.poll(() => ['a', 'b', 'c'].map((id) => col(s, id, 'prio#'))).toEqual(['Medium', 'Medium', 'Medium'])
  await expect(panel.locator('label', { hasText: 'prio' }).locator('i.differs')).toHaveCount(0) // same everywhere now

  await panel.getByLabel('Parent').selectOption({ label: 'Parent' }) // a common parent
  await expect.poll(() => ['a', 'b', 'c'].map((id) => col(s, id, 'parent'))).toEqual(['p', 'p', 'p'])
})

test('Unparent works on a multi-selection', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const b = await corner(page, 'Beta')
  const a = await corner(page, 'Alpha')
  await page.mouse.click(b.x, b.y)
  await page.keyboard.down('Control')
  await page.mouse.click(a.x, a.y)
  await page.keyboard.up('Control')
  await page.getByRole('button', { name: 'Unparent' }).click()
  await expect.poll(() => col(s, 'b', 'parent') ?? '').toBe('')
  await expect(page.getByRole('button', { name: 'Unparent' })).toHaveCount(0) // nobody left to unparent
})
