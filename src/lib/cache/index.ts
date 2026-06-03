// ============================================================
// Cache abstraction layer.
//
// Default: in-memory TTL cache (works for single-instance &
// warm serverless functions).
// Production multi-instance: set UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN to enable Redis automatically.
//
// Cache keys follow the pattern: {namespace}:{identifier}
// e.g.  "ghl:auth:user-uuid-here"
//       "course:ann:course-uuid:50"
// ============================================================

// ---- Interface ----------------------------------------------

export interface ICache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
  delete(key: string): Promise<void>
  /** Delete all keys that start with prefix. Used for bulk invalidation. */
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

// ---- Upstash Redis HTTP implementation ----------------------
// Uses Upstash's REST API (no SDK, no extra dependency).
// Activated when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// are both set. Works on Edge and Node runtimes.

class RedisCache implements ICache {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  private async exec(command: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    })
    if (!res.ok) {
      throw new Error(`Upstash Redis error ${res.status}: ${await res.text().catch(() => '')}`)
    }
    const json = (await res.json()) as { result: unknown }
    return json.result
  }

  async get<T>(key: string): Promise<T | null> {
    const result = await this.exec(['GET', key])
    if (result === null || result === undefined) return null
    try {
      return JSON.parse(result as string) as T
    } catch {
      return result as T
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000))
    await this.exec(['SETEX', key, ttlSeconds, JSON.stringify(value)])
  }

  async delete(key: string): Promise<void> {
    await this.exec(['DEL', key])
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) return // full-flush not supported on shared Redis
    // SCAN is O(N) but non-blocking — safe for admin-triggered invalidation.
    let cursor = '0'
    const toDelete: string[] = []
    do {
      const result = await this.exec(['SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', '100']) as [string, string[]]
      cursor = result[0]
      toDelete.push(...result[1])
    } while (cursor !== '0')

    if (toDelete.length > 0) {
      await this.exec(['DEL', ...toDelete])
    }
  }
}

// ---- Factory ------------------------------------------------
// Returns Redis when env vars are present, Memory otherwise.
// Cached by namespace so each namespace gets its own instance
// (allows independent clear() without cross-contamination).

function createCache(): (namespace: string) => ICache {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    // Single shared Redis connection; namespaces are encoded in keys.
    const redis = new RedisCache(url, token)
    // Wrap in a lightweight proxy so the namespace API is preserved.
    const nsMap = new Map<string, ICache>()
    return (namespace: string): ICache => {
      if (!nsMap.has(namespace)) nsMap.set(namespace, redis)
      return redis
    }
  }

  // In-memory: one MemoryCache per namespace.
  const memMap = new Map<string, MemoryCache>()
  return (namespace: string): ICache => {
    if (!memMap.has(namespace)) memMap.set(namespace, new MemoryCache())
    return memMap.get(namespace)!
  }
}

const _getCache = createCache()

export function getCache(namespace: string): ICache {
  return _getCache(namespace)
}

// ---- withCache helper ---------------------------------------
// Wraps a fetcher with cache get/set. Cache failures are
// non-fatal — the fetcher always runs as fallback.

export async function withCache<T>(
  cache: ICache,
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  try {
    const cached = await cache.get<T>(key)
    if (cached !== null) return cached
  } catch {
    // Cache read error → fall through to fetcher
  }

  const data = await fetcher()

  try {
    await cache.set(key, data, ttlMs)
  } catch {
    // Cache write failure is non-fatal
  }

  return data
}

// ---- Typed GHL authorization cache key ----------------------
export const GHL_AUTH_CACHE_NS  = 'ghl:auth'
export const GHL_AUTH_TTL_MS    = 15 * 60_000   // 15 minutes
export const GHL_AUTH_CACHE_KEY = (userId: string) => `${GHL_AUTH_CACHE_NS}:${userId}`
