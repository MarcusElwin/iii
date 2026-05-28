import { describe, expect, it } from 'vitest'
import { makeCode } from '../src/codes.js'

describe('makeCode', () => {
  it('generates a short alphanumeric code', () => {
    expect(makeCode()).toMatch(/^[0-9a-z]{6}$/)
  })

  it('generates distinct codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => makeCode()))
    expect(codes.size).toBeGreaterThan(90)
  })
})
