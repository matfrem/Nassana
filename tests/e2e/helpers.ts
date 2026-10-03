import { expect, type Page } from '@playwright/test'
import { FakeSheet, SHEET_ID } from './fakeSheet'

/** Opens a board on a fake Sheet, signed in, and waits for it to finish loading. */
export async function openBoard(page: Page, sheet: FakeSheet, opts: { hash?: string; waitForNote?: boolean } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('nassana.signedIn', '1')
    // A stand-in for Google Identity Services: signing in always succeeds.
    ;(window as unknown as { google: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient: (c: { callback: (r: object) => void }) => ({ requestAccessToken: () => c.callback({ access_token: 'tok', expires_in: 3600 }) }),
          revoke() {},
        },
      },
    }
  })
  await sheet.install(page)
  await page.goto(`/${opts.hash ?? `#/sheet/${SHEET_ID}`}`)
  if (opts.waitForNote !== false) await page.locator('.note').first().waitFor()
}

export const note = (page: Page, title: string) => page.locator('.note', { has: page.locator('.note-title', { hasText: new RegExp(`^${title}$`) }) })

export interface Pt {
  x: number
  y: number
}

export async function center(page: Page, selector: string, nth = 0): Promise<Pt> {
  const box = (await page.locator(selector).nth(nth).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export const noteCenter = async (page: Page, title: string): Promise<Pt> => {
  const box = (await note(page, title).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Press, move in steps, release. */
export async function drag(page: Page, from: Pt, to: Pt, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

/** A polyline drag, e.g. a stroke. */
export async function stroke(page: Page, points: [number, number][]) {
  await page.mouse.move(...points[0])
  await page.mouse.down()
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 4 })
  await page.mouse.up()
}

/** Two quick taps, like a double-click. */
export async function doubleTap(page: Page, at: Pt) {
  await page.mouse.click(at.x, at.y)
  await page.mouse.click(at.x, at.y)
}

export const translate = async (page: Page, selector: string): Promise<[number, number]> => {
  const t = await page.locator(selector).first().evaluate((e) => (e as HTMLElement).style.transform)
  const m = t.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
  return [+m[1], +m[2]]
}

/** World position of a note (its `transform: translate(x, y)`). */
export const notePos = (page: Page, title: string) =>
  note(page, title).evaluate((e) => {
    const m = (e as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
    return [+m[1], +m[2]] as [number, number]
  })

export const board = (x: number, y: number, color = '#FFE066') => JSON.stringify({ x, y, color })

export async function waitSaved(page: Page) {
  await expect(page.locator('.badge')).toHaveText('Saved ✓', { timeout: 5_000 })
}

export async function startEditing(page: Page) {
  await page.getByRole('button', { name: '✎ Edit' }).click()
}

/** Position and size of a zone, found by its name. */
export async function zoneBox(page: Page, name: string) {
  const zone = page.locator('.zone', { has: page.locator('.zone-header', { hasText: name }) }).first()
  return zone.evaluate((e) => {
    const el = e as HTMLElement
    const m = el.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!
    return { x: +m[1], y: +m[2], w: parseFloat(el.style.width), h: parseFloat(el.style.height) }
  })
}

/** True when the note's centre is inside the zone (that is what makes a note belong to it). */
export async function inZone(page: Page, title: string, zone: string) {
  const [x, y] = await notePos(page, title)
  const z = await zoneBox(page, zone)
  const cx = x + 90
  const cy = y + 90
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h
}

export const zoneRow = (id: string, name: string, x: number, y = 200, w = 300, h = 300, extra: object = {}) =>
  [id, 'zone', JSON.stringify({ x, y, w, h, name, color: '#60A5FA', ...extra })] as const
