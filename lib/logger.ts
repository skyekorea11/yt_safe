/**
 * Structured logger utility
 * - In production: suppresses log/debug, keeps warn/error
 * - In browser: never emits config-status noise
 */

const isProd = process.env.NODE_ENV === 'production'
const isBrowser = typeof window !== 'undefined'

type LogMeta = Record<string, unknown> | unknown

function format(level: string, message: string, meta?: LogMeta): void {
  const prefix = `[${level.toUpperCase()}]`
  if (meta !== undefined) {
    // eslint-disable-next-line no-console
    console[level as 'log'](prefix, message, meta)
  } else {
    // eslint-disable-next-line no-console
    console[level as 'log'](prefix, message)
  }
}

export const logger = {
  log(message: string, meta?: LogMeta): void {
    if (isProd) return
    format('log', message, meta)
  },

  debug(message: string, meta?: LogMeta): void {
    if (isProd) return
    format('debug', message, meta)
  },

  warn(message: string, meta?: LogMeta): void {
    // Don't emit server config warnings in the browser
    if (isBrowser) return
    format('warn', message, meta)
  },

  error(message: string, meta?: LogMeta): void {
    format('error', message, meta)
  },
}
