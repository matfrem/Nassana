import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { childrenOf, cleanParents, descendantCount, tucked, wouldCycle } from './stacks'

const t = (id: string): Task => ({ id, title: id, board: { x: 0, y: 0, color: '#fff' } })
const tasks = ['a', 'b', 'c', 'd', 'e'].map(t)
// a -> b -> c, a -> d ; e alone
const parents = { b: 'a', c: 'b', d: 'a' }

describe('stacks', () => {
  it('detects loops', () => {
    expect(wouldCycle(parents, 'a', 'c')).toBe(true)
    expect(wouldCycle(parents, 'a', 'a')).toBe(true)
    expect(wouldCycle(parents, 'e', 'c')).toBe(false)
  })
  it('counts descendants at any depth', () => {
    expect(descendantCount(childrenOf(parents), 'a')).toBe(3)
    expect(descendantCount(childrenOf(parents), 'b')).toBe(1)
    expect(descendantCount(childrenOf(parents), 'e')).toBe(0)
  })
  it('hides everything below a closed note, under the one closest to the root', () => {
    const m = tucked(tasks, parents, new Set())
    expect([...m.keys()].sort()).toEqual(['b', 'c', 'd'])
    expect(m.get('c')).toBe('a')
  })
  it('an open note shows its children, but a closed one inside still hides its own', () => {
    const m = tucked(tasks, parents, new Set(['a']))
    expect([...m.entries()]).toEqual([['c', 'b']])
    expect(tucked(tasks, parents, new Set(['a', 'b'])).size).toBe(0)
  })
  it('a closed note inside a closed one hides under the outer', () => {
    expect(tucked(tasks, parents, new Set(['b'])).get('c')).toBe('a')
  })
  it('cleans dangling and looping parents', () => {
    const out = cleanParents({ b: 'a', a: 'b', x: 'a', c: 'zzz' }, new Set(['a', 'b', 'c']))
    expect(out).toEqual({ b: 'a' })
  })
})
