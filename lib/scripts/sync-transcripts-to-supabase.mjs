import { readFile } from 'fs/promises'
import path from 'path'
import { execFileSync } from 'child_process'
import { createClient } from '@supabase/supabase-js'

const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp'
const USE_BROWSER_COOKIES = (process.env.YT_DLP_USE_BROWSER_COOKIES || '').toLowerCase() === 'true'
const COOKIES_BROWSER = process.env.YT_DLP_COOKIES_BROWSER || 'edge'
const IMPERSONATE_TARGET = process.env.YT_DLP_IMPERSONATE || 'edge'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeTimestamp(raw) {
  const ts = String(raw || '').replace(',', '.').trim()
  const parts = ts.split(':')
  if (parts.length === 3) {
    const [hh, mm, ssms] = parts
    const ss = (ssms || '00').split('.')[0] || '00'
    const h = Number(hh || '0')
    return h > 0
      ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  if (parts.length === 2) {
    const [mm, ssms] = parts
    const ss = (ssms || '00').split('.')[0] || '00'
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  return ts
}

function parseVttSegments(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const segments = []
  let activeStart = ''
  let buffer = []

  const flush = () => {
    if (!activeStart || buffer.length === 0) {
      buffer = []
      return
    }
    const text = buffer
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) segments.push({ start: normalizeTimestamp(activeStart), text })
    buffer = []
  }

  for (const lineRaw of lines) {
    const line = lineRaw.trim()
    if (!line) {
      flush()
      continue
    }
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?)\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?.*$/)
    if (match) {
      flush()
      activeStart = match[1]
      continue
    }
    if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(line) || /^\d+$/.test(line)) continue
    buffer.push(line)
  }
  flush()

  const deduped = []
  for (const seg of segments) {
    if (deduped.length > 0) {
      const prev = deduped[deduped.length - 1]
      const prevNorm = prev.text.replace(/\s+/g, ' ').trim()
      const currNorm = seg.text.replace(/\s+/g, ' ').trim()
      if (prevNorm === currNorm) continue
      if (prev.start === seg.start && (prevNorm.includes(currNorm) || currNorm.includes(prevNorm))) {
        if (currNorm.length > prevNorm.length) deduped[deduped.length - 1] = seg
        continue
      }
      if (prevNorm.includes(currNorm) && currNorm.length >= 8) continue
    }
    deduped.push(seg)
  }
  return deduped
}

function isYtDlpAvailable() {
  try {
    execFileSync(YT_DLP_PATH, ['--version'], { stdio: 'ignore' })
    return true
  } catch (error) {
    console.error('yt-dlp not available:', error)
    return false
  }
}

async function fetchTranscriptWithYtDlp(videoId) {
  const { execFile } = await import('child_process')
  const fs = await import('fs/promises')
  const os = await import('os')
  const util = await import('util')
  const exec = util.promisify(execFile)

  const tmpDir = os.tmpdir()
  const baseName = `sync-transcript-${videoId}`
  const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`)

  const isImpersonateUnsupported = (error) => {
    const message = error instanceof Error ? error.message : String(error)
    return /Impersonate target .* is not available/i.test(message)
      || /missing dependencies required to support this target/i.test(message)
  }

  const buildArgs = (lang, useImpersonate) => {
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
      '--no-check-certificate',
      '--no-warnings',
      '--output', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]
    if (useImpersonate) {
      const insertIdx = args.indexOf('--no-check-certificate')
      args.splice(Math.max(0, insertIdx), 0, '--impersonate', IMPERSONATE_TARGET)
    }
    if (USE_BROWSER_COOKIES) {
      const outputIdx = args.indexOf('--output')
      args.splice(Math.max(0, outputIdx), 0, '--cookies-from-browser', COOKIES_BROWSER)
    }
    return args
  }

  try {
    const runLanguage = async (lang) => {
      try {
        await exec(YT_DLP_PATH, buildArgs(lang, true))
      } catch (error) {
        if (!isImpersonateUnsupported(error)) throw error
        console.warn('  -> impersonate unsupported; retrying without impersonate')
        await exec(YT_DLP_PATH, buildArgs(lang, false))
      }
    }

    await sleep(8000)
    await runLanguage('ko')

    const files = await fs.readdir(tmpDir)
    let vttFile = files.find((f) => f.startsWith(baseName) && f.includes('.ko.') && f.endsWith('.vtt'))
    if (!vttFile) {
      await sleep(15000)
      await runLanguage('en')
      const files2 = await fs.readdir(tmpDir)
      vttFile = files2.find((f) => f.startsWith(baseName) && f.includes('.en.') && f.endsWith('.vtt'))
    }

    if (!vttFile) return { status: 'NOT_AVAILABLE', error: 'No subtitle file (ko/en)' }

    const filePath = path.join(tmpDir, vttFile)
    const rawVtt = await fs.readFile(filePath, 'utf-8')
    const segments = parseVttSegments(rawVtt)
    const normalized = segments.map((seg) => `[${seg.start}] ${seg.text}`).join('\n').trim()

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

function parseArgs() {
  const envLimit = Number(process.env.TRANSCRIPT_SYNC_LIMIT || '20')
  const envAll = (process.env.TRANSCRIPT_SYNC_ALL || '').toLowerCase() === 'true'
  const envVideoId = process.env.TRANSCRIPT_SYNC_VIDEO_ID || null
  const args = process.argv.slice(2)
  let limit = Number.isFinite(envLimit) && envLimit > 0 ? Math.floor(envLimit) : 20
  let all = envAll
  let videoId = envVideoId

  for (const arg of args) {
    if (arg === '--all') {
      all = true
      continue
    }
    if (arg.startsWith('--limit=')) {
      const value = Number(arg.split('=')[1])
      if (Number.isFinite(value) && value > 0) limit = Math.floor(value)
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
  if (!isYtDlpAvailable()) throw new Error(`yt-dlp is not available at ${YT_DLP_PATH}`)

  let targets = []
  if (options.videoId) {
    const { data, error } = await supabase
      .from('videos')
      .select('youtube_video_id,title,transcript_status,transcript_text')
      .eq('youtube_video_id', options.videoId)
      .limit(1)
    if (error) throw new Error(`Failed to load video ${options.videoId}: ${error.message}`)
    targets = data || []
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
    targets = data || []
  }

  if (targets.length === 0) {
    console.log('No target videos found.')
    return
  }

  console.log('Transcript sync started (yt-dlp worker)')
  console.log(`yt-dlp path=${YT_DLP_PATH} | use_browser_cookies=${USE_BROWSER_COOKIES}`)
  console.log(`Targets: ${targets.length} | all=${options.all} | limit=${options.limit}${options.videoId ? ` | video=${options.videoId}` : ''}`)

  let extracted = 0
  let notAvailable = 0
  let failed = 0

  for (const [index, video] of targets.entries()) {
    const id = video.youtube_video_id
    const title = video.title || '(no title)'
    console.log(`[${index + 1}/${targets.length}] ${id} - ${title}`)

    await supabase
      .from('videos')
      .update({ transcript_status: 'pending', updated_at: new Date().toISOString() })
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
        console.error(`  -> DB update failed: ${error.message}`)
      } else {
        console.log(`  -> extracted (${result.text.length} chars)`)
      }
      continue
    }

    if (result.status === 'NOT_AVAILABLE') {
      notAvailable += 1
      await supabase
        .from('videos')
        .update({ transcript_text: '', transcript_status: 'not_available', updated_at: new Date().toISOString() })
        .eq('youtube_video_id', id)
      console.log('  -> not available')
      continue
    }

    failed += 1
    await supabase
      .from('videos')
      .update({ transcript_text: '', transcript_status: 'failed', updated_at: new Date().toISOString() })
      .eq('youtube_video_id', id)
    console.log(`  -> failed: ${result.error || 'unknown error'}`)
  }

  console.log('Transcript sync complete')
  console.log(`extracted=${extracted}, not_available=${notAvailable}, failed=${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
