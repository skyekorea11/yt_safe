import { NextRequest, NextResponse } from 'next/server'

/**
 * API key authentication middleware
 *
 * All sensitive API routes require the header:
 *   x-api-key: <API_SECRET_KEY>
 *
 * Set API_SECRET_KEY in .env.local (never commit this value).
 *
 * Rate limiting note: in-process counters are reset per serverless instance.
 * For production multi-instance deployments, replace with Upstash Redis or
 * Vercel's built-in rate limiting.
 */

const PROTECTED_ROUTES = [
  '/api/summaries/refresh',
  '/api/transcripts',
  '/api/videos',
  '/api/provider-info',
  '/api/supadata-quota',
  '/api/refresh-status',
  '/api/channels',
  '/api/news-channels',
]

// Simple in-process rate limiter (per IP, per minute)
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED === 'true'
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || '60')
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

function isAuthorized(key: string | null, expected: string): boolean {
  if (!key || !expected) return false
  // Constant-length comparison to mitigate timing attacks
  if (key.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < key.length; i++) {
    diff |= key.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
  if (!isProtected) return NextResponse.next()

  // Rate limiting
  if (RATE_LIMIT_ENABLED) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    if (isRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
  }

  // API key check
  const apiSecretKey = process.env.API_SECRET_KEY ?? ''
  const providedKey = request.headers.get('x-api-key')

  if (!isAuthorized(providedKey, apiSecretKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/summaries/:path*',
    '/api/transcripts/:path*',
    '/api/videos/:path*',
    '/api/provider-info',
    '/api/supadata-quota',
    '/api/refresh-status',
    '/api/channels/:path*',
    '/api/news-channels/:path*',
  ],
}
