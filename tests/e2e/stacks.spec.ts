import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, drag, note, noteCenter, openBoard, startEditing } from './helpers'

const sheet = (extra: string[][] = []) =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board'],
      ['a', 'Parent', board(-200, -100)],
      ['b', 'Child', board(150, -100)],
      ['c', 'Grandchild', board(150, 150)],
      ['d', 'Loose', board(-200, 250)],
    ],
    _board: [['id', 'type', 'data'], ['parent:b', 'parent', 'a'], ['parent:c', 'parent', 'b'], ...extra],
  })

test('a closed stack hides its sub-tasks at any depth and shows a badge with the count', async ({ page }) => {
  await openBoard(page, sheet())
  await expect(note(page, 'Parent')).toBeVisible()
  await expect(note(page, 'Loose')).toBeVisible()
  await expect(note(page, 'Child')).toBeHidden()
  await expect(note(page, 'Grandchild')).toBeHidden()
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▤ 1')
  await expect(note(page, 'Parent')).toHaveClass(/stacked/)
})

test('the badge opens the stack level by level; the open state is shared through the Sheet', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await note(page, 'Parent').locator('.stack-badge').click()
  await expect(note(page, 'Child')).toBeVisible()
  await expect(note(page, 'Grandchild')).toBeHidden() // Child is still closed
  await expect(page.locator('.link-line')).toHaveCount(1) // derived line parent -> child
  await expect.poll(() => s.rows('_board').filter((r) => r[1] === 'open').map((r) => r[0])).toEqual(['open:a'])
  await note(page, 'Child').locator('.stack-badge').click()
  await expect(note(page, 'Grandchild')).toBeVisible()
  await expect(page.locator('.link-line')).toHaveCount(2)
  await note(page, 'Parent').locator('.stack-badge').click() // tuck everything again
  await expect(note(page, 'Child')).toBeHidden()
  await expect(note(page, 'Grandchild')).toBeHidden()
  await expect.poll(() => s.rows('_board').filter((r) => r[1] === 'open').map((r) => r[0])).toEqual(['open:b'])
})

test('a stack that is open in the Sheet opens for everyone; children move freely', async ({ page }) => {
  const s = sheet([['open:a', 'open', '1']])
  await openBoard(page, s)
  await expect(note(page, 'Child')).toBeVisible()
  await startEditing(page)
  const before = await noteCenter(page, 'Child')
  await drag(page, before, { x: before.x, y: before.y + 120 }, 8)
  await expect.poll(async () => (await noteCenter(page, 'Child')).y).toBeGreaterThan(before.y + 100)
})

test('adding a sub-task, choosing a parent in the details, and deleting a parent', async ({ page }) => {
  const s = sheet()
  page.on('dialog', (d) => d.accept())
  await openBoard(page, s)
  await startEditing(page)
  const p = await noteCenter(page, 'Parent')
  await page.mouse.click(p.x - 40, p.y - 40)
  await page.getByRole('button', { name: 'Add sub-task' }).click()
  await page.keyboard.type('Fresh')
  await page.keyboard.press('Enter')
  await expect(note(page, 'Fresh')).toBeVisible()
  await expect(note(page, 'Child')).toBeVisible() // its parent opened
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▾ 2')
  await expect.poll(() => s.rows('_board').filter((r) => r[1] === 'parent').length).toBe(3)

  // Details: the new parent can't be a descendant of the note itself
  await page.mouse.dblclick((await noteCenter(page, 'Loose')).x, (await noteCenter(page, 'Loose')).y)
  const select = page.getByLabel('Parent')
  await expect(select.locator('option', { hasText: 'Loose' })).toHaveCount(0)
  await select.selectOption({ label: 'Fresh' })
  await expect.poll(() => s.rows('_board').filter((r) => r[1] === 'parent' && r[0] === 'parent:d').length).toBe(1)
  await page.getByRole('button', { name: 'Close details' }).click()

  // Deleting a parent hands its sub-tasks to the grandparent
  await page.mouse.click((await noteCenter(page, 'Child')).x - 40, (await noteCenter(page, 'Child')).y - 40)
  await page.getByRole('button', { name: /Delete/ }).click()
  await expect(note(page, 'Child')).toHaveCount(0)
  await expect.poll(() => s.rows('_board').find((r) => r[0] === 'parent:c')?.[2]).toBe('a')
})
