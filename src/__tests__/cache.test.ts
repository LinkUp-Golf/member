import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryCache, GHL_AUTH_CACHE_KEY, GHL_AUTH_TTL_MS } from '@/lib/cache'

describe('MemoryCache', () => {
  let cache: MemoryCache

  beforeEach(() => {
    cache = new MemoryCache(100)
  })

  it('returns null for missing key', async () => {
    expect(await cache.get('nonexistent')).toBeNull()
  })

  it('stores and retrieves a value', async () => {
    await cache.set('key', { authorized: true }, 60_000)
    expect(await cache.get('key')).toEqual({ authorized: true })
  })

  it('returns null for expired entries', async () => {
    await cache.set('key', 'value', 1) // 1ms TTL
    await new Promise(r => setTimeout(r, 10))
    expect(await cache.get('key')).toBeNull()
  })

  it('deletes a specific key', async () => {
    await cache.set('key', 'value', 60_000)
    await cache.delete('key')
    expect(await cache.get('key')).toBeNull()
  })

  it('clears all keys', async () => {
    await cache.set('a', 1, 60_000)
    await cache.set('b', 2, 60_000)
    await cache.clear()
    expect(await cache.get('a')).toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  it('clears only keys matching prefix', async () => {
    await cache.set('ns:key1', 1, 60_000)
    await cache.set('ns:key2', 2, 60_000)
    await cache.set('other:key', 3, 60_000)
    await cache.clear('ns:')
    expect(await cache.get('ns:key1')).toBeNull()
    expect(await cache.get('ns:key2')).toBeNull()
    expect(await cache.get('other:key')).toBe(3)
  })

  it('evicts oldest entry when at max capacity', async () => {
    const small = new MemoryCache(2)
    await small.set('first', 1, 60_000)
    await small.set('second', 2, 60_000)
    await small.set('third', 3, 60_000)  // triggers eviction
    // At least one of the first two should be gone
    const first = await small.get('first')
    const second = await small.get('second')
    const hasEvicted = first === null || second === null
    expect(hasEvicted).toBe(true)
    expect(await small.get('third')).toBe(3)
  })

  it('overwrites existing entry', async () => {
    await cache.set('key', 'original', 60_000)
    await cache.set('key', 'updated', 60_000)
    expect(await cache.get('key')).toBe('updated')
  })
})

describe('Cache key helpers', () => {
  it('generates stable GHL auth cache keys', () => {
    const uid = 'user-123'
    expect(GHL_AUTH_CACHE_KEY(uid)).toBe('ghl:auth:user-123')
  })

  it('TTL constant is 15 minutes', () => {
    expect(GHL_AUTH_TTL_MS).toBe(15 * 60_000)
  })
})
