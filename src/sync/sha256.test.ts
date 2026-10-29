import { describe, expect, it } from 'vitest'
import { hex, sha256 } from './sha256'

describe('sha256 (mock digest)', () => {
  it('matches known vectors', () => {
    expect(hex(sha256(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hex(sha256('a'.repeat(100)))).toBe('2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e')
  })
})
