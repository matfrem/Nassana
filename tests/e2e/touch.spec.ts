import { expect, test, type Page } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, note, openBoard, startEditing, zoneRow } from './helpers'

test.use({ hasTouch: true, viewport: { width: 420, height: 800 } })

/** Real touch events (several fingers at once), through the DevTools protocol. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const send = (type: string, points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })) })
  return {
    down: (...p: [number, number][]) => send('touchStart', p),
    move: (...p: [number, number][]) => send('touchMove', p),
    up: () => send('touchEnd', []),
  }
}

const world = (page: Page) => page.locator('.world').evaluate((e) => (e as HTMLElement).style.transform)
const pos = (page: Page, title: string) => note(page, title).evaluate((e) => (e as HTMLElement).style.transform)
const zonePos = (page: Page) => page.locator('.zone').first().evaluate((e) => (e as HTMLElement).style.transform)
const centerOf = async (page: Page, selector: string): Promise<[number, number]> => {
  const b = (await page.locator(selector).first().boundingBox())!
  return [b.x + b.width / 2, b.y + b.height / 2]
}

function sheet() {
  return new FakeSheet({
    Tasks: [
      ['id', 'title', 'board'],
      ['a', 'Alpha', board(-200, -120)],
      ['b', 'Beta', board(40, -120)],
      ['c', 'Gamma', board(-80, 120)],
    ],
    _board: [['id', 'type', 'data'], [...zoneRow('z1', 'Zone', -260, 260, 420, 220)].map((v) => v)],
  })
}

test('one finger drags a note; a second finger turns the gesture into pan + zoom without moving the note', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const f = await fingers(page)

  // one finger: drags Beta
  const beta = await centerOf(page, '.note:has-text("Beta")')
  const betaBefore = await pos(page, 'Beta')
  await f.down(beta)
  for (let i = 1; i <= 6; i++) await f.move([beta[0] + i * 10, beta[1] + i * 5])
  await f.up()
  expect(await pos(page, 'Beta')).not.toBe(betaBefore)

  // a finger holds Alpha, a second one lands on empty space and both move apart
  const alpha = await centerOf(page, '.note:has-text("Alpha")')
  const alphaBefore = await pos(page, 'Alpha')
  const worldBefore = await world(page)
  await f.down(alpha)
  await f.down(alpha, [350, 700])
  for (let i = 1; i <= 6; i++) await f.move([alpha[0] + i * 6, alpha[1] + i * 8], [350 + i * 16, 700 + i * 4])
  await f.up()
  expect(await pos(page, 'Alpha')).toBe(alphaBefore) // the note did not move
  expect(await world(page)).not.toBe(worldBefore) // the board panned and zoomed
})

test('a finger that already dragged a note stops dragging when a second finger lands', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const f = await fingers(page)
  const gamma = await centerOf(page, '.note:has-text("Gamma")')
  const before = await pos(page, 'Gamma')
  await f.down(gamma)
  for (let i = 1; i <= 4; i++) await f.move([gamma[0] + i * 15, gamma[1]])
  const dragged = await pos(page, 'Gamma')
  expect(dragged).not.toBe(before) // it followed the first finger
  await f.down([gamma[0] + 60, gamma[1]], [380, 100])
  for (let i = 1; i <= 5; i++) await f.move([gamma[0] + 60 + i * 20, gamma[1] + i * 20], [380, 100])
  await f.up()
  expect(await pos(page, 'Gamma')).toBe(dragged) // and stopped there
})

test('the same goes for a zone: a second finger never moves it, one finger does', async ({ page }) => {
  await openBoard(page, sheet())
  await startEditing(page)
  const f = await fingers(page)
  const header = await centerOf(page, '.zone-header')
  const before = await zonePos(page)

  await f.down(header)
  await f.down(header, [60, 90])
  for (let i = 1; i <= 6; i++) await f.move([header[0] + i * 8, header[1] + i * 8], [60 - i * 5, 90])
  await f.up()
  expect(await zonePos(page)).toBe(before)

  const again = await centerOf(page, '.zone-header'); again[0] = 50
  await f.down(again)
  for (let i = 1; i <= 6; i++) await f.move([again[0] + i * 8, again[1] + i * 4])
  await f.up()
  expect(await zonePos(page)).not.toBe(before)
})
