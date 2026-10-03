import { describe, expect, it } from 'vitest'
import type { Stroke } from '../types'
import { decodeNoteDrawing, decodeStroke, encodeNoteDrawing, encodeStroke, hitsStroke, pathFor, simplify } from './ink'

const line = (n: number, jitter = 0): number[] =>
  Array.from({ length: n }, (_, i) => [i * 2, 100 + (jitter ? Math.sin(i * 7.3) * jitter : 0)]).flat()

describe('simplify', () => {
  it('keeps the end points and drops points on a straight line', () => {
    const out = simplify(line(50), 0.5)
    expect(out).toEqual([0, 100, 98, 100])
  })

  it('keeps a real corner', () => {
    const out = simplify([0, 0, 50, 0, 100, 0, 100, 50, 100, 100], 1)
    expect(out).toEqual([0, 0, 100, 0, 100, 100])
  })

  it('leaves one or two points alone', () => {
    expect(simplify([1, 2], 5)).toEqual([1, 2])
    expect(simplify([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4])
  })
})

describe('stroke encoding', () => {
  const stroke: Stroke = { id: 's', c: '#E5484D', w: 3.46, p: [10.04, 20.06, 30, 45.5, 61.234, 80] }

  it('round-trips within one decimal', () => {
    const back = decodeStroke('s', encodeStroke(stroke, 0))!
    expect(back.c).toBe('#E5484D')
    expect(back.w).toBeCloseTo(3.5, 5)
    back.p.forEach((v, i) => expect(v).toBeCloseTo(stroke.p[i], 0))
    expect(back.p).toHaveLength(stroke.p.length)
  })

  it('stores deltas after the first point', () => {
    const json = JSON.parse(encodeStroke({ id: 's', c: '#000000', w: 2, p: [10, 20, 15, 30] }, 0))
    expect(json.p).toEqual([10, 20, 5, 10])
  })

  it('squeezes a huge stroke into a Sheets cell, or refuses it', () => {
    const huge: Stroke = { id: 'h', c: '#000000', w: 2, p: line(6_000, 3) }
    const text = encodeStroke(huge, 0.1)
    expect(text.length).toBeLessThanOrEqual(45_000)
    expect(decodeStroke('h', text)).not.toBeNull()
  })

  it('rejects malformed cells', () => {
    expect(decodeStroke('x', 'not json')).toBeNull()
    expect(decodeStroke('x', '{"c":"red","w":2,"p":[0,0]}')).toBeNull() // color must be hex
    expect(decodeStroke('x', '{"c":"#000000","w":2,"p":[0]}')).toBeNull() // odd number of coordinates
    expect(decodeStroke('x', 42)).toBeNull()
  })
})

describe("a note's drawing", () => {
  it('encodes several strokes in one cell and decodes them with runtime ids', () => {
    const a: Stroke = { id: 'a', c: '#111111', w: 3, p: [0, 0, 10, 10] }
    const b: Stroke = { id: 'b', c: '#222222', w: 5, p: [5, 5, 50, 60] }
    const cell = encodeNoteDrawing([a, b], 0)
    const back = decodeNoteDrawing('task1', cell)
    expect(back.map((s) => s.id)).toEqual(['task1-0', 'task1-1'])
    expect(back[1].c).toBe('#222222')
  })

  it('writes an empty cell when there is no stroke', () => {
    expect(encodeNoteDrawing([], 0)).toBe('')
    expect(decodeNoteDrawing('t', '')).toEqual([])
  })

  it('simplifies harder to make a busy drawing fit', () => {
    const busy = Array.from({ length: 8 }, (_, i): Stroke => ({ id: String(i), c: '#000000', w: 2, p: line(2_500, 6) }))
    expect(encodeNoteDrawing(busy, 0.5).length).toBeLessThanOrEqual(45_000)
  })

  it('says so when even the simplest strokes no longer fit', () => {
    const tiny = (i: number): Stroke => ({ id: String(i), c: '#000000', w: 2, p: [0, 0, 10, 10] })
    expect(() => encodeNoteDrawing(Array.from({ length: 1_600 }, (_, i) => tiny(i)), 0.5)).toThrow(/full/)
  })

  it('ignores garbage', () => {
    expect(decodeNoteDrawing('t', '{oops')).toEqual([])
    expect(decodeNoteDrawing('t', '{"c":"#000000"}')).toEqual([]) // an object, not an array
  })
})

describe('hit testing and paths', () => {
  const s: Stroke = { id: 's', c: '#000000', w: 4, p: [0, 0, 100, 0] }

  it('hits near the line, counting half its width', () => {
    expect(hitsStroke(s, 50, 5, 3)).toBe(true) // 5 <= 3 + 2
    expect(hitsStroke(s, 50, 6, 3)).toBe(false)
    expect(hitsStroke(s, 120, 0, 3)).toBe(false)
  })

  it('treats a single point as a dot', () => {
    const dot: Stroke = { id: 'd', c: '#000000', w: 4, p: [10, 10] }
    expect(hitsStroke(dot, 12, 10, 1)).toBe(true)
    expect(hitsStroke(dot, 20, 10, 1)).toBe(false)
    expect(pathFor(dot.p)).toMatch(/^M10 10h/)
  })

  it('builds a smoothed path', () => {
    expect(pathFor([0, 0, 10, 10, 20, 0])).toBe('M0 0Q10 10 15 5L20 0')
    expect(pathFor([])).toBe('')
  })
})
