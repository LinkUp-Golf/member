import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uploadMediaToGhl } from '@/lib/ghl/client'

const BYTES = new TextEncoder().encode('fake-jpeg-bytes').buffer
const ARGS = { bytes: BYTES, fileName: 'linkup-proof-aviara-2026-08-01-1a2b3c4d.jpg', contentType: 'image/jpeg' }

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadMediaToGhl', () => {
  it('posts multipart to the medias endpoint and returns GHL’s handle', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ fileId: 'file_123', url: 'https://storage.gohighlevel.com/file_123.jpg' }),
    })

    const result = await uploadMediaToGhl(ARGS)

    expect(result).toEqual({ fileId: 'file_123', url: 'https://storage.gohighlevel.com/file_123.jpg' })

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://services.leadconnectorhq.com/medias/upload-file')
    expect(init.method).toBe('POST')

    // The header must be absent, not set: fetch derives multipart/form-data
    // plus the boundary from the FormData, and naming it by hand produces a
    // body GHL can't parse. This is the easiest thing to break by "tidying up".
    const headerNames = Object.keys(init.headers).map(h => h.toLowerCase())
    expect(headerNames).not.toContain('content-type')
    expect(init.headers.Authorization).toBe('Bearer test-ghl-api-key')

    const form = init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('name')).toBe(ARGS.fileName)
    expect(form.get('hosted')).toBe('false')
    // Which media library — the SDK sends no query string for this call, so
    // these travel in the body.
    expect(form.get('altType')).toBe('location')
    expect(form.get('altId')).toBe('test-location-id')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('returns null on a rejected upload rather than throwing', async () => {
    // The caller has already stored the proof in Supabase and told the host it
    // worked; a GHL failure must not surface as an error from that request.
    fetchSpy.mockResolvedValue({ ok: false, status: 413, text: async () => 'file too large' })

    await expect(uploadMediaToGhl(ARGS)).resolves.toBeNull()
  })

  it('returns null when the request throws (timeout, connection)', async () => {
    fetchSpy.mockRejectedValue(new Error('The operation was aborted due to timeout'))

    await expect(uploadMediaToGhl(ARGS)).resolves.toBeNull()
  })

  it('returns null when the response is missing fileId or url', async () => {
    // A 200 with an unexpected shape would otherwise be written to the DB as
    // undefined and read later as "the mirror worked".
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })

    await expect(uploadMediaToGhl(ARGS)).resolves.toBeNull()
  })

  it('gives up before the caller does', async () => {
    // The host is waiting on this request; it must carry an abort signal so an
    // unresponsive GHL can't hold their upload open indefinitely.
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ fileId: 'f', url: 'u' }) })

    await uploadMediaToGhl(ARGS)

    const [, init] = fetchSpy.mock.calls[0]!
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
