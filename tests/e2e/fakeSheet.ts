import type { Page, Route } from '@playwright/test'

export type Cell = string | number | boolean
export const SHEET_ID = 'T'.repeat(30)

const col = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

/**
 * An in-memory stand-in for the Google Sheets API, installed with `page.route`. It understands exactly what
 * the app sends: reading tabs, value updates and appends, row/tab creation and deletion, the grid-data call
 * (data validation, fills) and the structure call of the columns page. Tests then assert on `tabs`.
 */
export class FakeSheet {
  /** Tab name -> rows. */
  tabs: Record<string, Cell[][]>
  /** Answer to the app's grid-data call (dropdown lists, date formats, cell fills). */
  grid: object = {}
  conditionalFormats: object[] = []
  /** Other ranges, by tab name, for dropdowns fed from a list (`='Lists'!A1:A3`). */
  lists: Record<string, Cell[][]> = {}
  title = 'Test sheet'
  /** Every structural `batchUpdate` (columns page), one array of requests per call. */
  batches: Record<string, unknown>[][] = []
  /** Answer 403 to every write, like a Sheet we can only read. */
  denyWrites = false
  private ids = new Map<string, number>()

  constructor(tabs: Record<string, Cell[][]>) {
    this.tabs = tabs
    Object.keys(tabs).forEach((t) => this.ids.set(t, this.ids.size + 1))
  }

  cell(tab: string, a1: string): Cell | undefined {
    const m = a1.match(/^([A-Z]+)(\d+)$/)!
    return this.tabs[tab]?.[+m[2] - 1]?.[col(m[1])]
  }

  rows(tab: string): Cell[][] {
    return this.tabs[tab] ?? []
  }

  /** The `data` cell of every `_board` row of a type. */
  board(type: string): string[] {
    return this.rows('_board')
      .slice(1)
      .filter((r) => r[1] === type)
      .map((r) => String(r[2]))
  }

  private setCell(tab: string, a1: string, v: Cell) {
    const m = a1.match(/^([A-Z]+)(\d+)$/)!
    const rows = (this.tabs[tab] ??= [])
    const r = +m[2] - 1
    while (rows.length <= r) rows.push([])
    rows[r][col(m[1])] = v
  }

  async install(page: Page) {
    await page.route('https://sheets.googleapis.com/**', (route) => this.handle(route))
  }

  private structure() {
    const header = this.tabs.Tasks?.[0] ?? []
    const width = header.length + 4 // a few empty columns to the right, like a real sheet
    return {
      sheets: [
        {
          properties: { sheetId: this.ids.get('Tasks'), title: 'Tasks', gridProperties: { columnCount: width } },
          conditionalFormats: this.conditionalFormats,
          data: [{ columnMetadata: Array.from({ length: width }, () => ({})), rowData: [{ values: header.map((h) => ({ formattedValue: String(h) })) }] }],
        },
      ],
    }
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = decodeURIComponent(req.url())
    const method = req.method()
    const body = req.postData() ? JSON.parse(req.postData()!) : null
    const reply = (json: object = {}, status = 200) => route.fulfill({ status, json })
    const noTab = (name: string) => reply({ error: { message: `Unable to parse range: ${name}` } }, 400)
    const tabOf = () => url.split('/values/')[1].split('!')[0].split('?')[0].replace(/'/g, '')

    if (method !== 'GET' && this.denyWrites) return reply({ error: { message: 'The caller does not have permission' } }, 403)

    if (url.includes('values:batchUpdate')) {
      for (const d of body.data) {
        const [tab, a1] = d.range.split('!')
        this.setCell(tab, a1, d.values[0][0])
      }
      return reply()
    }
    if (url.includes(':append')) {
      const tab = tabOf()
      if (!this.tabs[tab]) return noTab(tab)
      this.tabs[tab].push(body.values[0])
      return reply()
    }
    if (url.endsWith(':batchUpdate')) {
      this.batches.push(body.requests)
      for (const q of body.requests) {
        if (q.addSheet) {
          this.tabs[q.addSheet.properties.title] = []
          this.ids.set(q.addSheet.properties.title, this.ids.size + 1)
        }
        if (q.deleteDimension?.range.dimension === 'ROWS') {
          const g = q.deleteDimension.range
          const tab = [...this.ids].find(([, id]) => id === g.sheetId)![0]
          this.tabs[tab].splice(g.startIndex, 1)
        }
      }
      return reply()
    }
    if (method === 'PUT') {
      const [tab, range] = url.split('/values/')[1].split('?')[0].split('!')
      const start = range.split(':')[0].match(/^([A-Z]+)(\d+)$/)!
      body.values[0].forEach((v: Cell, i: number) => this.setCell(tab, `${String.fromCharCode(65 + col(start[1]) + i)}${start[2]}`, v))
      return reply()
    }

    if (url.includes('includeGridData')) return reply(url.includes('ranges=Tasks!1:1') ? this.structure() : this.grid)
    if (url.includes('fields=sheets.properties')) {
      return reply({ sheets: [...this.ids].map(([title, sheetId]) => ({ properties: { sheetId, title } })) })
    }
    if (url.includes('/values/')) {
      const tab = tabOf()
      if (this.lists[tab]) return reply({ values: this.lists[tab] })
      return this.tabs[tab] ? reply({ values: this.tabs[tab].map((r) => [...r]) }) : noTab(tab)
    }
    return reply({ properties: { title: this.title } })
  }
}
