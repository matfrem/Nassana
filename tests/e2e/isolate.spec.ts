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

const titles = (page: Page) => page.locator('.note:not(.tucked) .note-title').allTextContents().then((t) => t.sort())
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

const tree = () =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'parent'],
      ['r', 'Root', board(-500, -200), ''],
      ['a', 'A', board(-250, -200), 'r'],
      ['a1', 'A1', board(0, -200), 'a'],
      ['x', 'A1a', board(250, -200), 'a1'],
      ['y', 'A1b', board(250, 100), 'a1'],
      ['o', 'Other', board(-500, 100), ''],
      ['p', 'Other2', board(-250, 100), 'o'],
    ],
  })
const badge = (page: Page, title: string) => note(page, title).locator('.stack-badge')
const worldTransform = (page: Page) => page.locator('.world').evaluate((e) => (e as HTMLElement).style.transform)

test('opening a stack isolates it, deeper stacks narrow it down, closing a note leaves it; nothing is written to the Sheet; the camera stays', async ({ page }) => {
  const s = tree()
  await openBoard(page, s)
  expect(await titles(page)).toEqual(['Other', 'Root']) // both stacks closed
  const cam = await worldTransform(page)

  await badge(page, 'Root').click() // auto isolate: Root and what hangs below it
  expect(await titles(page)).toEqual(['A', 'Root'])
  await expect(page.locator('.stack-bar')).toContainText('Root')
  expect(await worldTransform(page)).toBe(cam) // not recentered

  await badge(page, 'A').click() // A's stack: A, its sub-tasks and its parent Root
  expect(await titles(page)).toEqual(['A', 'A1', 'Root'])
  await badge(page, 'A1').click() // A1's stack: A1, A1a, A1b and A above
  expect(await titles(page)).toEqual(['A', 'A1', 'A1a', 'A1b'])
  await expect(page.locator('.stack-bar')).toContainText('A1')
  expect(s.rows('_board').filter((r) => r[1] === 'open')).toHaveLength(0) // a local, temporary view

  await page.getByRole('button', { name: 'Close up' }).click() // one level up
  expect(await titles(page)).toEqual(['A', 'A1', 'Root'])
  await badge(page, 'A').click() // closing A closes what was opened after it, too
  expect(await titles(page)).toEqual(['A', 'Root'])
  await badge(page, 'Root').click() // closing the first one leaves the mode
  await expect(page.locator('.stack-bar')).toHaveCount(0)
  expect(await titles(page)).toEqual(['Other', 'Root'])
  expect(await worldTransform(page)).toBe(cam)
})

test('Cancel sub-task isolation leaves it at once; "Auto isolate sub-tasks" can be turned off in My settings', async ({ page }) => {
  await openBoard(page, tree())
  await badge(page, 'Root').click()
  await badge(page, 'A').click()
  await page.getByRole('button', { name: 'Cancel sub-task isolation' }).click()
  expect(await titles(page)).toEqual(['Other', 'Root'])

  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /My settings/ }).click()
  const box = page.getByLabel('Auto isolate sub-tasks')
  await expect(box).toBeChecked() // on by default
  await box.uncheck()
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  await badge(page, 'Root').click() // now a plain stack: it spreads open, nothing else disappears
  await expect(page.locator('.stack-bar')).toHaveCount(0)
  expect(await titles(page)).toEqual(['A', 'Other', 'Root'])
  await page.reload()
  await page.locator('.note').first().waitFor()
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /My settings/ }).click()
  await expect(page.getByLabel('Auto isolate sub-tasks')).not.toBeChecked() // remembered
})

test('isolating selected tasks or my tasks no longer moves the camera', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const cam = await worldTransform(page)
  const a = await corner(page, 'Alpha')
  await page.mouse.click(a.x, a.y)
  await viewMenu(page)
  await page.getByRole('button', { name: /Isolate selected tasks/ }).click()
  expect(await worldTransform(page)).toBe(cam)
})

test('inside an auto isolation every stack starts closed, whatever its shared open state; a deeper stack can be closed again', async ({ page }) => {
  const s = tree()
  s.tabs._board = [['id', 'type', 'data'], ['open:a1', 'open', '1']] // A1 was opened earlier, outside any isolation
  await openBoard(page, s)
  await badge(page, 'Root').click()
  await badge(page, 'A').click() // isolate A: A1 is shown, but closed
  expect(await titles(page)).toEqual(['A', 'A1', 'Root'])
  await expect(badge(page, 'A1')).toContainText('▤')
  await badge(page, 'A1').click()
  expect(await titles(page)).toEqual(['A', 'A1', 'A1a', 'A1b'])
  await badge(page, 'A1').click() // and it closes again
  expect(await titles(page)).toEqual(['A', 'A1', 'Root'])
})

test('"Isolate my tasks" and the sub-task isolation are two successive isolations, each with its own bar and cancel', async ({ page }) => {
  const s = new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'parent', 'qui'],
      ['r', 'Root', board(-500, -200), '', 'Mathieu'],
      ['a', 'A', board(-250, -200), 'r', 'Mathieu'],
      ['b', 'B', board(0, -200), 'r', 'Paul'], // a sub-task of Root, but not Mathieu's... it is below a task of mine, so it stays in "my tasks"
      ['q', 'Quiet', board(-500, 100), '', 'Paul'],
      ['m', 'Mine2', board(-250, 100), '', 'Mathieu'],
    ],
  })
  await openBoard(page, s)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /My settings/ }).click()
  const dialog = page.getByRole('dialog', { name: 'My settings' })
  await dialog.getByLabel('My column').selectOption({ label: 'qui' })
  await dialog.getByLabel('My value').selectOption({ label: 'Mathieu' })
  await dialog.getByRole('button', { name: 'Done' }).click()
  await viewMenu(page)
  await page.getByRole('button', { name: /Isolate my tasks/ }).click()
  expect(await titles(page)).toEqual(['Mine2', 'Root'])

  await badge(page, 'Root').click() // the second isolation, on top of the first
  expect(await titles(page)).toEqual(['A', 'B', 'Root'])
  await expect(page.locator('.isolate-bar:not(.stack-bar)')).toContainText('my tasks')
  await expect(page.locator('.stack-bar')).toContainText('Root')

  await page.getByRole('button', { name: 'Cancel sub-task isolation' }).click() // only that one ends
  expect(await titles(page)).toEqual(['Mine2', 'Root'])
  await expect(page.locator('.isolate-bar')).toHaveCount(1)
  await page.getByRole('button', { name: 'Cancel isolate mode' }).click()
  expect(await titles(page)).toEqual(['Mine2', 'Quiet', 'Root']) // everything again (A and B are tucked in Root)
})
