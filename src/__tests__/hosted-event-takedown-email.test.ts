import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as Constants from '@/lib/constants'

// The path constant is empty until the GHL workflow is built. Each test picks
// which side of that it's exercising, so the module is re-imported per case.
async function loadClient(webhookPath: string) {
  vi.resetModules()
  vi.doMock('@/lib/constants', async () => ({
    ...(await vi.importActual<typeof Constants>('@/lib/constants')),
    GHL_HOSTED_EVENT_TAKEDOWN_WEBHOOK_PATH: webhookPath,
  }))
  return import('@/lib/ghl/client')
}

const PAYLOAD = {
  firstName: 'Wren',
  email: 'wren@example.com',
  courseName: 'Aviara Golf Club',
  eventDate: '2026-09-12',
  reason: 'Rate was listed wrong.',
  releasedCount: 2,
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@/lib/constants')
  vi.resetModules()
})

describe('triggerHostedEventTakedownWebhook', () => {
  it('makes no request while the GHL workflow does not exist', async () => {
    // The whole point of the placeholder: an unset path must not POST to a URL
    // that is just GHL_BASE_URL, which would 404 on every takedown.
    const { triggerHostedEventTakedownWebhook } = await loadClient('')

    const sent = await triggerHostedEventTakedownWebhook(PAYLOAD)

    expect(sent).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts the payload once a path is configured', async () => {
    fetchSpy.mockResolvedValue({ ok: true })
    const { triggerHostedEventTakedownWebhook } = await loadClient('/hooks/loc/webhook-trigger/abc-123')

    const sent = await triggerHostedEventTakedownWebhook(PAYLOAD)

    expect(sent).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://services.leadconnectorhq.com/hooks/loc/webhook-trigger/abc-123')
    expect(init.method).toBe('POST')
    // Every field the GHL workflow composes the email from.
    expect(JSON.parse(init.body)).toEqual(PAYLOAD)
  })

  it('reports failure without throwing when GHL rejects it', async () => {
    // The caller fires this after the takedown has already been written, so a
    // throw here would turn a completed action into a failed request.
    fetchSpy.mockResolvedValue({ ok: false, status: 500 })
    const { triggerHostedEventTakedownWebhook } = await loadClient('/hooks/loc/webhook-trigger/abc-123')

    await expect(triggerHostedEventTakedownWebhook(PAYLOAD)).resolves.toBe(false)
  })

  it('reports failure without throwing when the request itself blows up', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'))
    const { triggerHostedEventTakedownWebhook } = await loadClient('/hooks/loc/webhook-trigger/abc-123')

    await expect(triggerHostedEventTakedownWebhook(PAYLOAD)).resolves.toBe(false)
  })
})
