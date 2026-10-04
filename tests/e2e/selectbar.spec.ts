import { test, expect } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, noteCenter, openBoard, startEditing } from './helpers'
test.use({ viewport: { width: 400, height: 800 } })
test('phone: in the Select tool only its bar shows, with Done reachable', async ({ page }) => {
  const s = new FakeSheet({ Tasks: [['id','title','board'],['a','Alpha',board(0,0)],['b','Beta',board(250,0)]] })
  await openBoard(page, s); await startEditing(page)
  await page.getByRole('button', { name: 'More tools' }).click()
  await page.getByRole('button', { name: /Select/ }).click()
  const a = await noteCenter(page,'Alpha'); await page.mouse.click(a.x,a.y)
  const b = await noteCenter(page,'Beta'); await page.mouse.click(b.x,b.y)
  await expect(page.locator('.selection-bar')).toHaveCount(1)
  await page.locator('.zone-bar').getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.selection-bar')).toHaveCount(1)
  await expect(page.getByText('2 selected')).toBeVisible()
})
