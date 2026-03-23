import { describe, it, expect } from 'vitest'

// Extract the pure auth logic for isolated testing
function isAuthorized(key: string | null, expected: string): boolean {
  if (!key || !expected) return false
  if (key.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < key.length; i++) {
    diff |= key.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

describe('isAuthorized', () => {
  it('returns true for matching keys', () => {
    expect(isAuthorized('secret-key-123', 'secret-key-123')).toBe(true)
  })

  it('returns false for wrong key', () => {
    expect(isAuthorized('wrong-key-123!', 'secret-key-123')).toBe(false)
  })

  it('returns false for null key', () => {
    expect(isAuthorized(null, 'secret-key-123')).toBe(false)
  })

  it('returns false for empty expected (misconfigured server)', () => {
    expect(isAuthorized('some-key', '')).toBe(false)
  })

  it('returns false for different length keys (prevents timing attack shortcut)', () => {
    expect(isAuthorized('short', 'secret-key-123')).toBe(false)
  })

  it('returns false for empty key', () => {
    expect(isAuthorized('', 'secret-key-123')).toBe(false)
  })
})
