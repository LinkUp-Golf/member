import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryCache } from '@/lib/cache'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'

// ---- Module mocks ------------------------------------------
// Mock the GHL client so no real HTTP calls are made
vi.mock('@/lib/ghl/client', () => ({
  getContactById: vi.fn(),
}))

// Replace the cache singleton for isolation
vi.mock('@/lib/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cache')>()
  const testCache = new actual.MemoryCache()
  return {
    ...actual,
    getCache: vi.fn(() => testCache),
  }
})

import { getContactById } from '@/lib/ghl/client'
import { validateGHLMembership, invalidateMembershipCache } from '@/lib/auth/ghl-validator'
import { getCache } from '@/lib/cache'

const mockGetContactById = vi.mocked(getContactById)

const VALID_CONTACT = {
  id: 'ghl-contact-001',
  email: 'member@example.com',
  firstName: 'Test',
  lastName: 'Member',
  phone: '',
  tags: ['avi-active', 'other-tag'],
  customFields: [],
}

const PARAMS = {
  userId: 'user-uuid-001',
  ghlContactId: 'ghl-contact-001',
  requestId: 'req-001',
}

beforeEach(async () => {
  vi.clearAllMocks()
  // Clear the test cache before each test
  const cache = getCache('ghl:auth')
  await cache.clear()
})

describe('validateGHLMembership — authorized path', () => {
  it('authorizes a member with the required tag', async () => {
    mockGetContactById.mockResolvedValue(VALID_CONTACT)
    const result = await validateGHLMembership(PARAMS)
    expect(result.authorized).toBe(true)
    expect(result.fromCache).toBe(false)
    expect(result.tags).toContain('avi-active')
  })

  it('caches a positive result (second call does not hit GHL)', async () => {
    mockGetContactById.mockResolvedValue(VALID_CONTACT)
    await validateGHLMembership(PARAMS)
    const second = await validateGHLMembership(PARAMS)
    expect(second.fromCache).toBe(true)
    expect(mockGetContactById).toHaveBeenCalledTimes(1)
  })
})

describe('validateGHLMembership — denied path', () => {
  it('denies a member without required tag', async () => {
    mockGetContactById.mockResolvedValue({ ...VALID_CONTACT, tags: ['some-other-tag'] })
    const result = await validateGHLMembership(PARAMS)
    expect(result.authorized).toBe(false)
    expect(result.fromCache).toBe(false)
  })

  it('does NOT cache a negative result (allows quick reinstatement)', async () => {
    mockGetContactById.mockResolvedValue({ ...VALID_CONTACT, tags: [] })
    await validateGHLMembership(PARAMS)

    // Simulate tag being reinstated
    mockGetContactById.mockResolvedValue(VALID_CONTACT)
    const second = await validateGHLMembership(PARAMS)

    // Should not be from cache — negative results aren't cached
    expect(second.fromCache).toBe(false)
    expect(second.authorized).toBe(true)
  })

  it('denies when GHL contact not found', async () => {
    mockGetContactById.mockResolvedValue(null)
    const result = await validateGHLMembership(PARAMS)
    expect(result.authorized).toBe(false)
    expect(result.reason).toBeDefined()
  })
})

describe('validateGHLMembership — GHL unavailable (fail-secure)', () => {
  it('denies when GHL is down and no cache exists', async () => {
    mockGetContactById.mockRejectedValue(
      new GHLError('Service unavailable', ErrorCode.GHL_UNAVAILABLE)
    )
    const result = await validateGHLMembership(PARAMS)
    expect(result.authorized).toBe(false)
  })
})

describe('invalidateMembershipCache', () => {
  it('removes a cached entry', async () => {
    mockGetContactById.mockResolvedValue(VALID_CONTACT)
    await validateGHLMembership(PARAMS)

    await invalidateMembershipCache(PARAMS.userId)

    // After invalidation, should call GHL again
    const result = await validateGHLMembership(PARAMS)
    expect(result.fromCache).toBe(false)
    expect(mockGetContactById).toHaveBeenCalledTimes(2)
  })
})
