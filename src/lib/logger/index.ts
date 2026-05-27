// ============================================================
// Structured logger.
// Production: JSON to stdout (Datadog / CloudWatch / Sentry).
// Development: human-readable coloured output.
// Never log PII — only IDs, codes, and durations.
// ============================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  requestId?: string
  userId?: string
  action?: string
  durationMs?: number
  statusCode?: number
  path?: string
  method?: string
  errorCode?: string
  errorMessage?: string
  ghlContactId?: string
  cacheHit?: boolean
  metadata?: Record<string, unknown>
}

interface LogEntry extends LogFields {
  level: LogLevel
  message: string
  timestamp: string
  service: string
}

// ---- Level weights for filtering ----------------------------
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
}

function getMinLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw && raw in LEVEL_WEIGHT) return raw as LogLevel
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

// ---- Formatters ---------------------------------------------
function formatJSON(entry: LogEntry): string {
  return JSON.stringify(entry)
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
}
const RESET = '\x1b[0m'

function formatHuman(entry: LogEntry): string {
  const { level, message, timestamp, requestId, userId, action, durationMs, errorCode, errorMessage } = entry
  const color = COLORS[level]
  const time = new Date(timestamp).toLocaleTimeString()
  const parts = [`${color}${level.toUpperCase()}${RESET}`, `[${time}]`, message]
  if (action) parts.push(`action=${action}`)
  if (requestId) parts.push(`reqId=${requestId.slice(0, 8)}`)
  if (userId) parts.push(`uid=${userId.slice(0, 8)}`)
  if (durationMs !== undefined) parts.push(`${durationMs}ms`)
  if (errorCode) parts.push(`code=${errorCode}`)
  if (errorMessage) parts.push(`error="${errorMessage}"`)
  return parts.join(' ')
}

// ---- Logger class -------------------------------------------
export class Logger {
  private context: LogFields
  private isProd: boolean
  private minLevel: LogLevel

  constructor(context: LogFields = {}) {
    this.context = context
    this.isProd = process.env.NODE_ENV === 'production'
    this.minLevel = getMinLevel()
  }

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      service: 'linkup-golf',
      ...this.context,
      ...fields,
    }

    const line = this.isProd ? formatJSON(entry) : formatHuman(entry)

    if (level === 'error') {
      console.error(line)
    } else if (level === 'warn') {
      console.warn(line)
    } else {
      console.log(line)
    }
  }

  debug(message: string, fields?: LogFields): void { this.write('debug', message, fields) }
  info(message: string, fields?: LogFields): void  { this.write('info',  message, fields) }
  warn(message: string, fields?: LogFields): void  { this.write('warn',  message, fields) }
  error(message: string, fields?: LogFields): void { this.write('error', message, fields) }

  // Create a child logger with pre-bound context fields
  child(fields: LogFields): Logger {
    return new Logger({ ...this.context, ...fields })
  }

  // Time a block and log the duration
  async time<T>(
    action: string,
    fn: () => Promise<T>,
    fields?: LogFields
  ): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this.info(`${action} completed`, { ...fields, action, durationMs: Date.now() - start })
      return result
    } catch (err) {
      this.error(`${action} failed`, {
        ...fields,
        action,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}

// ---- Singleton root logger ----------------------------------
export const logger = new Logger()

// ---- Audit logger (auth events only) ------------------------
// Kept separate so it can be routed to a dedicated sink.
export const auditLogger = new Logger({ metadata: { audit: true } })

export function auditLog(
  action: 'LOGIN_ATTEMPT' | 'LOGIN_SUCCESS' | 'LOGIN_DENIED' | 'LOGOUT' |
          'AUTH_TAG_VALID' | 'AUTH_TAG_REVOKED' | 'AUTH_GHL_UNAVAILABLE' |
          'SESSION_EXPIRED' | 'ADMIN_ACCESS_DENIED' | 'SILENT_LOGIN',
  fields: LogFields
): void {
  const level: LogLevel = action.includes('DENIED') || action.includes('REVOKED') || action.includes('EXPIRED')
    ? 'warn'
    : 'info'
  auditLogger[level](`AUDIT:${action}`, fields)
}
