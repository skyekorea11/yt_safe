import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.SUPADATA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'SUPADATA_API_KEY not configured' }, { status: 503 })
  }

  const res = await fetch('https://api.supadata.ai/v1/me', {
    headers: { 'x-api-key': apiKey },
    next: { revalidate: 300 }, // cache 5 minutes
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Failed to fetch quota' }, { status: 502 })
  }

  const data = await res.json() as { plan: string; maxCredits: number; usedCredits: number }

  return NextResponse.json({
    plan: data.plan,
    total: data.maxCredits,
    used: data.usedCredits,
    remaining: data.maxCredits - data.usedCredits,
  })
}
