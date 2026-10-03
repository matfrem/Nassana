import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, doubleTap, drag, inZone, noteCenter, notePos, openBoard, startEditing, zoneBox, zoneRow } from './helpers'

const BOARD_HEADER = ['id', 'type', 'data']
const zonesSheet = (tasks: (string | number)[][], extraRows: (readonly [string, string, string])[] = []) =>
  new FakeSheet({
    Tasks: [['id', 'title', 'status', 'board'], ...tasks],
    _board: [BOARD_HEADER, zoneRow('z1', 'Backlog', -700, -100, 440, 640), zoneRow('z2', 'In progress', -250, -100, 440, 640), zoneRow('z3', 'Done', 200, -100, 440, 640), ...extraRows.map((r) => [...r])],
  })

test('on load, the Sheet decides where notes belong', async ({ page }) => {
  const sheet = zonesSheet([
    ['a', 'Floating', 'In progress', board(-900, -100)], // outside every zone: stays
    ['b', 'No position', 'Done', ''], // no saved position: goes into its status's zone
    ['c', 'Misplaced', 'In progress', board(-680, -30)], // sits in Backlog but says In progress: moves
    ['d', 'Plain', '', board(-900, 300)], // no status: untouched
  ])
  await openBoard(page, sheet)
  expect(await notePos(page, 'Floating')).toEqual([-900, -100])
  expect(await inZone(page, 'No position', 'Done')).toBe(true)
  expect(await inZone(page, 'Misplaced', 'In progress')).toBe(true)
  expect(await notePos(page, 'Plain')).toEqual([-900, 300])
})

test('dropping a note in a zone gives it the zone name as status', async ({ page }) => {
  const sheet = zonesSheet([['p', 'Plain', '', board(-900, 300)]])
  await openBoard(page, sheet)
  await startEditing(page)
  const zone = await zoneBox(page, 'Backlog')
  const from = await noteCenter(page, 'Plain')
  const header = await page.locator('.zone-header', { hasText: 'Backlog' }).boundingBox()
  await drag(page, from, { x: header!.x + 120, y: header!.y + 250 })
  expect(zone.w).toBe(440)
  await expect.poll(() => sheet.cell('Tasks', 'C2')).toBe('Backlog')
  expect(JSON.parse(String(sheet.cell('Tasks', 'D2'))).x).toBeGreaterThan(-700) // and its position was saved
  expect(await inZone(page, 'Plain', 'Backlog')).toBe(true)
})

test('a zone is configured in its details: name, color, limit; the counter reacts', async ({ page }) => {
  const sheet = zonesSheet([
    ['1', 'One', 'Done', board(210, -30)],
    ['2', 'Two', 'Done', board(210, 170)],
  ])
  page.on('dialog', (d) => d.accept())
  await openBoard(page, sheet)
  await startEditing(page)
  const header = page.locator('.zone-header', { hasText: 'Done' })
  await expect(header).toContainText('2')
  const box = (await header.boundingBox())!
  await doubleTap(page, { x: box.x + 40, y: box.y + 10 })
  const panel = page.getByRole('complementary', { name: 'Zone details' })
  await expect(panel).toContainText('2 notes inside')

  await panel.getByLabel('Work-in-progress limit').fill('1')
  await expect(page.locator('.zone-count.over')).toHaveText('2/1') // over the limit: red
  await panel.getByLabel('Zone name').fill('Finished')
  await expect.poll(() => JSON.parse(sheet.board('zone')[2])).toMatchObject({ name: 'Finished', limit: 1 })
  await expect.poll(() => [sheet.cell('Tasks', 'C2'), sheet.cell('Tasks', 'C3')]).toEqual(['Finished', 'Finished']) // the notes inside follow the rename

  await panel.getByRole('button', { name: /Delete zone/ }).click()
  await expect.poll(() => sheet.board('zone')).toHaveLength(2)
  await expect(page.locator('.note')).toHaveCount(2) // its notes stay
})

test('moving a zone carries its notes and the strokes drawn entirely inside it', async ({ page }) => {
  const inside = '{"c":"#E5484D","w":3,"p":[-600,0,50,50]}'
  const crossing = '{"c":"#3B82F6","w":3,"p":[-300,0,100,0]}' // sticks out of the zone: stays
  const sheet = zonesSheet([['p', 'Plain', 'Backlog', board(-680, 100)]], [['s1', 'stroke', inside], ['s2', 'stroke', crossing]])
  await openBoard(page, sheet)
  await startEditing(page)
  const header = (await page.locator('.zone-header', { hasText: 'Backlog' }).boundingBox())!
  await drag(page, { x: header.x + 60, y: header.y + 15 }, { x: header.x + 60, y: header.y + 15 + 60 })
  await expect.poll(() => JSON.parse(String(sheet.cell('Tasks', 'D2'))).y).toBeGreaterThan(150) // the note moved with it
  await expect.poll(() => JSON.parse(sheet.board('stroke')[0]).p[1]).toBeGreaterThan(50) // so did the stroke inside
  expect(sheet.board('stroke')[1]).toBe(crossing) // the one crossing the border did not
})

test('creates one zone per status and moves the notes into them', async ({ page }) => {
  const sheet = new FakeSheet({
    Tasks: [
      ['id', 'title', 'status', 'board'],
      ['1', 'Alpha', 'To Do', board(-600, -100)],
      ['2', 'Beta', 'Done', board(-400, -100)],
      ['3', 'Gamma', 'Done', board(-200, -100)],
      ['4', 'Delta', 'En Cours', board(0, -100)],
      ['5', 'Epsilon', 'To Do', board(200, -100)],
      ['6', 'Loose', '', board(400, -100)],
    ],
  })
  await openBoard(page, sheet)
  await startEditing(page)
  await page.getByRole('button', { name: 'Zone' }).click()
  await page.getByRole('button', { name: 'One zone per status (3)' }).click()

  await expect(page.locator('.zone-header')).toHaveText(['To Do2', 'Done2', 'En Cours1'])
  for (const [title, zone] of [['Alpha', 'To Do'], ['Epsilon', 'To Do'], ['Beta', 'Done'], ['Gamma', 'Done'], ['Delta', 'En Cours']]) {
    expect(await inZone(page, title, zone)).toBe(true)
  }
  expect(await notePos(page, 'Loose')).toEqual([400, -100]) // no status: stays where it was
  await expect.poll(() => sheet.board('zone')).toHaveLength(3)
  await expect.poll(() => JSON.parse(String(sheet.cell('Tasks', 'D2'))).y).toBeGreaterThan(0) // moved notes are saved
})
