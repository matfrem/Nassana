import { expect, test } from '@playwright/test'
import { FakeSheet } from './fakeSheet'
import { board, note, openBoard, startEditing } from './helpers'

function sheetWithColumns() {
  const s = new FakeSheet({
    Tasks: [
      ['id', 'title', 'prio#', 'notes', 'project#', 'board', 'drawing', 'status'],
      ['1', 'One', 1, 'hello', 'BSN', board(-200, -90), '', ''],
      ['2', 'Two', 2, '', 'TZ', board(40, -90), '', ''],
    ],
  })
  s.conditionalFormats = [
    {
      ranges: [{ sheetId: 1, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 }],
      booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: 'BSN' }] }, format: { backgroundColor: { red: 0.7, green: 0.9, blue: 0.8 } } },
    },
  ]
  return s
}

async function openColumns(page: import('@playwright/test').Page) {
  await startEditing(page)
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: '⚙ Edit columns…' }).click()
  await page.locator('.cfg-row').first().waitFor()
}

const row = (page: import('@playwright/test').Page, name: string) =>
  page.locator('.cfg-row:not(.system)', { has: page.locator(`input[value="${name}"]`) })
const names = (page: import('@playwright/test').Page) =>
  page.locator('.cfg-row:not(.system):not(.deleted) input[aria-label="Column name"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))

test('lists the columns with their types, and the ones the app manages', async ({ page }) => {
  await openBoard(page, sheetWithColumns())
  await openColumns(page)
  expect(await names(page)).toEqual(['prio', 'notes', 'project'])
  await expect(page.locator('.cfg-row:not(.system) select[aria-label="Type"]')).toHaveText(['TextNumberDateCheckboxDropdown', 'TextNumberDateCheckboxDropdown', 'TextNumberDateCheckboxDropdown'])
  await expect(page.locator('.cfg-row.system strong')).toHaveText(['id', 'title', 'board', 'drawing', 'status', 'description'])
  await expect(page.getByRole('button', { name: /^Apply/ })).toBeDisabled() // nothing to apply yet
})

test('checks names and dropdown values before allowing Apply', async ({ page }) => {
  await openBoard(page, sheetWithColumns())
  await openColumns(page)
  await page.getByRole('button', { name: '＋ Add a column' }).click()
  const fresh = page.locator('.cfg-row:not(.system):not(.deleted)').last()
  await expect(fresh.locator('.error')).toHaveText('Give the column a name.')
  await fresh.getByLabel('Column name').fill('status')
  await expect(fresh.locator('.error')).toContainText('used by the app')
  await fresh.getByLabel('Column name').fill('notes')
  await expect(fresh.locator('.error')).toHaveText('Two columns have this name.')
  await fresh.getByLabel('Column name').fill('sprint')
  await fresh.getByLabel('Type').selectOption('select')
  await expect(fresh.locator('.error')).toHaveText('Add at least one value to the dropdown.')
  await expect(page.getByRole('button', { name: /^Apply/ })).toBeDisabled()
  await fresh.getByRole('button', { name: '＋ Add a value' }).click()
  await fresh.getByRole('textbox', { name: 'Value' }).fill('S1')
  await expect(fresh.locator('.error')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Apply/ })).toBeEnabled()
})

test('applies renames, deletion, reordering, new columns and hiding in one request', async ({ page }) => {
  const sheet = sheetWithColumns()
  page.on('dialog', (d) => d.accept())
  await openBoard(page, sheet)
  await openColumns(page)

  await row(page, 'prio').getByLabel('Column name').fill('priority')
  await row(page, 'notes').getByRole('button', { name: 'Delete' }).click()
  await row(page, 'project').getByRole('button', { name: 'Move up' }).click()
  expect(await names(page)).toEqual(['project', 'priority'])
  await row(page, 'project').getByLabel('Type').selectOption('select')
  await expect(page.locator(".cfg-opt input[aria-label=\"Value\"]").first()).toHaveValue(/BSN|TZ/, { timeout: 2000 }) // its current values are offered
  await page.getByRole('button', { name: '＋ Add a column' }).click()
  const sprint = page.locator('.cfg-row:not(.system):not(.deleted)').last()
  await sprint.getByLabel('Column name').fill('sprint')
  await sprint.getByLabel('Type').selectOption('select')
  await sprint.getByRole('button', { name: '＋ Add a value' }).click()
  await sprint.getByRole('textbox', { name: 'Value' }).fill('S1')
  await page.locator('.cfg-row.system', { has: page.locator('strong', { hasText: /^board$/ }) }).locator('input[type=checkbox]').check()
  await page.locator('.cfg-row.system', { has: page.locator('strong', { hasText: /^description$/ }) }).getByRole('button', { name: '＋ Add' }).click()

  await expect(page.locator('.cfg-preview .chip')).toHaveCount(3) // priority, project and sprint are shown on notes
  await page.getByRole('button', { name: /^Apply/ }).click()
  await expect(page.locator('.cfg-confirm li')).toContainText([
    'Delete column “notes” (1 value)',
    'Change the order of the columns',
    'Add the “description” column',
    'Add column “sprint” (Dropdown, shown on notes)',
    'Rename “prio” to “priority”',
    'Change “project” to Dropdown',
    'Hide the “board” column in the Sheet',
  ])
  expect(sheet.batches).toHaveLength(0) // nothing is written before confirming
  await page.locator('.cfg-confirm').getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.cfg')).toHaveCount(0)

  expect(sheet.batches).toHaveLength(1) // one single request
  const kinds = sheet.batches[0].map((r) => Object.keys(r)[0])
  expect(kinds.filter((k) => k === 'deleteDimension')).toHaveLength(1)
  expect(kinds).toContain('moveDimension')
  expect(kinds).toContain('updateDimensionProperties')
  expect(kinds.filter((k) => k === 'addConditionalFormatRule').length).toBeGreaterThanOrEqual(3) // project: BSN, TZ; sprint: S1
  const headers = sheet.batches[0].filter((r) => 'updateCells' in r).map((r) => (r as any).updateCells.rows[0].values[0].userEnteredValue.stringValue)
  expect(headers).toEqual(expect.arrayContaining(['description', 'sprint#', 'priority#']))
})

test('refuses to apply when the Sheet\'s columns changed since the page opened', async ({ page }) => {
  const sheet = sheetWithColumns()
  await openBoard(page, sheet)
  await openColumns(page)
  await row(page, 'prio').getByLabel('Column name').fill('priority')
  sheet.tabs.Tasks[0][3] = 'notes (edited by someone else)' // somebody renames a column meanwhile
  await page.getByRole('button', { name: /^Apply/ }).click()
  await page.locator('.cfg-confirm').getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.cfg .error')).toContainText('changed since you opened this page')
  expect(sheet.batches).toHaveLength(0)
})

test('a column can be given an emoji (saved in the board only), shown before the value in its pills; the Sheet link opens in a tab', async ({ page }) => {
  const s = sheetWithColumns()
  await openBoard(page, s)
  await openColumns(page)
  await row(page, 'project').getByLabel('Emoji').selectOption('🎯')
  await expect.poll(() => s.rows('_board').find((r) => r[0] === 'colicon:project#')?.[2]).toBe('🎯')
  expect(s.rows('Tasks')[0]).toEqual(['id', 'title', 'prio#', 'notes', 'project#', 'board', 'drawing', 'status']) // the Sheet's titles are untouched
  const link = page.getByRole('link', { name: /Open in Google Sheets/ })
  await expect(link).toHaveAttribute('href', /docs\.google\.com\/spreadsheets\/d\/.+\/edit/)
  await expect(link).toHaveAttribute('target', '_blank')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(note(page, 'One').locator('.chip').filter({ hasText: 'BSN' })).toHaveText(/🎯.*BSN/)

  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('button', { name: '⚙ Edit columns…' }).click()
  await page.locator('.cfg-row').first().waitFor()
  await row(page, 'project').getByLabel('Emoji').selectOption('')
  await expect.poll(() => s.rows('_board').filter((r) => r[0] === 'colicon:project#').length).toBe(0)
})
