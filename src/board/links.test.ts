import { describe, expect, it } from 'vitest'
import { NOTE_SIZE } from '../constants'
import type { Task } from '../types'
import { arrowHead, decodeLink, distToSeg, encodeLink, segmentBetween, segmentToPoint } from './links'

const note = (x: number, y: number): Task => ({ id: `${x},${y}`, title: 'n', board: { x, y, color: '#FFE066' } })

describe('link encoding', () => {
  it('round-trips the three arrow modes', () => {
    for (const arrow of ['one', 'both', 'none'] as const) {
      expect(decodeLink('l', encodeLink({ id: 'l', from: 'a', to: 'b', arrow }))).toEqual({ id: 'l', from: 'a', to: 'b', arrow })
    }
  })

  it('still reads rows written when the arrow was a boolean', () => {
    expect(decodeLink('l', '{"from":"a","to":"b","arrow":true}')?.arrow).toBe('one')
    expect(decodeLink('l', '{"from":"a","to":"b","arrow":false}')?.arrow).toBe('none')
    expect(decodeLink('l', '{"from":"a","to":"b"}')?.arrow).toBe('one')
  })

  it('rejects broken links', () => {
    expect(decodeLink('l', '{"from":"a","to":"a"}')).toBeNull() // a note cannot link to itself
    expect(decodeLink('l', '{"from":"a"}')).toBeNull()
    expect(decodeLink('l', 'x')).toBeNull()
  })
})

describe('link geometry', () => {
  it('joins the borders of two notes side by side, with a little air', () => {
    const s = segmentBetween(note(0, 0), note(400, 0))!
    expect(s.x1).toBeGreaterThan(NOTE_SIZE) // leaves the first note on its right border (+ a gap)
    expect(s.x2).toBeLessThan(400) // and stops before the second one's left border
    expect(s.y1).toBeCloseTo(NOTE_SIZE / 2)
    expect(s.y2).toBeCloseTo(NOTE_SIZE / 2)
  })

  it('works vertically and diagonally', () => {
    const v = segmentBetween(note(0, 0), note(0, 400))!
    expect(v.y1).toBeGreaterThan(NOTE_SIZE)
    expect(v.y2).toBeLessThan(400)
    const d = segmentBetween(note(0, 0), note(400, 400))!
    expect(d.x2).toBeGreaterThan(d.x1)
    expect(d.y2).toBeGreaterThan(d.y1)
  })

  it('draws nothing between notes that overlap', () => {
    expect(segmentBetween(note(0, 0), note(100, 50))).toBeNull()
  })

  it('previews a link toward a free point, but not while the pointer is still on the source', () => {
    expect(segmentToPoint(note(0, 0), 500, 90)).not.toBeNull()
    expect(segmentToPoint(note(0, 0), 90, 90)).toBeNull()
  })

  it('measures the distance to a segment and builds an arrowhead at its end', () => {
    const s = { x1: 0, y1: 0, x2: 100, y2: 0 }
    expect(distToSeg(s, 50, 7)).toBeCloseTo(7)
    expect(distToSeg(s, 130, 0)).toBeCloseTo(30)
    expect(arrowHead(s, 16).startsWith('100,0 ')).toBe(true)
  })
})
