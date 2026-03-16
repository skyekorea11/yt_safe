import { execFileSync } from 'child_process'

/**
 * Transcript provider - yt-dlp 기반 자막 추출
 * YT_DLP_PATH 우선, 없으면 PATH/일반 설치 경로를 자동 탐색
 * ko 자막 우선 + (필요 시) impersonate/cookies + rate limit 방어
 */

export interface TranscriptResult {
  status: 'READY' | 'PENDING' | 'NOT_AVAILABLE' | 'FAILED';
  text?: string;
  source?: 'yt-dlp';
  error?: string;
}

export interface TranscriptProvider {
  fetchTranscript(videoId: string): Promise<TranscriptResult>;
  isAvailable(): boolean;
  getName(): string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const USE_BROWSER_COOKIES = (process.env.YT_DLP_USE_BROWSER_COOKIES || '').toLowerCase() === 'true';
const COOKIES_BROWSER = process.env.YT_DLP_COOKIES_BROWSER || 'edge';
const IMPERSONATE_TARGET = process.env.YT_DLP_IMPERSONATE || 'edge';
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

class CompositeTranscriptProvider implements TranscriptProvider {
  constructor(private provider: TranscriptProvider) {}

  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    if (!this.provider.isAvailable()) {
      return { status: 'FAILED', error: 'yt-dlp 실행 불가 (경로 확인 필요)' };
    }
    return this.provider.fetchTranscript(videoId);
  }

  isAvailable() { return this.provider.isAvailable(); }
  getName() { return this.provider.getName(); }
}

export function getTranscriptProvider(): TranscriptProvider {
  const provider = new YtDlpStandaloneProvider();
  return new CompositeTranscriptProvider(provider);
}
