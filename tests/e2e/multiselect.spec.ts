import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, drag, note, noteCenter, notePos, openBoard, startEditing, zoneRow } from './helpers'

const sheet = () =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board', 'parent'],
      ['a', 'Alpha', board(-400, -200), ''],
      ['b', 'Beta', board(-120, -200), 'a'],
      ['c', 'Gamma', board(160, -200), ''],
      ['d', 'Delta', board(440, 160), ''],
    ],
    _board: [
      ['id', 'type', 'data'],
      ['l1', 'link', '{"from":"a","to":"b","arrow":"one"}'],
      ['open:a', 'open', '1'],
      ['s1', 'stroke', '{"c":"#3B82F6","w":4,"p":[-400,300,-200,330]}'],
      zoneRow('z1', 'Box', 300, 100, 400, 300),
    ],
  })

const xy = (s: FakeSheet, id: string): [number, number] => {
  const b = JSON.parse(String(s.rows('Tasks').find((r) => r[0] === id)![2]))
  return [b.x, b.y]
}
const corner = async (page: import('@playwright/test').Page, title: string) => {
  const c = await noteCenter(page, title)
  return { x: c.x - 60, y: c.y - 60 }
}

test('Ctrl+click adds and removes notes; dragging one member moves them all; Escape clears', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await page.mouse.click((await corner(page, 'Alpha')).x, (await corner(page, 'Alpha')).y)
  const g = await corner(page, 'Gamma')
  await page.keyboard.down('Control')
  await page.mouse.click(g.x, g.y)
  const d = await corner(page, 'Delta')
  await page.mouse.click(d.x, d.y)
  await page.keyboard.up('Control')
  await expect(page.getByText('3 selected')).toBeVisible()
  await expect(page.locator('.note.selected')).toHaveCount(3)

  await page.waitForTimeout(450) // not a double tap
  await page.keyboard.down('Control') // Ctrl+click again removes it
  await page.mouse.click(d.x, d.y)
  await page.keyboard.up('Control')
  await expect(page.getByText('2 selected')).toBeVisible()

  const [ax, ay] = xy(s, 'a')
  const [bx] = xy(s, 'b')
  const from = await noteCenter(page, 'Gamma')
  await drag(page, from, { x: from.x + 120, y: from.y + 80 })
  await expect.poll(() => xy(s, 'a')[0]).toBeGreaterThan(ax + 40)
  expect(xy(s, 'a')[1]).toBeGreaterThan(ay + 20)
  expect(xy(s, 'b')[0]).toBe(bx) // Beta was not selected

  await page.keyboard.press('Escape')
  await expect(page.getByText('2 selected')).toHaveCount(0)
  await expect(page.locator('.note.selected')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0) // still editing: Escape only cleared the selection
})

test('Shift+drag draws a selection rectangle; arrows move the selection; Delete removes it after one confirmation', async ({ page }) => {
  const s = sheet()
  page.on('dialog', (dlg) => void dlg.accept())
  await openBoard(page, s)
  await startEditing(page)
  const a = await corner(page, 'Alpha')
  const c = await noteCenter(page, 'Gamma')
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x - 20, a.y - 40)
  await page.mouse.down()
  await page.mouse.move(c.x + 120, c.y + 120, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.getByText('3 selected')).toBeVisible() // Alpha, Beta, Gamma

  const before = xy(s, 'a')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => xy(s, 'a')).toEqual([before[0] + 40, before[1] + 40])
  expect(xy(s, 'c')[0]).toBe(160 + 40)

  await page.keyboard.press('Delete')
  await expect(page.locator('.note')).toHaveCount(1)
  await expect.poll(() => s.rows('Tasks').length).toBe(2)
  await expect.poll(() => s.board('link')).toHaveLength(0) // the link between deleted notes went too
})

test('the Select tool: a tap toggles a note, a drag selects a rectangle, colors apply to every selected note', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /Select/ }).click()
  const a = await noteCenter(page, 'Alpha')
  await page.mouse.click(a.x, a.y)
  const g = await noteCenter(page, 'Gamma')
  await page.mouse.click(g.x, g.y)
  await expect(page.getByText(/^2 selected/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Color #FFADAD' })).toHaveCount(0) // the action bar waits for Done
  await page.locator('.zone-bar').getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Color #FFADAD' }).click()
  await expect
    .poll(() => ['a', 'c'].map((id) => JSON.parse(String(s.rows('Tasks').find((r) => r[0] === id)![2])).color))
    .toEqual(['#FFADAD', '#FFADAD'])
  expect(JSON.parse(String(s.rows('Tasks').find((r) => r[0] === 'b')![2])).color).toBe('#FFE066')
  await page.getByRole('button', { name: 'Clear selection' }).click()
  await expect(page.getByText('2 selected')).toHaveCount(0)
})

test('a selected zone, a note and a stroke move together; notes inside the zone are carried once', async ({ page }) => {
  const s = sheet()
  s.tabs.Tasks.push(['e', 'Inside', board(340, 150), ''])
  await openBoard(page, s)
  await startEditing(page)
  const stroke0 = JSON.parse(s.board('stroke')[0]).p[1]
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /Select/ }).click()
  // rectangle around the zone, Alpha and the stroke's area
  const a = await corner(page, 'Alpha')
  const zoneBox = (await page.locator('.zone').first().boundingBox())!
  await page.mouse.move(a.x - 30, a.y - 50)
  await page.mouse.down()
  await page.mouse.move(zoneBox.x + zoneBox.width + 20, zoneBox.y + zoneBox.height + 20, { steps: 10 })
  await page.mouse.up()
  const count = await page.locator('.zone-bar span').textContent()
  expect(Number.parseInt(count ?? '0')).toBeGreaterThanOrEqual(4)

  const zoneBefore = JSON.parse(s.board('zone')[0])
  const insideBefore = xy(s, 'e')
  await page.locator('.zone-bar').getByRole('button', { name: 'Done' }).click() // leave the Select tool, keep the selection
  const alpha = await noteCenter(page, 'Alpha')
  await drag(page, alpha, { x: alpha.x + 80, y: alpha.y + 80 })
  await expect.poll(() => JSON.parse(s.board('zone')[0]).x).toBeGreaterThan(zoneBefore.x)
  const dz = JSON.parse(s.board('zone')[0]).x - zoneBefore.x
  await expect.poll(() => xy(s, 'e')[0] - insideBefore[0]).toBe(dz) // carried exactly once
  await expect.poll(() => JSON.parse(s.board('stroke')[0]).p[1]).not.toBe(stroke0)
})

test('Ctrl+C / Ctrl+V on several notes keeps their layout, sub-task structure and the links between them', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  const a = await noteCenter(page, 'Alpha')
  const b = await noteCenter(page, 'Beta')
  await page.mouse.click(a.x - 60, a.y - 60)
  await page.keyboard.down('Control')
  await page.mouse.click(b.x - 60, b.y - 60)
  await page.keyboard.up('Control')
  await page.keyboard.press('Control+c')
  await page.keyboard.press('Control+v')
  await expect(page.locator('.note')).toHaveCount(6)
  await expect.poll(() => s.rows('Tasks').length).toBe(7)
  const rows = s.rows('Tasks').slice(1)
  const copies = rows.filter((r) => !['a', 'b', 'c', 'd'].includes(String(r[0])))
  expect(copies).toHaveLength(2)
  const copyOfA = copies.find((r) => JSON.parse(String(r[2])).x > -100 && r[3] === '')!
  const copyOfB = copies.find((r) => r !== copyOfA)!
  expect(copyOfB[3]).toBe(copyOfA[0]) // the copy of Beta is a sub-task of the copy of Alpha
  expect(JSON.parse(String(copyOfB[2])).x - JSON.parse(String(copyOfA[2])).x).toBe(280) // same spacing as the originals
  await expect.poll(() => s.board('link')).toHaveLength(2) // and the link was copied too
})

test('Ctrl+A selects every visible note', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  await page.keyboard.press('Control+a')
  await expect(page.getByText(/^4 selected$/)).toBeVisible()
})

test('the Move button of the selection bar drags the whole selection from anywhere (strokes too)', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  // select the stroke and Alpha with a rectangle
  const a = await corner(page, 'Alpha')
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x - 60, a.y - 30)
  await page.mouse.down()
  await page.mouse.move(a.x + 160, a.y + 640, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.getByText(/selected/).first()).toBeVisible()
  const before = JSON.parse(s.board('stroke')[0]).p
  const alphaBefore = xy(s, 'a')
  await page.getByRole('button', { name: 'Move selection' }).click()
  await expect(page.getByRole('button', { name: 'Move selection' })).toHaveAttribute('aria-pressed', 'true')
  await drag(page, { x: 900, y: 700 }, { x: 900, y: 790 }) // from empty space, far from the selected things
  await expect.poll(() => JSON.parse(s.board('stroke')[0]).p[1]).toBeGreaterThan(before[1] + 40)
  await expect.poll(() => xy(s, 'a')[1]).toBeGreaterThan(alphaBefore[1] + 40)
  await page.getByRole('button', { name: 'Move selection' }).click() // back to normal
  await expect(page.getByRole('button', { name: 'Move selection' })).toHaveAttribute('aria-pressed', 'false')
})

test('a selection of strokes only still has Move and Delete', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /Select/ }).click()
  const box = (await page.locator('.ink path:not(.stroke-halo)').first().boundingBox())!
  await page.mouse.move(Math.max(2, box.x - 10), Math.max(70, box.y - 10))
  await page.mouse.down()
  await page.mouse.move(Math.min(1090, box.x + box.width + 10), Math.min(840, box.y + box.height + 10), { steps: 8 })
  await page.mouse.up()
  await page.locator('.zone-bar').getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Move selection' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete selection' })).toBeVisible()
})

test('with the Select tool a tap on a drawing adds it, another tap removes it', async ({ page }) => {
  const s = sheet()
  await openBoard(page, s)
  await startEditing(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /Select/ }).click()
  const mid = await (async () => {
    const b = (await page.locator('.ink path:not(.stroke-halo)').first().boundingBox())!
    return { x: Math.min(1000, Math.max(20, b.x + b.width / 2)), y: Math.min(800, Math.max(100, b.y + b.height / 2)) }
  })()
  const a = await noteCenter(page, 'Alpha')
  await page.mouse.click(a.x, a.y)
  await expect(page.getByText(/^1 selected/)).toBeVisible()
  // the stroke: tap on one of its points that is on screen
  const pt = await page.locator('.ink path:not(.stroke-halo)').first().evaluate((el) => {
    const path = el as SVGPathElement
    for (let i = 0; i <= 20; i++) {
      const p = path.getPointAtLength((path.getTotalLength() * i) / 20)
      const m = path.getScreenCTM()!
      const x = p.x * m.a + m.e
      const y = p.y * m.d + m.f
      if (x > 10 && x < 1050 && y > 80 && y < 780) return { x, y }
    }
    return null
  })
  expect(pt).not.toBeNull()
  void mid
  await page.mouse.click(pt!.x, pt!.y)
  await expect(page.getByText(/^2 selected/)).toBeVisible()
  await page.waitForTimeout(400)
  await page.mouse.click(pt!.x, pt!.y)
  await expect(page.getByText(/^1 selected/)).toBeVisible()
})
