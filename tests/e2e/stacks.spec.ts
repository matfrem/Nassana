import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, drag, note, noteCenter, openBoard, startEditing } from './helpers'

const sheet = (extra: string[][] = []) =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'parent'],
      ['a', 'Parent', board(-200, -100), ''],
      ['b', 'Child', board(150, -100), 'a'],
      ['c', 'Grandchild', board(150, 150), 'b'],
      ['d', 'Loose', board(-200, 250), ''],
    ],
    _board: [['id', 'type', 'data'], ...extra],
  })

const parentOf = (s: FakeSheet, id: string) => {
  const rows = s.rows('Tasks')
  const col = rows[0].indexOf('parent')
  return rows.find((r) => r[0] === id)?.[col]
}

test('a closed stack hides its sub-tasks at any depth and shows a badge with the count', async ({ page }) => {
  await openBoard(page, sheet())
  await expect(note(page, 'Parent')).toBeVisible()
  await expect(note(page, 'Loose')).toBeVisible()
  await expect(note(page, 'Child')).toBeHidden()
  await expect(note(page, 'Grandchild')).toBeHidden()
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▤ 1')
  await expect(page.locator('.stack-cards')).toHaveCount(1) // the post-its peeking out underneath
})

test('the badge opens the stack level by level; the open state is shared through the Sheet', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await note(page, 'Parent').locator('.stack-badge').click()
  await expect(note(page, 'Child')).toBeVisible()
  await expect(note(page, 'Grandchild')).toBeHidden() // Child is still closed
  await expect(page.locator('.link-line')).toHaveCount(1) // derived line parent -> child
  await expect(page.locator('.link.stack')).toHaveCount(1) // drawn solid, unlike the dotted links
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
  await expect.poll(() => s.rows('Tasks').filter((r) => r[3] === 'a').length).toBe(2)
  expect(s.rows('Tasks')[0]).toEqual(['id', 'title', 'board', 'parent']) // the header is untouched

  // Details: the new parent can't be a descendant of the note itself
  await page.mouse.dblclick((await noteCenter(page, 'Loose')).x, (await noteCenter(page, 'Loose')).y)
  const select = page.getByLabel('Parent')
  await expect(select.locator('option', { hasText: 'Loose' })).toHaveCount(0)
  await select.selectOption({ label: 'Fresh' })
  await expect.poll(() => s.rows('Tasks').find((r) => r[1] === 'Fresh')?.[0]).toBeTruthy()
  await expect.poll(() => parentOf(s, 'd')).toBe(s.rows('Tasks').find((r) => r[1] === 'Fresh')![0])
  await page.getByRole('button', { name: 'Close details' }).click()

  // Deleting a parent hands its sub-tasks to the grandparent
  await page.mouse.click((await noteCenter(page, 'Child')).x - 40, (await noteCenter(page, 'Child')).y - 40)
  await page.getByRole('button', { name: /Delete/ }).click()
  await expect(note(page, 'Child')).toHaveCount(0)
  await expect.poll(() => parentOf(s, 'c')).toBe('a')
})

test('holding a dragged note over another for half a second makes it a sub-task; unparent frees it', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const loose = await noteCenter(page, 'Loose')
  const parent = await noteCenter(page, 'Parent')
  await page.mouse.click(loose.x - 40, loose.y - 40) // select it first
  // a quick pass over the parent does nothing
  await page.mouse.move(loose.x, loose.y)
  await page.mouse.down()
  await page.mouse.move(parent.x, parent.y, { steps: 8 })
  await page.mouse.move(loose.x + 250, loose.y, { steps: 8 })
  await page.mouse.up()
  expect(parentOf(s, 'd') ?? '').toBe('')
  // holding it there does
  const again = await noteCenter(page, 'Loose')
  await page.mouse.move(again.x, again.y)
  await page.mouse.down()
  await page.mouse.move(parent.x, parent.y, { steps: 8 })
  await page.waitForTimeout(700)
  await expect(note(page, 'Parent')).toHaveClass(/drop-target/)
  await page.mouse.up()
  await expect.poll(() => parentOf(s, 'd')).toBe('a')
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▾ 2')

  await page.waitForTimeout(600) // the stack glides open; the note is still selected
  await page.getByRole('button', { name: 'Unparent' }).click()
  await expect.poll(() => parentOf(s, 'd') ?? '').toBe('')
  await expect(note(page, 'Parent').locator('.stack-badge')).toHaveText('▾ 1')
})

test('holding a note over its own sub-task is refused (it would loop)', async ({ page }) => {
  const s = sheet([['open:a', 'open', '1']])
  await openBoard(page, s)
  await startEditing(page)
  const p = await noteCenter(page, 'Parent')
  const child = await noteCenter(page, 'Child')
  await page.mouse.move(p.x - 40, p.y - 40)
  await page.mouse.down()
  await page.mouse.move(child.x, child.y, { steps: 8 })
  await page.waitForTimeout(700)
  await expect(note(page, 'Child')).not.toHaveClass(/drop-target/)
  await page.mouse.up()
  expect(parentOf(s, 'a') ?? '').toBe('')
})

test('a lifted note stays under the finger (tilt and scale turn around its own centre) and lands where it was dropped', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const c = await noteCenter(page, 'Loose')
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x + 60, c.y - 40, { steps: 6 })
  await page.waitForTimeout(400)
  await expect(note(page, 'Loose')).toHaveClass(/lifted/)
  const box = (await note(page, 'Loose').boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (c.x + 60))).toBeLessThan(24)
  expect(Math.abs(box.y + box.height / 2 - (c.y - 40))).toBeLessThan(24)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await noteCenter(page, 'Loose')
  expect(Math.abs(after.x - (c.x + 60))).toBeLessThan(24)
  expect(Math.abs(after.y - (c.y - 40))).toBeLessThan(24)
})

test('a dropped note snaps its corner onto the 40-unit grid', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const c = await noteCenter(page, 'Loose')
  await drag(page, c, { x: c.x + 77, y: c.y - 53 })
  await expect
    .poll(() => {
      const b = JSON.parse(String(s.rows('Tasks').find((r) => r[0] === 'd')![2]))
      return [Math.abs(b.x % 40), Math.abs(b.y % 40)]
    })
    .toEqual([0, 0])
})
