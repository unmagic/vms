import { describe, it, expect } from 'vitest'
import { ref } from '@unmagic/vue-mini'

describe('minimal test', () => {
  it('should import ref', () => {
    const r = ref(0)
    expect(r.value).toBe(0)
  })
})
