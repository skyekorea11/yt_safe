import { readFile } from 'fs/promises'
import path from 'path'
import { execFileSync } from 'child_process'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

interface VideoRow {
  youtube_video_id: string
  title: string | null
  transcript_status: string | null
  transcript_text: string | null
}

interface ScriptOptions {
  limit: number
  all: boolean
  videoId: string | null
}

interface TranscriptResult {
  status: 'READY' | 'NOT_AVAILABLE' | 'FAILED'
  text?: string
  error?: string
}

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp'
const USE_BROWSER_COOKIES = (process.env.YT_DLP_USE_BROWSER_COOKIES || '').toLowerCase() === 'true'
const COOKIES_BROWSER = process.env.YT_DLP_COOKIES_BROWSER || 'edge'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isYtDlpAvailable(): boolean {
  try {
    execFileSync(YT_DLP_PATH, ['--version'], { stdio: 'ignore' })
    return true
  } catch (error) {
    logger.error('yt-dlp not available:', error)
    return false
  }
}

async function fetchTranscriptWithYtDlp(videoId: string): Promise<TranscriptResult> {
  const { execFile } = await import('child_process')
  const fs = await import('fs/promises')
  const os = await import('os')
  const util = await import('util')
  const exec = util.promisify(execFile)

  const tmpDir = os.tmpdir()
  const baseName = `sync-transcript-${videoId}`
  const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`)

  const buildArgs = (lang: 'ko' | 'en') => {
    const args = [
      '--skip-download',
      '--write-sub',
      '--write-auto-sub',
      '--sub-langs', lang,
      '--sub-format', 'vtt',
      '--convert-subs', 'vtt',
      '--sleep-requests', '10',
      '--sleep-interval', '8',
      '--max-sleep-interval', '20',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      '--impersonate', 'edge',
      '--no-check-certificate',
      '--no-warnings',
      '--output', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]
    if (USE_BROWSER_COOKIES) {
      args.splice(12, 0, '--cookies-from-browser', COOKIES_BROWSER)
    }
    return args
  }

  try {
    await sleep(8000)
    await exec(YT_DLP_PATH, buildArgs('ko'))

    const files = await fs.readdir(tmpDir)
    let vttFile = files.find((f) => f.startsWith(baseName) && f.includes('.ko.') && f.endsWith('.vtt'))

    if (!vttFile) {
      await sleep(15000)
      await exec(YT_DLP_PATH, buildArgs('en'))
      const files2 = await fs.readdir(tmpDir)
      vttFile = files2.find((f) => f.startsWith(baseName) && f.includes('.en.') && f.endsWith('.vtt'))
    }

    if (!vttFile) {
      return { status: 'NOT_AVAILABLE', error: 'No subtitle file (ko/en)' }
    }

    const filePath = path.join(tmpDir, vttFile)
    let content = await fs.readFile(filePath, 'utf-8')
    content = content
      .replace(/^WEBVTT[\s\S]*?\n{2,}/i, '')
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?.*$/gm, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')

    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !/^(?:Kind|Language|NOTE)\b/i.test(line))

    const deduped: string[] = []
    for (const line of lines) {
      if (deduped[deduped.length - 1] === line) continue
      deduped.push(line)
    }
    const normalized = deduped.join('\n').trim()

    if (normalized.length < 50) return { status: 'NOT_AVAILABLE', error: 'Subtitle too short' }
    return { status: 'READY', text: normalized.slice(0, 50000) }
  } catch (error) {
    return { status: 'FAILED', error: error instanceof Error ? error.message : String(error) }
  } finally {
    try {
      const files = await fs.readdir(tmpDir)
      await Promise.all(
        files
          .filter((f) => f.startsWith(baseName))
          .map((f) => fs.unlink(path.join(tmpDir, f)).catch(() => {}))
      )
    } catch {}
  }
}

function parseArgs(): ScriptOptions {
  const envLimit = Number(process.env.TRANSCRIPT_SYNC_LIMIT || '20')
  const envAll = (process.env.TRANSCRIPT_SYNC_ALL || '').toLowerCase() === 'true'
  const envVideoId = process.env.TRANSCRIPT_SYNC_VIDEO_ID || null
  const args = process.argv.slice(2)
  let limit = Number.isFinite(envLimit) && envLimit > 0 ? Math.floor(envLimit) : 20
  let all = envAll
  let videoId: string | null = envVideoId

  for (const arg of args) {
    if (arg === '--all') {
      all = true
      continue
    }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1])
      if (Number.isFinite(value) && value > 0) {
        limit = Math.floor(value)
      }
      continue
    }
    if (arg.startsWith('--video=')) {
      const value = arg.split('=')[1]?.trim()
      if (value) videoId = value
    }
  }

  return { limit, all, videoId }
}

async function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  const text = await readFile(envPath, 'utf-8').catch(() => '')
  if (!text) return

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

async function main() {
  await loadDotEnvLocal()
  const options = parseArgs()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  if (!isYtDlpAvailable()) {
    throw new Error(`yt-dlp is not available at ${YT_DLP_PATH}`)
  }

  let targets: VideoRow[] = []
  if (options.videoId) {
    const { data, error } = await supabase
      .from('videos')
      .select('youtube_video_id,title,transcript_status,transcript_text')
      .eq('youtube_video_id', options.videoId)
      .limit(1)
    if (error) throw new Error(`Failed to load video ${options.videoId}: ${error.message}`)
    targets = (data || []) as VideoRow[]
  } else {
    const baseQuery = supabase
      .from('videos')
      .select('youtube_video_id,title,transcript_status,transcript_text')
      .order('published_at', { ascending: false })
      .limit(options.limit)

    const { data, error } = options.all
      ? await baseQuery
      : await baseQuery.or('transcript_text.is.null,transcript_status.in.(pending,failed,not_available)')

    if (error) throw new Error(`Failed to load videos: ${error.message}`)
    targets = (data || []) as VideoRow[]
  }

  if (targets.length === 0) {
    logger.log('No target videos found.')
    return
  }

  logger.log('Transcript sync started (yt-dlp worker)')
  logger.log(`yt-dlp path=${YT_DLP_PATH} | use_browser_cookies=${USE_BROWSER_COOKIES}`)
  logger.log(`Targets: ${targets.length} | all=${options.all} | limit=${options.limit}${options.videoId ? ` | video=${options.videoId}` : ''}`)

  let extracted = 0
  let notAvailable = 0
  let failed = 0

  for (const [index, video] of targets.entries()) {
    const id = video.youtube_video_id
    const title = video.title || '(no title)'
    logger.log(`[${index + 1}/${targets.length}] ${id} - ${title}`)

    await supabase
      .from('videos')
      .update({
        transcript_status: 'pending',
        updated_at: new Date().toISOString(),
      })
      .eq('youtube_video_id', id)

    const result = await fetchTranscriptWithYtDlp(id)

    if (result.status === 'READY' && result.text) {
      extracted += 1
      const { error } = await supabase
        .from('videos')
        .update({
          transcript_text: result.text,
          transcript_status: 'extracted',
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_video_id', id)
      if (error) {
        failed += 1
        extracted -= 1
        logger.error(`  -> DB update failed: ${error.message}`)
      } else {
        logger.log(`  -> extracted (${result.text.length} chars)`)
      }
      continue
    }

    if (result.status === 'NOT_AVAILABLE') {
      notAvailable += 1
      await supabase
        .from('videos')
        .update({
          transcript_text: '',
          transcript_status: 'not_available',
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_video_id', id)
      logger.log('  -> not available')
      continue
    }

    failed += 1
    await supabase
      .from('videos')
      .update({
        transcript_text: '',
        transcript_status: 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('youtube_video_id', id)
    logger.log(`  -> failed: ${result.error || 'unknown error'}`)
  }

  logger.log('Transcript sync complete')
  logger.log(`extracted=${extracted}, not_available=${notAvailable}, failed=${failed}`)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
