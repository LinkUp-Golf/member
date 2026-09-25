import { describe, it, expect, afterEach } from 'vitest'
import { kept } from '@/lib/notify'

// A notification is fired without being awaited so it can't delay the booking
// that produced it. On a serverless platform that means it races the response,
// and loses. kept() is the only thing standing between "fire and forget" and
// "fire and never happen", so its contract is worth pinning.

const SYMBOL = Symbol.for('@vercel/request-context')

const withRequestContext = (waitUntil: unknown) => {
  ;(globalThis as Record<symbol, unknown>)[SYMBOL] = { get: () => ({ waitUntil }) }
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[SYMBOL]
})

describe('kept', () => {
  it('returns the same promise, so a caller can still read the result', async () => {
    const work = Promise.resolve({ sent: 1 })
    expect(kept(work)).toBe(work)
    await expect(kept(work)).resolves.toEqual({ sent: 1 })
  })

  it('hands the work to waitUntil when the platform offers one', async () => {
    const seen: unknown[] = []
    withRequestContext((p: unknown) => seen.push(p))

    const work = Promise.resolve('done')
    expect(await kept(work)).toBe('done')
    expect(seen).toHaveLength(1)
  })

  it('does nothing at all off-platform', async () => {
    // No request context: a long-lived server finishes the work by itself, and
    // kept() must not change behaviour or throw looking for something absent.
    const work = Promise.resolve('done')
    expect(await kept(work)).toBe('done')
  })

  it('survives a request context that is broken or shaped differently', async () => {
    withRequestContext('not a function')
    await expect(kept(Promise.resolve('ok'))).resolves.toBe('ok')

    ;(globalThis as Record<symbol, unknown>)[SYMBOL] = {
      get: () => {
        throw new Error('boom')
      },
    }
    await expect(kept(Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('never hands waitUntil a rejection', async () => {
    // waitUntil counts a rejected promise as a failed invocation. The work
    // itself already swallows its errors, but a guard here is cheaper than a
    // platform-level error on a notification nobody was waiting for.
    const registered: Promise<unknown>[] = []
    withRequestContext((p: Promise<unknown>) => registered.push(p))

    const failing = Promise.reject(new Error('mail server down'))
    const returned = kept(failing)

    await expect(returned).rejects.toThrow('mail server down')
    await expect(registered[0]).resolves.toBeUndefined()
  })
})
