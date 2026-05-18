// ============================================================
// Typed error hierarchy.
// Every AppError carries a machine-readable code so callers
// can branch on error type without string matching.
// ============================================================

export const ErrorCode = {
  // Auth
  UNAUTHENTICATED:     'UNAUTHENTICATED',
  SESSION_EXPIRED:     'SESSION_EXPIRED',
  INVALID_TOKEN:       'INVALID_TOKEN',
  // Authorization
  UNAUTHORIZED:        'UNAUTHORIZED',
  MEMBERSHIP_REVOKED:  'MEMBERSHIP_REVOKED',
  // GHL
  GHL_UNAVAILABLE:     'GHL_UNAVAILABLE',
  GHL_CONTACT_NOT_FOUND: 'GHL_CONTACT_NOT_FOUND',
  GHL_RATE_LIMITED:    'GHL_RATE_LIMITED',
  // Validation
  VALIDATION_ERROR:    'VALIDATION_ERROR',
  RATE_LIMITED:        'RATE_LIMITED',
  // Internal
  INTERNAL_ERROR:      'INTERNAL_ERROR',
  CACHE_ERROR:         'CACHE_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export class AppError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly isOperational: boolean
  readonly context?: Record<string, unknown>

  constructor(
    message: string,
    code: ErrorCode,
    statusCode = 500,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.statusCode = statusCode
    this.isOperational = true
    this.context = context
    Error.captureStackTrace(this, this.constructor)
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ErrorCode.UNAUTHENTICATED) {
    super(message, code, 401)
    this.name = 'AuthError'
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(message, code, 403)
    this.name = 'AuthorizationError'
  }
}

export class GHLError extends AppError {
  constructor(message: string, code: ErrorCode = ErrorCode.GHL_UNAVAILABLE, context?: Record<string, unknown>) {
    super(message, code, 503, context)
    this.name = 'GHLError'
  }
}

export class ValidationError extends AppError {
  readonly fields: string[]
  constructor(message: string, fields: string[] = []) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, { fields })
    this.name = 'ValidationError'
    this.fields = fields
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number
  constructor(retryAfterSeconds: number) {
    super('Too many requests', ErrorCode.RATE_LIMITED, 429, { retryAfterSeconds })
    this.name = 'RateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}

export function toErrorResponse(err: unknown): { code: string; message: string; statusCode: number } {
  if (isAppError(err)) {
    return { code: err.code, message: err.message, statusCode: err.statusCode }
  }
  return { code: ErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred', statusCode: 500 }
}
