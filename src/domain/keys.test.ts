import { describe, expect, it } from 'vitest'
import { resolveNumber } from './keys'

const c = (...nums: string[]) => nums.map((n) => ({ id: `p${n}`, number: n }))

describe('resolveNumber', () => {
  it('commits unique numbers immediately', () => {
    expect(resolveNumber('3', c('3', '12'))).toEqual({ status: 'match', id: 'p3' })
    expect(resolveNumber('12', c('3', '12'))).toEqual({ status: 'match', id: 'p12' })
  })
  it('waits when a longer number shares the prefix', () => {
    expect(resolveNumber('1', c('1', '12'))).toEqual({ status: 'wait', exact: 'p1' })
    expect(resolveNumber('1', c('12', '15'))).toEqual({ status: 'wait', exact: null })
  })
  it('reports no match', () => {
    expect(resolveNumber('9', c('1', '12'))).toEqual({ status: 'none' })
    expect(resolveNumber('99', c('9'))).toEqual({ status: 'none' })
    expect(resolveNumber('', c('1'))).toEqual({ status: 'none' })
  })
  it('handles 0 and 00 as different numbers', () => {
    expect(resolveNumber('0', c('0', '00'))).toEqual({ status: 'wait', exact: 'p0' })
    expect(resolveNumber('00', c('0', '00'))).toEqual({ status: 'match', id: 'p00' })
  })
})
