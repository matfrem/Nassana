import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, center, doubleTap, drag, noteCenter, openBoard, startEditing } from './helpers'

const three = (links: [string, string][] = []) =>
  new FakeSheet({
    Tasks: [
      ['id', 'title', 'board'],
      ['a', 'Alpha', board(-400, -90)],
      ['b', 'Beta', board(0, -150)],
      ['c', 'Gamma', board(250, 60)],
    ],
    _board: [['id', 'type', 'data'], ...links.map(([id, data]) => [id, 'link', data])],
  })

test('drag from one note to another to link them; duplicates are refused, the reverse link is allowed', async ({ page }) => {
  const sheet = three()
  await openBoard(page, sheet)
  await startEditing(page)
  await page.getByRole('button', { name: 'Link' }).click()
  const A = await noteCenter(page, 'Alpha')
  const B = await noteCenter(page, 'Beta')
  const C = await noteCenter(page, 'Gamma')

  await drag(page, A, B, 10)
  await expect.poll(() => sheet.board('link')).toHaveLength(1)
  expect(JSON.parse(sheet.board('link')[0])).toEqual({ from: 'a', to: 'b', arrow: 'one' })
  await expect(page.locator('.link-line')).toHaveCount(1)
  await expect(page.locator('.link-arrow')).toHaveCount(1)

  await drag(page, A, B, 10) // same direction again: nothing new
  await drag(page, B, A, 10) // the other way round is a different link
  await expect.poll(() => sheet.board('link')).toHaveLength(2)
  await drag(page, A, { x: 600, y: 760 }, 10) // released on empty space: cancelled
  await drag(page, B, C, 10)
  await expect.poll(() => sheet.board('link')).toHaveLength(3)
  await expect(page.locator('.link-line')).toHaveCount(3)
})

test('a link cycles through one arrow, two arrows and none; older rows with a boolean are still read', async ({ page }) => {
  const sheet = three([
    ['l1', '{"from":"a","to":"b","arrow":true}'], // written by an older version
    ['l2', '{"from":"b","to":"c","arrow":false}'],
  ])
  await openBoard(page, sheet)
  await expect(page.locator('.link-arrow')).toHaveCount(1) // only l1 has a head
  await startEditing(page)

  const mid = await center(page, '.link-line', 0) // the first link (Alpha -> Beta)
  await page.mouse.click(mid.x, mid.y)
  const button = page.locator('.selection-bar button').first()
  await expect(button).toHaveText('→ Arrow')
  await button.click()
  await expect(button).toHaveText('↔ Both ways')
  await expect(page.locator('.link-arrow')).toHaveCount(2)
  await expect.poll(() => JSON.parse(sheet.board('link')[0]).arrow).toBe('both')
  await button.click()
  await expect(button).toHaveText('— No arrow')
  await expect(page.locator('.link-arrow')).toHaveCount(0)
  await expect.poll(() => JSON.parse(sheet.board('link')[0]).arrow).toBe('none')
  await button.click()
  await expect(button).toHaveText('→ Arrow')
})

test("a note's details list its links, and deleting the note deletes them", async ({ page }) => {
  const sheet = three([
    ['l1', '{"from":"a","to":"b","arrow":"one"}'],
    ['l2', '{"from":"b","to":"a","arrow":"one"}'],
    ['l3', '{"from":"b","to":"c","arrow":"none"}'],
  ])
  page.on('dialog', (d) => d.accept())
  await openBoard(page, sheet)
  await startEditing(page)
  await doubleTap(page, { x: (await noteCenter(page, 'Beta')).x, y: (await noteCenter(page, 'Beta')).y - 60 })
  const panel = page.getByRole('complementary', { name: 'Note details' })
  await expect(panel.locator('.links-list li')).toHaveText(['←Alpha✕', '→Alpha✕', '—Gamma✕'])

  await panel.getByRole('button', { name: 'Remove link to Gamma' }).click()
  await expect.poll(() => sheet.board('link')).toHaveLength(2)
  await panel.getByRole('button', { name: 'Close details' }).click()

  await page.locator('.note', { hasText: 'Alpha' }).click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: '🗑 Delete' }).click()
  await expect.poll(() => sheet.board('link')).toHaveLength(0) // both links of Alpha went with it
  await expect(page.locator('.link-line')).toHaveCount(0)
})
