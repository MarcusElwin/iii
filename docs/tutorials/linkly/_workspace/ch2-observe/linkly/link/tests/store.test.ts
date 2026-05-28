import { describe, expect, it } from 'vitest'
import { LinkStore } from '../src/store.js'

describe('LinkStore', () => {
  it('creates a link with a generated code and resolves it', () => {
    const store = new LinkStore()
    const link = store.create('https://example.com')

    expect(link.url).toBe('https://example.com')
    expect(link.code).toMatch(/^[0-9a-z]{6}$/)
    expect(store.resolve(link.code)).toBe('https://example.com')
  })

  it('honors a custom code', () => {
    const store = new LinkStore()
    const link = store.create('https://iii.dev', 'iii')

    expect(link.code).toBe('iii')
    expect(store.resolve('iii')).toBe('https://iii.dev')
  })

  it('returns undefined for an unknown code', () => {
    const store = new LinkStore()
    expect(store.resolve('nope')).toBeUndefined()
  })

  it('overwrites the target when the same code is reused', () => {
    const store = new LinkStore()
    store.create('https://one.example', 'dup')
    store.create('https://two.example', 'dup')

    expect(store.resolve('dup')).toBe('https://two.example')
  })
})
