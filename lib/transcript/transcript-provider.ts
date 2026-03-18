import { execFileSync } from 'child_process'
import { transcriptUsageRepository } from '@/lib/supabase/videos'

/**
 * Transcript provider - yt-dlp 기반 자막 추출
 * YT_DLP_PATH 우선, 없으면 PATH/일반 설치 경로를 자동 탐색
 * ko 자막 우선 + (필요 시) impersonate/cookies + rate limit 방어
 */

export interface TranscriptResult {
  status: 'READY' | 'PENDING' | 'NOT_AVAILABLE' | 'FAILED';
  text?: string;
  source?: 'yt-dlp' | 'azure-service';
  error?: string;
}

export interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptResult>;
  isAvailable(): boolean;
  getName(): string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY?.trim() || '';
const USE_BROWSER_COOKIES = (process.env.YT_DLP_USE_BROWSER_COOKIES || '').toLowerCase() === 'true';
const COOKIES_BROWSER = process.env.YT_DLP_COOKIES_BROWSER || 'edge';
const IMPERSONATE_TARGET = process.env.YT_DLP_IMPERSONATE || 'edge';
const TRANSCRIPT_SERVICE_URL = process.env.TRANSCRIPT_SERVICE_URL?.trim() || '';
const TRANSCRIPT_SERVICE_TOKEN = process.env.TRANSCRIPT_SERVICE_TOKEN?.trim() || '';
const TRANSCRIPT_SERVICE_TIMEOUT_MS = Number(process.env.TRANSCRIPT_SERVICE_TIMEOUT_MS || '15000');
const AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY = Number(process.env.AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY || '120');
const AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH = Number(process.env.AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH || '1500');
const AZURE_TRANSCRIPT_CAP_STRICT = (process.env.AZURE_TRANSCRIPT_CAP_STRICT || 'true').toLowerCase() !== 'false';
const configuredYtDlpPath = process.env.YT_DLP_PATH?.trim();
const YT_DLP_CANDIDATES = [
  configuredYtDlpPath,
  'yt-dlp',
  '/opt/homebrew/bin/yt-dlp',
  '/usr/local/bin/yt-dlp',
  '/Users/skye/bin/yt-dlp',
].filter((value): value is string => Boolean(value));

function resolveYtDlpPath(): string | null {
  for (const candidate of YT_DLP_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {}
  }
  return null;
}

function isImpersonateUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Impersonate target .* is not available/i.test(message)
    || /missing dependencies required to support this target/i.test(message);
}

type TranscriptSegment = { start: string; text: string };

function normalizeTimestamp(raw: string): string {
  const ts = raw.replace(',', '.').trim();
  const parts = ts.split(':');
  if (parts.length === 3) {
    const [hh, mm, ssms] = parts;
    const ss = ssms.split('.')[0] || '00';
    const h = Number(hh || '0');
    return h > 0 ? `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:${ss.padStart(2, '0')}` : `${mm.padStart(2, '0')}:${ss.padStart(2, '0')}`;
  }
  if (parts.length === 2) {
    const [mm, ssms] = parts;
    const ss = ssms.split('.')[0] || '00';
    return `${mm.padStart(2, '0')}:${ss.padStart(2, '0')}`;
  }
  return ts;
}

function parseVttSegments(raw: string): TranscriptSegment[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const segments: TranscriptSegment[] = [];
  let activeStart = '';
  let buffer: string[] = [];

  const flush = () => {
    if (!activeStart || buffer.length === 0) {
      buffer = [];
      return;
    }
    const text = buffer
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      segments.push({ start: normalizeTimestamp(activeStart), text });
    }
    buffer = [];
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) {
      flush();
      continue;
    }
    const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?)\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?.*$/);
    if (match) {
      flush();
      activeStart = match[1];
      continue;
    }
    if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(line) || /^\d+$/.test(line)) continue;
    buffer.push(line);
  }
  flush();

  const deduped: TranscriptSegment[] = [];
  for (const seg of segments) {
    if (deduped.length > 0) {
      const prev = deduped[deduped.length - 1];
      const prevNorm = prev.text.replace(/\s+/g, ' ').trim();
      const currNorm = seg.text.replace(/\s+/g, ' ').trim();
      if (prevNorm === currNorm) continue;
      if (prev.start === seg.start && (prevNorm.includes(currNorm) || currNorm.includes(prevNorm))) {
        if (currNorm.length > prevNorm.length) deduped[deduped.length - 1] = seg;
        continue;
      }
      if (prevNorm.includes(currNorm) && currNorm.length >= 8) continue;
    }
    deduped.push(seg);
  }
  return deduped;
}

export class YtDlpStandaloneProvider implements TranscriptProvider {

  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    const { execFile } = await import('child_process');
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const { promisify } = await import('util');

    const exec = promisify(execFile);
    const ytDlpPath = resolveYtDlpPath();
    const tmpDir = os.tmpdir();
    const baseName = `transcript-${videoId}`;
    const outputTemplate = path.join(tmpDir, `${baseName}.%(ext)s`);

    if (!ytDlpPath) {
      return { status: 'FAILED', error: 'yt-dlp executable not found (set YT_DLP_PATH)' };
    }

    try {
      console.log('[yt-dlp-standalone] 한국어 자막 시도 중... (edge impersonate)');

      await sleep(8000);

      const buildArgs = (lang: 'ko' | 'en', useImpersonate: boolean) => {
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
        ];
        if (useImpersonate) {
          const insertIdx = args.indexOf('--no-check-certificate');
          args.splice(Math.max(0, insertIdx), 0, '--impersonate', IMPERSONATE_TARGET);
        }
        if (USE_BROWSER_COOKIES) {
          const outputIdx = args.indexOf('--output');
          args.splice(Math.max(0, outputIdx), 0, '--cookies-from-browser', COOKIES_BROWSER);
        }
        return args;
      };

      const runLanguage = async (lang: 'ko' | 'en') => {
        try {
          await exec(ytDlpPath, buildArgs(lang, true));
        } catch (error) {
          if (!isImpersonateUnsupported(error)) throw error;
          console.warn('[yt-dlp-standalone] impersonate 미지원, 일반 모드로 재시도');
          await exec(ytDlpPath, buildArgs(lang, false));
        }
      };

      await runLanguage('ko');

      const files = await fs.readdir(tmpDir);
      let vttFile: string | undefined = files.find(f =>
        f.startsWith(baseName) &&
        f.includes('.ko.') &&
        f.endsWith('.vtt')
      );

      if (!vttFile) {
        console.log('[yt-dlp-standalone] ko 없음 → en 시도');
        await sleep(15000);

        await runLanguage('en');

        const files2 = await fs.readdir(tmpDir);
        vttFile = files2.find(f =>
          f.startsWith(baseName) &&
          f.includes('.en.') &&
          f.endsWith('.vtt')
        );
      }

      if (!vttFile) {
        return { status: 'NOT_AVAILABLE', error: '자막 파일 없음 (ko/en 모두 실패)' };
      }

      const filePath = path.join(tmpDir, vttFile);
      const rawVtt = await fs.readFile(filePath, 'utf-8');
      const segments = parseVttSegments(rawVtt);
      const content = segments.map(seg => `[${seg.start}] ${seg.text}`).join('\n').trim();

      if (content.length < 50) {
        return { status: 'NOT_AVAILABLE' };
      }

      return {
        status: 'READY',
        // Keep enough context for fallback summarization (beginning-only truncation hurts quality).
        text: content.slice(0, 50000),
        source: 'yt-dlp',
      };

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[yt-dlp-standalone] 에러:', message);
      return { status: 'FAILED', error: message };
    } finally {
      try {
        const files = await fs.readdir(tmpDir);
        for (const f of files) {
          if (f.startsWith(baseName)) {
            await fs.unlink(path.join(tmpDir, f)).catch(() => {});
          }
        }
      } catch {}
    }
  }

  isAvailable(): boolean {
    if (typeof window !== 'undefined') return false;
    return resolveYtDlpPath() !== null;
  }

  getName() {
    const path = resolveYtDlpPath();
    return path
      ? `yt-dlp-standalone (edge impersonate, path=${path})`
      : 'yt-dlp-standalone (edge impersonate, unavailable)';
  }
}

export class SupadataTranscriptProvider implements TranscriptProvider {
  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    const tryLang = async (lang: string): Promise<string | null> => {
      const url = `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=${lang}&text=true`;
      const res = await fetch(url, {
        headers: { 'x-api-key': SUPADATA_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!data) return null;
      // Response: { content: string } or { segments: [{text, offset, duration}] }
      if (typeof data.content === 'string' && data.content.trim().length >= 50) return data.content.trim();
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        const text = data.segments.map((s: { text: string }) => s.text).join(' ').trim();
        if (text.length >= 50) return text;
      }
      return null;
    };

    try {
      const text = (await tryLang('ko')) ?? (await tryLang('en'));
      if (!text) return { status: 'NOT_AVAILABLE' };
      return { status: 'READY', text: text.slice(0, 50000), source: 'azure-service' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'FAILED', error: `supadata: ${message}` };
    }
  }

  isAvailable(): boolean {
    if (typeof window !== 'undefined') return false;
    return Boolean(SUPADATA_API_KEY);
  }

  getName() { return 'supadata-transcript-api'; }
}

export class AzureTranscriptServiceProvider implements TranscriptProvider {
  private withTimeout(ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timer),
    };
  }

  private normalizeResponse(data: unknown, httpStatus: number): TranscriptResult {
    const obj = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const transcriptText = [obj.transcript, obj.text, obj.subtitle, obj.captions]
      .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
    const rawStatus = String(obj.status || obj.result || '').toLowerCase();

    if (transcriptText && transcriptText.trim().length >= 50) {
      return { status: 'READY', text: transcriptText.trim().slice(0, 50000), source: 'azure-service' };
    }

    if (httpStatus === 404 || rawStatus === 'not_available' || rawStatus === 'not-available' || rawStatus === 'no_transcript') {
      return { status: 'NOT_AVAILABLE', source: 'azure-service' };
    }

    if (rawStatus === 'pending' || rawStatus === 'queued' || rawStatus === 'processing') {
      return { status: 'PENDING', source: 'azure-service' };
    }

    if (rawStatus === 'ready' || rawStatus === 'extracted' || rawStatus === 'complete') {
      return { status: 'FAILED', source: 'azure-service', error: 'Transcript marked ready but text missing' };
    }

    return { status: 'FAILED', source: 'azure-service', error: String(obj.error || `Unexpected response (${httpStatus})`) };
  }

  private startOfDayIso(): string {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return dayStart.toISOString();
  }

  private startOfMonthIso(): string {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return monthStart.toISOString();
  }

  private async checkBudgetCaps(videoId: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const needDaily = Number.isFinite(AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY) && AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY > 0;
    const needMonthly = Number.isFinite(AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH) && AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH > 0;
    if (!needDaily && !needMonthly) return { ok: true };

    const [dailyCount, monthlyCount] = await Promise.all([
      needDaily ? transcriptUsageRepository.countSince('azure-service', this.startOfDayIso()) : Promise.resolve(0),
      needMonthly ? transcriptUsageRepository.countSince('azure-service', this.startOfMonthIso()) : Promise.resolve(0),
    ]);

    if ((needDaily && dailyCount === null) || (needMonthly && monthlyCount === null)) {
      const message = 'Azure usage cap check failed (usage table unavailable)';
      await transcriptUsageRepository.log('azure-service', videoId, 'blocked').catch(() => {});
      if (AZURE_TRANSCRIPT_CAP_STRICT) {
        return { ok: false, message };
      }
      return { ok: true };
    }

    if (needDaily && (dailyCount || 0) >= AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY) {
      const message = `Azure daily cap reached (${dailyCount}/${AZURE_TRANSCRIPT_MAX_CALLS_PER_DAY})`;
      await transcriptUsageRepository.log('azure-service', videoId, 'blocked').catch(() => {});
      return { ok: false, message };
    }

    if (needMonthly && (monthlyCount || 0) >= AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH) {
      const message = `Azure monthly cap reached (${monthlyCount}/${AZURE_TRANSCRIPT_MAX_CALLS_PER_MONTH})`;
      await transcriptUsageRepository.log('azure-service', videoId, 'blocked').catch(() => {});
      return { ok: false, message };
    }

    return { ok: true };
  }

  private async logUsage(videoId: string, status: TranscriptResult['status']) {
    const normalized =
      status === 'READY'
        ? 'ready'
        : status === 'NOT_AVAILABLE'
          ? 'not_available'
          : status === 'PENDING'
            ? 'pending'
            : 'failed';
    await transcriptUsageRepository.log('azure-service', videoId, normalized).catch(() => {});
  }

  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    if (!this.isAvailable()) {
      return { status: 'FAILED', source: 'azure-service', error: 'TRANSCRIPT_SERVICE_URL is not configured' };
    }

    const capCheck = await this.checkBudgetCaps(videoId);
    if (!capCheck.ok) {
      return { status: 'FAILED', source: 'azure-service', error: capCheck.message };
    }

    const base = TRANSCRIPT_SERVICE_URL.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (TRANSCRIPT_SERVICE_TOKEN) {
      headers.Authorization = `Bearer ${TRANSCRIPT_SERVICE_TOKEN}`;
      headers['x-api-key'] = TRANSCRIPT_SERVICE_TOKEN;
    }

    // Try a few common endpoint shapes so it works with Azure Function/Container App gateways.
    const attempts: Array<{ url: string; init: RequestInit }> = [
      { url: `${base}/api/transcripts/${videoId}`, init: { method: 'POST', headers, body: JSON.stringify({ videoId, force: true }) } },
      { url: `${base}/transcripts/${videoId}`, init: { method: 'POST', headers, body: JSON.stringify({ videoId, force: true }) } },
      { url: `${base}/api/transcripts`, init: { method: 'POST', headers, body: JSON.stringify({ videoId, force: true }) } },
      { url: `${base}/transcripts`, init: { method: 'POST', headers, body: JSON.stringify({ videoId, force: true }) } },
      { url: `${base}/api/transcripts/${videoId}`, init: { method: 'GET', headers } },
      { url: `${base}/transcripts/${videoId}`, init: { method: 'GET', headers } },
    ];

    let lastError = 'Azure transcript service call failed';
    for (const attempt of attempts) {
      const { signal, clear } = this.withTimeout(TRANSCRIPT_SERVICE_TIMEOUT_MS);
      try {
        const response = await fetch(attempt.url, { ...attempt.init, signal });
        const payload = await response.json().catch(() => ({}));
        const normalized = this.normalizeResponse(payload, response.status);
        if (normalized.status === 'READY' || normalized.status === 'NOT_AVAILABLE' || normalized.status === 'PENDING') {
          await this.logUsage(videoId, normalized.status);
          return normalized;
        }
        lastError = normalized.error || lastError;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      } finally {
        clear();
      }
    }

    await this.logUsage(videoId, 'FAILED');
    return { status: 'FAILED', source: 'azure-service', error: lastError };
  }

  isAvailable(): boolean {
    if (typeof window !== 'undefined') return false;
    return Boolean(TRANSCRIPT_SERVICE_URL);
  }

  getName() {
    return this.isAvailable()
      ? `azure-transcript-service (url=${TRANSCRIPT_SERVICE_URL})`
      : 'azure-transcript-service (unconfigured)';
  }
}

class CompositeTranscriptProvider implements TranscriptProvider {
  constructor(private providers: TranscriptProvider[]) {}

  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    const available = this.providers.filter(provider => provider.isAvailable());
    if (available.length === 0) {
      return { status: 'FAILED', error: 'Transcript provider unavailable (configure Azure service or yt-dlp)' };
    }

    let lastFailure: TranscriptResult = { status: 'FAILED', error: 'No provider result' };
    for (const provider of available) {
      const result = await provider.fetchTranscript(videoId);
      if (result.status === 'READY' || result.status === 'NOT_AVAILABLE' || result.status === 'PENDING') {
        return result;
      }
      lastFailure = result;
    }
    return lastFailure;
  }

  isAvailable() { return this.providers.some(provider => provider.isAvailable()); }
  getName() { return this.providers.map(provider => provider.getName()).join(' -> '); }
}

export function getTranscriptProvider(): TranscriptProvider {
  const providers: TranscriptProvider[] = [
    new SupadataTranscriptProvider(),
    new AzureTranscriptServiceProvider(),
    new YtDlpStandaloneProvider(),
  ];
  return new CompositeTranscriptProvider(providers);
}
