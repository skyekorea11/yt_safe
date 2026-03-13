import { NextResponse } from 'next/server'
import { summaryService } from '@/lib/summarization/summary-service'
import { supabase } from '@/lib/supabase/client'

async function getDbDiagnostics() {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim())
  const hasSupabaseAnon = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim())
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const projectRef = (() => {
    try {
      return new URL(supabaseUrl).hostname.split('.')[0] || null
    } catch {
      return null
    }
  })()

  if (!hasSupabaseUrl || !hasSupabaseAnon) {
    return {
      ok: false,
      reason: 'missing_env',
      hasSupabaseUrl,
      hasSupabaseAnon,
      projectRef,
    }
  }

  const [channelsRes, videosRes] = await Promise.all([
    supabase.from('channels').select('*', { count: 'exact', head: true }),
    supabase.from('videos').select('*', { count: 'exact', head: true }),
  ])

  return {
    ok: !channelsRes.error && !videosRes.error,
    reason: channelsRes.error || videosRes.error ? 'query_error' : 'connected',
    hasSupabaseUrl,
    hasSupabaseAnon,
    projectRef,
    channelsCount: channelsRes.count ?? null,
    videosCount: videosRes.count ?? null,
    channelsError: channelsRes.error?.message ?? null,
    videosError: videosRes.error?.message ?? null,
  }
}

export async function GET() {
  try {
    const transcript = summaryService.getTranscriptProviderInfo()
    const summarizer = summaryService.getSummarizerInfo()
    const db = await getDbDiagnostics()
    return NextResponse.json({ success: true, transcript, summarizer, db })
  } catch (err) {
    console.error('Provider info error', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
