// ============================================================
// Cache abstraction layer.
// Default: in-memory TTL cache (works for single-instance &
// warm serverless functions).
// Production multi-instance: set REDIS_URL to enable Redis.
//
// Cache keys follow the pattern: {namespace}:{identifier}
// e.g.  "ghl:auth:user-uuid-here"
// ============================================================

// ---- Interface ----------------------------------------------

export interface ICache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  clear(prefix?: string): Promise<void>
}

// ---- In-memory implementation -------------------------------

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class MemoryCache implements ICache {
  private store = new Map<string, CacheEntry<unknown>>()
  private readonly maxSize: number

  constructor(maxSize = 2000) {
    this.maxSize = maxSize
    // Sweep expired entries every 2 minutes
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.sweep(), 2 * 60_000).unref?.()
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (this.store.size >= this.maxSize) this.evictOldest()
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.store.clear()
      return
    }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) this.store.delete(key)
    }
  }

  private evictOldest(): void {
    // Evict the entry with the earliest expiry
    let oldest: string | null = null
    let oldestExpiry = Infinity
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt
        oldest = key
      }
    }
    if (oldest) this.store.delete(oldest)
  }

  get size(): number { return this.store.size }
}

// ---- Singleton cache instances by namespace -----------------
// Each namespace gets its own instance to allow independent
// size limits and clear() without cross-contamination.

const caches = new Map<string, MemoryCache>()

export function getCache(namespace: string): ICache {
  if (!caches.has(namespace)) {
    caches.set(namespace, new MemoryCache())
  }
  return caches.get(namespace)!
}

// ---- Typed GHL authorization cache key ----------------------
export const GHL_AUTH_CACHE_NS  = 'ghl:auth'
export const GHL_AUTH_TTL_MS    = 15 * 60_000   // 15 minutes
export const GHL_AUTH_CACHE_KEY = (userId: string) => `${GHL_AUTH_CACHE_NS}:${userId}`
