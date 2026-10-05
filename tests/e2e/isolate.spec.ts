import { expect, test, type Page } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, note, noteCenter, openBoard, startEditing, zoneRow } from './helpers'

const sheet = () =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'status', 'qui', 'parent'],
      ['a', 'Alpha', board(-500, -200), '', 'Mathieu', ''],
      ['b', 'Beta', board(-250, -200), '', 'Paul', 'a'],
      ['c', 'Gamma', board(0, -200), '', 'Mathieu', 'b'],
      ['d', 'Delta', board(250, -200), 'Closed', 'Mathieu', ''],
      ['e', 'Epsilon', board(-500, 100), '', 'Paul', ''],
      ['f', 'Zeta', board(-250, 100), '', 'Paul', ''],
    ],
    _board: [['id', 'type', 'data'], ['open:a', 'open', '1'], ['open:b', 'open', '1']],
  })

const titles = (page: Page) => page.locator('.note .note-title').allTextContents().then((t) => t.sort())
const viewMenu = async (page: Page) => page.getByRole('button', { name: 'View options' }).click()
const corner = async (page: Page, title: string) => {
  const c = await noteCenter(page, title)
  return { x: c.x - 60, y: c.y - 60 }
}

test('closed tasks are hidden unless "Show closed tasks" is on (remembered); their sub-tasks stay', async ({ page }) => {
  const s = sheet()
  s.tabs.Tasks.push(['g', 'Child of closed', board(250, 100), '', '', 'd'])
  s.tabs._board.push(['open:d', 'open', '1'])
  await openBoard(page, s)
  expect(await titles(page)).not.toContain('Delta')
  expect(await titles(page)).toContain('Child of closed') // only the closed task itself is hidden
  await viewMenu(page)
  await page.getByLabel('Show closed tasks').check()
  expect(await titles(page)).toContain('Delta')
  await page.reload()
  await page.locator('.note').first().waitFor()
  expect(await titles(page)).toContain('Delta') // remembered
})

test('the badge of a stack reads closed/total, and turns green when everything is closed', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'status', 'parent'],
      ['p', 'Parent', board(-300, 0), '', ''],
      ['x', 'X', board(0, 0), 'Closed', 'p'],
      ['y', 'Y', board(250, 0), 'closed', 'p'],
      ['z', 'Z', board(0, 250), '', 'p'],
      ['q', 'Quiet', board(-300, 300), '', ''],
      ['q1', 'Q1', board(0, 500), '', 'q'],
      ['r', 'Done', board(-300, 600), '', ''],
      ['r1', 'R1', board(250, 600), 'Closed', 'r'],
    ],
  })
  await openBoard(page, s)
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▤ 2/3')
  await expect(note(page, 'Quiet').locator('.stack-badge')).toHaveText('▤ 1') // none closed: just the number
  await expect(note(page, 'Done').locator('.stack-badge')).toHaveText('▤ 1/1')
  await expect(note(page, 'Done').locator('.stack-badge')).toHaveClass(/done/)
  await expect(note(page, 'Parent').locator('.stack-badge')).not.toHaveClass(/done/)
})

test('a closed task is not counted by its zone while hidden', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [['id', 'title', 'board', 'status'], ['a', 'Open', board(-640, 0), 'Todo'], ['b', 'Shut', board(-640, 200), 'Closed']],
    _board: [['id', 'type', 'data'], zoneRow('z1', 'Todo', -700, -100, 440, 640)],
  })
  await openBoard(page, s)
  await expect(page.locator('.zone-count')).toHaveText('1')
  await viewMenu(page)
  await page.getByLabel('Show closed tasks').check()
  await expect(page.locator('.zone-count')).toHaveText('2')
})

test('Isolate selected tasks keeps them and their sub-tasks; new notes join; Cancel brings everything back', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const e = await corner(page, 'Epsilon')
  const a = await corner(page, 'Alpha')
  await page.mouse.click(e.x, e.y)
  await page.keyboard.down('Control')
  await page.mouse.click(a.x, a.y)
  await page.keyboard.up('Control')
  await viewMenu(page)
  await page.getByRole('button', { name: /Isolate selected tasks/ }).click()
  expect(await titles(page)).toEqual(['Alpha', 'Beta', 'Epsilon', 'Gamma']) // Alpha's sub-tasks at every level, not Zeta, not closed Delta
  await expect(page.locator('.isolate-bar')).toContainText('Isolated: 2 tasks')

  await page.getByRole('button', { name: 'Add note' }).click()
  await page.keyboard.press('Enter')
  expect((await titles(page)).length).toBe(5) // the new note did not vanish

  await page.getByRole('button', { name: 'Cancel isolate mode' }).click()
  expect(await titles(page)).toEqual(['Alpha', 'Beta', 'Epsilon', 'Gamma', 'New note', 'Zeta'].sort())
  await expect(page.locator('.isolate-bar')).toHaveCount(0)
})

test('Isolate selected tasks is disabled without a selection', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  await viewMenu(page)
  await expect(page.getByRole('button', { name: /Isolate selected tasks/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Isolate my tasks/ })).toBeDisabled()
})

test('My settings + Isolate my tasks: mine, their sub-tasks and the parents above, also in read-only; remembered', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s) // read-only
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /My settings/ }).click()
  const dialog = page.getByRole('dialog', { name: 'My settings' })
  await dialog.getByLabel('My column').selectOption({ label: 'qui' })
  await expect(dialog.getByLabel('My value').locator('option')).toHaveText(['— choose', 'Mathieu', 'Paul'])
  await expect(page.getByRole('button', { name: 'View options' })).toBeVisible()
  await dialog.getByLabel('My value').selectOption({ label: 'Mathieu' })
  await dialog.getByRole('button', { name: 'Done' }).click()

  await viewMenu(page)
  await page.getByRole('button', { name: /Isolate my tasks/ }).click()
  // Alpha and Gamma are mine; Beta is Gamma's parent (context); Delta is mine but closed; Epsilon and Zeta are Paul's
  expect(await titles(page)).toEqual(['Alpha', 'Beta', 'Gamma'])
  await expect(page.locator('.isolate-bar')).toContainText('Isolated: my tasks (qui = Mathieu)')

  await page.reload()
  await page.locator('.note').first().waitFor()
  expect(await titles(page)).toEqual(['Alpha', 'Beta', 'Gamma']) // the mode survives a reload

  await viewMenu(page)
  await page.getByLabel('Show closed tasks').check()
  expect(await titles(page)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma'])
  await page.getByRole('button', { name: 'Cancel isolate mode' }).click()
  expect((await titles(page)).length).toBe(6)
})
