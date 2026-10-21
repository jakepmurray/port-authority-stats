import { describe, expect, it } from 'vitest'
import readme from '../../README.md?raw'
import { UA_CSV_STEPS, UA_LINK_STEPS } from './ultiSteps'

describe('UltiAnalytics steps', () => {
  it('README has the same numbered steps as the Data page', () => {
    UA_CSV_STEPS.forEach((s, i) => expect(readme).toContain(`${i + 1}. ${s}`))
    UA_LINK_STEPS.forEach((s, i) => expect(readme).toContain(`${i + 1}. ${s}`))
  })
})
