import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { ancestorsOf, descendantsOf, goneIds, isolatedSet, stackSet } from './visibility'
import { closedCount, isClosed } from './closed'

const t = (id: string, status = '', who = ''): Task => ({ id, title: id, status: status || undefined, values: who ? { qui: who } : {}, board: { x: 0, y: 0, color: '#fff' } })
// a -> b -> c ; a -> d ; e alone
const parents = { b: 'a', c: 'b', d: 'a' }
const tasks = [t('a'), t('b'), t('c'), t('d'), t('e')]

describe('closed', () => {
  it('is the status "Closed", in any case', () => {
    expect(isClosed(t('x', 'Closed'))).toBe(true)
    expect(isClosed(t('x', ' closed '))).toBe(true)
    expect(isClosed(t('x', 'Done'))).toBe(false)
    expect(isClosed(t('x'))).toBe(false)
  })
  it('counts the closed ones among some ids', () => {
    const list = [t('a'), t('b', 'Closed'), t('c', 'closed')]
    expect(closedCount(['a', 'b', 'c', 'zz'], new Map(list.map((x) => [x.id, x])))).toBe(2)
  })
})

describe('isolation', () => {
  it('walks the tree down and up', () => {
    expect([...descendantsOf(parents, new Set(['a']))].sort()).toEqual(['b', 'c', 'd'])
    expect([...descendantsOf(parents, new Set(['b']))]).toEqual(['c'])
    expect([...ancestorsOf(parents, new Set(['c']))].sort()).toEqual(['a', 'b'])
  })
  it('isolating tasks keeps them and their sub-tasks at every level', () => {
    const s = isolatedSet(tasks, parents, { kind: 'tasks', ids: ['b', 'e', 'gone'] }, () => false, false)!
    expect([...s].sort()).toEqual(['b', 'c', 'e'])
    expect([...goneIds(tasks, false, s)].sort()).toEqual(['a', 'd'])
  })
  it('"my tasks" also keeps the parents of mine, and leaves closed ones out', () => {
    const list = [t('a'), t('b'), t('c', '', 'Mathieu'), t('d', 'Closed', 'Mathieu'), t('e', '', 'Paul')]
    const mine = (x: Task) => x.values?.qui === 'Mathieu'
    const s = isolatedSet(list, parents, { kind: 'mine' }, mine, false)!
    expect([...s].sort()).toEqual(['a', 'b', 'c']) // c, and its parents b and a; d is closed
    expect([...isolatedSet(list, parents, { kind: 'mine' }, mine, true)!].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
  it('an opened stack shows its note, its sub-tasks at every level and the parent above', () => {
    const s = stackSet(tasks, parents, ['a'])!
    expect([...s].sort()).toEqual(['a', 'b', 'c', 'd'])
    const deeper = stackSet(tasks, parents, ['a', 'b'])!
    expect([...deeper].sort()).toEqual(['a', 'b', 'c']) // b, its sub-task c, and a above
    const deepest = stackSet(tasks, parents, ['a', 'b', 'c'])!
    expect([...deepest].sort()).toEqual(['b', 'c']) // c and its parent b
    expect(stackSet(tasks, parents, ['gone'])!.size).toBe(0)
    expect(stackSet(tasks, parents, [])).toBeNull()
  })
  it('isolations are successive: a task must pass every one that is on', () => {
    const list = [t('a'), t('b'), t('c'), t('d'), t('e')]
    const mine = new Set(['a', 'b', 'c', 'e']) // say "my tasks" kept these
    const stack = stackSet(list, parents, ['a'])! // a, b, c, d
    expect([...goneIds(list, false, mine, stack)].sort()).toEqual(['d', 'e'])
    expect([...goneIds(list, false, mine, null)].sort()).toEqual(['d'])
    expect([...goneIds(list, false, null, stack)].sort()).toEqual(['e'])
  })
  it('no isolation: nothing is left out, except closed tasks', () => {
    const list = [t('a'), t('b', 'Closed')]
    expect([...goneIds(list, false, null)]).toEqual(['b'])
    expect([...goneIds(list, true, null)]).toEqual([])
  })
})
