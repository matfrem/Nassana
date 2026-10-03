import { describe, expect, it } from 'vitest'
import { NOTE_SIZE } from '../constants'
import type { Task, Zone } from '../types'
import { applyZones, decodeZone, encodeZone, notesInZone, zoneAt, zoneOfNote } from './zones'

const zone = (id: string, name: string, x: number, y = 0, w = 440, h = 400): Zone => ({ id, name, x, y, w, h, color: '#60A5FA' })
const task = (id: string, x: number, y: number, status?: string, autoPlaced = false): Task => ({
  id,
  title: id,
  status,
  autoPlaced,
  board: { x, y, color: '#FFE066' },
})
const centerIn = (z: Zone, t: Task) => {
  const cx = t.board.x + NOTE_SIZE / 2
  const cy = t.board.y + NOTE_SIZE / 2
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h
}

const todo = zone('z1', 'To Do', 0)
const doing = zone('z2', 'Doing', 500)
const done = zone('z3', 'Done', 1000)

describe('zoneAt', () => {
  it('finds the zone under a point', () => {
    expect(zoneAt([todo, doing], 100, 100)?.id).toBe('z1')
    expect(zoneAt([todo, doing], 600, 100)?.id).toBe('z2')
    expect(zoneAt([todo, doing], 480, 100)).toBeUndefined()
  })

  it('prefers the zone drawn last when they overlap', () => {
    const over = zone('top', 'Top', 50, 50, 100, 100)
    expect(zoneAt([todo, over], 80, 80)?.id).toBe('top')
  })

  it('a note belongs to the zone holding its centre', () => {
    expect(zoneOfNote([todo], task('a', 10, 10))?.id).toBe('z1')
    expect(zoneOfNote([todo], task('b', 400, 10))).toBeUndefined() // centre at 490: outside
    expect(notesInZone([todo, doing], doing, [task('a', 10, 10), task('b', 520, 20)]).map((t) => t.id)).toEqual(['b'])
  })
})

describe('applyZones (the Sheet wins)', () => {
  const zones = [todo, doing, done]

  it('does nothing without zones', () => {
    const tasks = [task('a', 0, 0, 'Done')]
    expect(applyZones(tasks, [])).toBe(tasks)
  })

  it('puts a note without a saved position into the zone named like its status', () => {
    const [a] = applyZones([task('a', 0, 900, 'doing', true)], zones) // names are compared without case
    expect(centerIn(doing, a)).toBe(true)
    expect(a.autoPlaced).toBe(true) // so the next edit saves its new place
  })

  it('moves a note sitting in a zone whose status names another zone', () => {
    const [a] = applyZones([task('a', 20, 20, 'Done')], zones)
    expect(centerIn(done, a)).toBe(true)
  })

  it('leaves alone: a note outside every zone, a note already in the right zone, an unknown or empty status', () => {
    const tasks = [task('free', 0, 900, 'Done'), task('ok', 20, 20, 'To Do'), task('odd', 20, 220, 'Blocked'), task('none', 520, 20)]
    const out = applyZones(tasks, zones)
    expect(out.map((t) => [t.board.x, t.board.y])).toEqual(tasks.map((t) => [t.board.x, t.board.y]))
  })

  it('lays several arriving notes out without overlap', () => {
    const arriving = ['a', 'b', 'c', 'd'].map((id) => task(id, 0, 900, 'Done', true)) // a 440 x 400 zone holds four
    const out = applyZones(arriving, zones)
    for (let i = 0; i < out.length; i++) {
      expect(centerIn(done, out[i])).toBe(true)
      for (let j = i + 1; j < out.length; j++) {
        const clash = Math.abs(out[i].board.x - out[j].board.x) < NOTE_SIZE && Math.abs(out[i].board.y - out[j].board.y) < NOTE_SIZE
        expect(clash).toBe(false)
      }
    }
  })

  it('does not land on notes that stay where they are', () => {
    const resident = task('res', 1016, 64, 'Done') // exactly the first free slot of the zone
    const [, arrived] = applyZones([resident, task('new', 0, 900, 'Done', true)], zones)
    const clash = Math.abs(arrived.board.x - resident.board.x) < NOTE_SIZE && Math.abs(arrived.board.y - resident.board.y) < NOTE_SIZE
    expect(clash).toBe(false)
  })
})

describe('zone encoding', () => {
  it('round-trips, including the work-in-progress limit', () => {
    const z = { ...doing, limit: 3 }
    expect(decodeZone('z2', encodeZone(z))).toEqual(z)
  })

  it('falls back on bad colors and drops bad limits', () => {
    const z = decodeZone('z', '{"x":0,"y":0,"w":10,"h":10,"name":"A","color":"red","limit":-2}')!
    expect(z.color).toBe('#94A3B8')
    expect(z.limit).toBeUndefined()
  })

  it('rejects zones without a size', () => {
    expect(decodeZone('z', '{"x":0,"y":0,"w":0,"h":10}')).toBeNull()
    expect(decodeZone('z', 'nope')).toBeNull()
  })
})
