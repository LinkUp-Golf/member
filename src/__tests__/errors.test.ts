import { describe, it, expect } from 'vitest'
import {
  AppError, AuthError, AuthorizationError, GHLError,
  ValidationError, RateLimitError,
  ErrorCode, isAppError, toErrorResponse,
} from '@/lib/errors/app-error'

describe('AppError hierarchy', () => {
  it('AuthError carries correct status and code', () => {
    const err = new AuthError()
    expect(err.statusCode).toBe(401)
    expect(err.code).toBe(ErrorCode.UNAUTHENTICATED)
    expect(isAppError(err)).toBe(true)
  })

  it('AuthorizationError carries correct status and code', () => {
    const err = new AuthorizationError()
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED)
  })

  it('GHLError defaults to 503', () => {
    const err = new GHLError('down')
    expect(err.statusCode).toBe(503)
    expect(err.code).toBe(ErrorCode.GHL_UNAVAILABLE)
  })

  it('ValidationError carries field list', () => {
    const err = new ValidationError('bad input', ['email', 'name'])
    expect(err.statusCode).toBe(400)
    expect(err.fields).toEqual(['email', 'name'])
  })

  it('RateLimitError carries retryAfter', () => {
    const err = new RateLimitError(60)
    expect(err.statusCode).toBe(429)
    expect(err.retryAfterSeconds).toBe(60)
  })
})

describe('isAppError', () => {
  it('returns true for AppError subclasses', () => {
    expect(isAppError(new AuthError())).toBe(true)
    expect(isAppError(new GHLError('x'))).toBe(true)
  })

  it('returns false for plain errors', () => {
    expect(isAppError(new Error('plain'))).toBe(false)
    expect(isAppError(null)).toBe(false)
    expect(isAppError('string')).toBe(false)
  })
})

describe('toErrorResponse', () => {
  it('maps AppError to structured response', () => {
    const err = new AuthError('Not logged in')
    const res = toErrorResponse(err)
    expect(res.statusCode).toBe(401)
    expect(res.code).toBe(ErrorCode.UNAUTHENTICATED)
    expect(res.message).toBe('Not logged in')
  })

  it('maps unknown error to 500 INTERNAL_ERROR', () => {
    const res = toErrorResponse(new TypeError('boom'))
    expect(res.statusCode).toBe(500)
    expect(res.code).toBe(ErrorCode.INTERNAL_ERROR)
  })

  it('maps null to 500', () => {
    const res = toErrorResponse(null)
    expect(res.statusCode).toBe(500)
  })
})
