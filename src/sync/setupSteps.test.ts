import { describe, expect, it } from 'vitest'
import readme from '../../README.md?raw'
import { REDEPLOY_STEPS, SETUP_STEPS } from './setupSteps'

describe('setup steps', () => {
  it('README has the same numbered steps as the Settings page', () => {
    SETUP_STEPS.forEach((s, i) => expect(readme).toContain(`${i + 1}. ${s}`))
    REDEPLOY_STEPS.forEach((s, i) => expect(readme).toContain(`${i + 1}. ${s}`))
  })
  it('never contains anything that looks like a real token', () => {
    expect(readme).not.toMatch(/[0-9a-f]{64}/)
    expect(SETUP_STEPS.join(' ')).not.toMatch(/[0-9a-f]{32}/)
  })
})
