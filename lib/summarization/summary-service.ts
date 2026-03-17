import { getTranscriptProvider } from '@/lib/transcript/transcript-provider'
import { DescriptionBasedSummarizer, getLocalSummarizer, HeuristicTranscriptSummarizer } from '@/lib/summarization/local-summarizer'
import { videoRepository } from '@/lib/supabase/videos'
import { buildHeuristicSummary, chunkTranscript, cleanTranscript, ensureKoreanSummary, formatSummaryText } from '@/lib/utils/transcript'

/**
 * Summary service orchestrates transcript extraction and summarization
 */
const DISCLAIMER_SENTENCE_PATTERN =
  /(translated\s+by|disclaimer|저작권|copyright|public\s+good|educational\s+purposes?|revenue\s+generated|youtube\s+at\s+all|we\s+check|korean\s+subtitles|original\s+copyright\s+holder|if\s+you.*correction|for\s+information\s+purposes|for\s+entertainment\s+purposes|not\s+financial\s+advice|법적\s+책임|무단\s+전재|재배포|rights?\s+reserved)/i

export const summaryService = {
  finalizeSummaryText(text: string, maxLines = 5, maxTotalChars = 500): string {
    const cleaned = this.sanitizeSummaryText(text)
    if (!cleaned) return ''

    const sentenceLike = cleaned
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+/g, ' '))

    const boilerplateSentence = /(핵심\s+질문과\s+판단\s+포인트|단일\s+결론을\s+제시하기보다|조건별로\s+쟁점을\s+나누어|자신의\s+상황에\s+맞춰|단편\s+정보보다\s+맥락과\s+리스크)/i
    const deduped: string[] = []
    const seen = new Set<string>()
    for (const raw of sentenceLike) {
      let line = raw
      if (boilerplateSentence.test(line)) continue
      line = line.replace(/^영상\s*설명에서는\s*/, '영상 설명에서는 ')
      if (line.length > 180) {
        line = `${line.slice(0, 180).replace(/\s+\S*$/, '').trim()}...`
      }
      const key = line.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (!/[.!?]$/.test(line)) line = `${line}.`
      deduped.push(line)
      if (deduped.length >= maxLines) break
    }

    const selected: string[] = []
    let total = 0
    for (const line of deduped) {
      const next = total + line.length + (selected.length > 0 ? 1 : 0)
      if (next > maxTotalChars) break
      selected.push(line)
      total = next
    }

    if (selected.length > 0) return selected.join('\n').trim()
    return this.clampSummaryLines(cleaned, maxLines, 180, maxTotalChars)
  },

  isLikelyEnglishTranscript(text: string): boolean {
    const sample = (text || '').slice(0, 5000)
    if (!sample) return false
    const hangul = (sample.match(/[가-힣]/g) || []).length
    const latin = (sample.match(/[A-Za-z]/g) || []).length
    if (latin < 40) return false
    const total = hangul + latin
    if (total === 0) return false
    return latin / total >= 0.75
  },

  async translateEnglishTranscriptToKorean(text: string): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY || ''
    if (!apiKey) return null

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
    const chunks = chunkTranscript(text, 1800).slice(0, 6)
    if (chunks.length === 0) return null

    const translatedParts: string[] = []
    for (const chunk of chunks) {
      try {
        const prompt = [
          '다음은 유튜브 자동 생성 영어 자막입니다.',
          '의미를 유지해 자연스러운 한국어 문장으로 번역하세요.',
          '불필요한 면책/저작권/홍보 문구는 제외하고, 본문 내용만 번역하세요.',
          '',
          chunk,
        ].join('\n')

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
            }),
          }
        )

        if (!response.ok) {
          const errText = await response.text()
          console.warn('[summary] transcript translation failed:', response.status, errText)
          continue
        }

        const data = await response.json()
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text
        if (typeof out === 'string' && out.trim()) {
          translatedParts.push(out.trim())
        }
      } catch (error) {
        console.warn('[summary] transcript translation error:', error)
      }
    }

    if (translatedParts.length === 0) return null
    return cleanTranscript(translatedParts.join('\n'))
  },

  stripBoilerplateSentences(text: string): string {
    const source = (text || '').trim()
    if (!source) return ''
    const hasKorean = /[가-힣]/.test(source)
    const blocks = source
      .split(/(?<=[.!?])\s+|\n+/)
      .map((part) => part.trim())
      .filter(Boolean)

    const boilerplatePattern = new RegExp(
      `${DISCLAIMER_SENTENCE_PATTERN.source}|contact.*@|sharing\\s+of\\s+ideas`,
      'i'
    )
    const filtered = blocks.filter((part) => {
      if (boilerplatePattern.test(part)) return false
      // 한국어 요약에서 끼어드는 영어 고지 문장을 제거
      if (hasKorean && !/[가-힣]/.test(part) && /[a-z]/i.test(part) && part.length >= 24) return false
      return true
    })

    return filtered.join(' ').trim()
  },

  sanitizeSummaryText(text: string): string {
    return this.stripBoilerplateSentences((text || '')
      .replace(/(?:\bthe\b\s*-\s*){1,}/gi, ' ')
      // Remove boilerplate translation/copyright disclaimers often injected by external summary pages.
      .replace(/\btranslated\s+by\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:a\s+)?disclaimer\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:copyright|저작권)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bwe\s+check\s+the\s+copyright\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bwe\s+check\s+the\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bthe\s*-\s*we\s+check\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bthe\s+korean\s+subtitles?\s+of\s+the\s+video\s+were\s+added\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bwithin\s+the\s+scope\s+of\s+not\s+distorting\s+the\s+contents?\s+of\s+the\s+original\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bthe\s+purpose\s+of\s+this\s+video\s+is\s+only\s+for\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:for\s+educational\s+purposes\s+only|for\s+the\s+public\s+good)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:motivation|sharing\s+of\s+ideas)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:copyright\s+of\s+the\s+original\s+video\s+belongs\s+to\s+the\s+original\s+copyright\s+holder)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\b(?:there\s+is\s+no\s+revenue\s+generated\s+through\s+youtube\s+at\s+all)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/\bif\s+you[^.\n]*(?:correction|corrections|correct|fix)[^.\n]*[.\n]?/gi, ' ')
      // Remove common production credits/contact/social tails that pollute summaries.
      .replace(/\[[^\]]*(?:편집|촬영|자막|BGM|음원|협찬)[^\]]*\]/gi, ' ')
      .replace(/\bwith\s+[a-z0-9._-]+\b/gi, ' ')
      .replace(/\b(?:instagram|insta|kakaotalk|kakao\s*talk|email|mail|문의|섭외)\b[^.\n]*[.\n]?/gi, ' ')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
      .replace(/(?:강연|방송)\s*섭외\s*문의[^.\n]*[.\n]?/gi, ' ')
      .replace(/:[)D]|;\)|:-\)|:D/gi, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/#[^\s#]+/g, ' ')
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
      .replace(/(구독(하기)?|좋아요|알림\s*설정|댓글|공유)\s*(을|도)?\s*(눌러|부탁|해|해주세요|부탁드립니다)?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !DISCLAIMER_SENTENCE_PATTERN.test(s))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  },

  clampSummaryLines(text: string, maxLines = 5, maxLineLength = 180, maxTotalChars = 500): string {
    const normalized = this.sanitizeSummaryText(text)
    if (!normalized) return ''

    let units = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    // If model output is one overlong sentence, split by sentence punctuation first.
    if (units.length <= 1) {
      units = normalized
        .split(/(?<=[.!?])\s+/)
        .map((line) => line.trim())
        .filter(Boolean)
    }

    const normalizedUnits = units
      .map((line) => {
        let out = line.replace(/\s+/g, ' ').trim()
        if (!out) return ''
        if (!/[.!?]$/.test(out)) out = `${out}.`
        if (out.length > maxLineLength) {
          out = `${out.slice(0, maxLineLength).replace(/\s+\S*$/, '').trim()}...`
        }
        return out
      })
      .filter(Boolean)

    const selected: string[] = []
    let total = 0
    for (const line of normalizedUnits) {
      if (selected.length >= maxLines) break
      const nextTotal = total + line.length + (selected.length > 0 ? 1 : 0)
      if (nextTotal > maxTotalChars) break
      selected.push(line)
      total = nextTotal
    }

    if (selected.length > 0) return selected.join('\n').trim()
    const fallback = normalized.slice(0, maxTotalChars).replace(/\s+\S*$/, '').trim()
    return fallback ? `${fallback}...` : ''
  },

  isSparseSummary(text: string): boolean {
    const trimmed = (text || '').trim()
    if (!trimmed) return true
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean)
    return lines.length < 4 || trimmed.length < 280
  },

  buildExpandedDescriptionSummary(title: string, description: string): string {
    const cleanTitle = (title || '')
      .replace(/\[[^\]]+\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const cleanDescription = this.sanitizeSummaryText(description || '')

    const descriptionSnippet = cleanDescription
      ? (cleanDescription.length > 180
        ? `${cleanDescription.slice(0, 180).replace(/\s+\S*$/, '')}...`
        : cleanDescription)
      : ''

    const lines = [
      `${cleanTitle || '이 영상'}를 중심으로 핵심 질문과 판단 포인트를 정리합니다.`,
      descriptionSnippet
        ? `영상 설명에서는 ${descriptionSnippet.replace(/[.!?]$/, '')}를 다룹니다.`
        : '영상 설명 정보가 제한적이어서 제목에 드러난 주제를 중심으로 내용을 재구성했습니다.',
      '핵심 내용은 단일 결론을 제시하기보다 조건별로 쟁점을 나누어 이해하도록 돕는 데 있습니다.',
      '시청자는 자신의 상황에 맞춰 확인해야 할 기준과 우선순위를 점검할 수 있습니다.',
      '결론적으로 단기적인 단편 정보보다 맥락과 리스크를 함께 보라는 실용적인 메시지를 전달합니다.',
    ]

    return this.clampSummaryLines(formatSummaryText(lines.join(' '), 5), 5, 180, 500)
  },

  ensureDescriptionSummaryQuality(summary: string, title: string, description: string): string {
    const sanitized = this.sanitizeSummaryText(summary)
    let normalized = formatSummaryText(sanitized, 5)

    if (this.isSparseSummary(normalized)) {
      const expanded = this.buildExpandedDescriptionSummary(title, description)
      if (expanded) normalized = formatSummaryText(`${normalized}\n${expanded}`, 5)
    }

    const ensured = ensureKoreanSummary(normalized, `${title} ${description}`, 5) || normalized
    return this.finalizeSummaryText(ensured, 5, 500)
  },

  ensureTranscriptSummaryQuality(
    summary: string,
    heuristicFromTranscript: string,
    title: string,
    description: string
  ): string {
    const sanitized = this.sanitizeSummaryText(summary)
    let normalized = formatSummaryText(sanitized, 5)

    if (this.isSparseSummary(normalized)) {
      const heuristicSanitized = this.sanitizeSummaryText(heuristicFromTranscript)
      const merged = `${normalized}\n${formatSummaryText(heuristicSanitized, 5)}`.trim()
      normalized = formatSummaryText(merged, 5)
    }

    const ensured = ensureKoreanSummary(normalized, `${title} ${description}`, 5) || normalized
    return this.finalizeSummaryText(ensured, 5, 500)
  },

  isExternalSummaryPreferred(): boolean {
    // 기본값은 transcript 우선. 외부 요약은 fallback 보조로만 사용.
    return (process.env.EXTERNAL_SUMMARY_PRIORITY || 'false').toLowerCase() === 'true'
  },

  isChunkedSummarizationEnabled(): boolean {
    return (process.env.CHUNK_SUMMARY_ENABLED || 'true').toLowerCase() !== 'false'
  },

  chunkSummarizationThreshold(): number {
    return Number(process.env.CHUNK_SUMMARY_THRESHOLD || '7000')
  },

  chunkSize(): number {
    return Number(process.env.CHUNK_SUMMARY_CHUNK_SIZE || '1800')
  },

  chunkLimit(): number {
    return Number(process.env.CHUNK_SUMMARY_MAX_CHUNKS || '6')
  },
  isDescriptionFallbackEnabled(): boolean {
    return (process.env.ALLOW_DESCRIPTION_FALLBACK || 'true').toLowerCase() !== 'false'
  },

  extractExternalSummaryFromHtml(html: string): string | null {
    if (!html) return null
    const candidates = [
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1],
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1],
      html.match(/"description"\s*:\s*"([^"]+)"/i)?.[1],
      html.match(/<p[^>]*>([^<]{80,})<\/p>/i)?.[1],
    ]
    const picked = candidates.find((v) => typeof v === 'string' && v.trim().length > 40)
    if (!picked) return null
    const decoded = picked
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
    if (decoded.length < 40) return null
    if (this.isLowQualityExternalSummary(decoded)) return null
    return decoded
  },

  isLowQualityExternalSummary(text: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!normalized) return true
    const badPhrases = [
      '요약 생성에 실패',
      '자막이 없어 ai 요약을 생성할 수 없습니다',
      '분석 중',
      '콘텐츠를 준비 중',
      '오류가 발생했습니다',
      'loading',
      '유튜브 영상의 자막과 스크립트를 쉽게 추출하고 복사',
      '로그인',
      '회원가입',
      '무료로 시작',
      '서비스 소개',
      'the purpose of this video is only for',
      'for educational purposes only',
      'for the public good',
      'sharing of ideas',
      'copyright of the original video belongs to the original copyright holder',
      'the korean subtitles of the video were added',
    ]
    return badPhrases.some((phrase) => normalized.includes(phrase))
  },

  isRelevantToVideo(text: string, title: string, description: string): boolean {
    const source = `${title || ''} ${description || ''}`.toLowerCase()
    const candidate = text.toLowerCase()
    const tokens = source
      .replace(/[^0-9a-z가-힣\s]/gi, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .filter((t) => !/^(the|and|for|with|this|that|영상|유튜브|채널|뉴스|대한|에서|으로|하는|입니다)$/.test(t))

    if (tokens.length === 0) return true
    const overlap = tokens.filter((token) => candidate.includes(token))
    return overlap.length >= Math.min(2, Math.max(1, Math.floor(tokens.length * 0.12)))
  },

  async fetchSummarizeTechSummary(videoId: string): Promise<string | null> {
    if ((process.env.SUMMARIZE_TECH_FALLBACK || 'true').toLowerCase() === 'false') return null

    const candidates = [
      `https://www.summarize.tech/${videoId}`,
      `https://www.summarize.tech/www.youtube.com/watch?v=${videoId}`,
    ]

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; YT-Digest/1.0)',
            accept: 'text/html,application/xhtml+xml',
          },
        })
        if (!res.ok) continue
        const html = await res.text()
        if (!html) continue

        const extracted = this.extractExternalSummaryFromHtml(html)
        if (!extracted) continue
        return extracted
      } catch (error) {
        console.warn('[summary] summarize.tech fetch failed:', error)
      }
    }
    return null
  },

  async fetchBriefYouSummary(videoId: string): Promise<string | null> {
    if ((process.env.BRIEFYOU_FALLBACK || 'true').toLowerCase() === 'false') return null

    const candidates = [
      // 사이트 안내된 asd 도메인 패턴 (가장 우선)
      `https://www.youtubeasd.com/watch?v=${videoId}`,
      // 공식 결과 페이지 패턴
      `https://briefyou.co.kr/youtube-analysis-result/${videoId}`,
    ]

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          cache: 'no-store',
          headers: {
            'user-agent': 'Mozilla/5.0 (compatible; YT-Digest/1.0)',
            accept: 'text/html,application/xhtml+xml',
          },
        })
        if (!res.ok) continue
        const html = await res.text()
        const extracted = this.extractExternalSummaryFromHtml(html)
        if (!extracted) continue
        if (this.isLowQualityExternalSummary(extracted)) continue
        return extracted
      } catch (error) {
        console.warn('[summary] briefyou fetch failed:', error)
      }
    }

    return null
  },

  async generateExternalSummary(
    videoId: string,
    title: string,
    description: string
  ): Promise<{ text: string; sourceType: 'external' } | null> {
    const external =
      await this.fetchBriefYouSummary(videoId) ||
      await this.fetchSummarizeTechSummary(videoId)
    if (!external) return null

    const formatted = this.ensureDescriptionSummaryQuality(external, title, description)
    const ensured = ensureKoreanSummary(formatted, `${title} ${description}`, 5) || formatted
    if (!ensured) return null
    if (this.isSparseSummary(ensured)) return null
    if (this.isLowQualityExternalSummary(ensured)) return null
    if (!this.isRelevantToVideo(ensured, title, description)) {
      console.warn(`[summary] external summary rejected as irrelevant: ${videoId}`)
      return null
    }

    await videoRepository.updateSummary(videoId, ensured, 'external', 'complete')
    return { text: ensured, sourceType: 'external' }
  },

  /**
   * Generate or fetch summary for a video
   *
   * ✅ 수정: 파라미터 순서 통일
   *   (videoId, title, description, useTranscriptPipeline, forceRefresh)
   *   기존엔 forceRefresh와 useTranscriptPipeline 순서가 뒤바뀌어 있었음
   */
  async getSummary(
    videoId: string,
    title: string,
    description: string,
    useTranscriptPipeline = true,
    forceRefresh = false
  ): Promise<{ text: string; sourceType: 'transcript' | 'description' | 'external' } | null> {
    try {
      const video = await videoRepository.getByYouTubeId(videoId)

      // 이미 완성된 transcript 요약이 있으면 바로 반환
      if (
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        (video.summary_source_type === 'transcript' || video.summary_source_type === 'external')
      ) {
        return {
          text: video.summary_text || '',
          sourceType: (video.summary_source_type || 'transcript') as 'transcript' | 'external',
        }
      }

      // description 요약만 있고 파이프라인이 켜져 있으면 transcript로 업그레이드 시도
      if (
        useTranscriptPipeline &&
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'description'
      ) {
        if (video.transcript_text) {
          const upgrade = await this.generateTranscriptSummary(videoId, video.transcript_text)
          if (upgrade) return upgrade
        }
        return { text: video.summary_text || '', sourceType: 'description' }
      }

      // 파이프라인 꺼져 있고 description 요약 있으면 반환
      if (
        !useTranscriptPipeline &&
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'description'
      ) {
        return { text: video.summary_text || '', sourceType: 'description' }
      }

      // transcript는 있는데 요약이 없거나 refresh 필요한 경우
      if (video?.transcript_text && video.transcript_status === 'extracted') {
        const direct = await this.generateTranscriptSummary(videoId, video.transcript_text)
        if (direct) return direct
      }

      // 캐시 없음 또는 forceRefresh → 전체 파이프라인 실행
      return await this.generateNewSummary(videoId, title, description, useTranscriptPipeline)
    } catch (error) {
      console.error('Error getting summary:', error)
      return null
    }
  },

  /**
   * 새 요약 생성: transcript 우선, 실패 시 실패 메시지 저장
   */
  async generateNewSummary(
    videoId: string,
    title: string,
    description: string,
    useTranscriptPipeline = true
  ): Promise<{ text: string; sourceType: 'transcript' | 'description' | 'external' } | null> {
    try {
      const preferExternal = this.isExternalSummaryPreferred()
      const fallbackToDescription = async () => {
        const external = await this.generateExternalSummary(videoId, title, description)
        if (external) return external
        // Safety fallback: keep the card usable even when transcript/external sources fail.
        return this.generateDescriptionSummary(videoId, title, description)
      }

      // Prefer external summaries (briefyou -> summarize.tech) before transcript pipeline when enabled.
      if (preferExternal) {
        const externalFirst = await this.generateExternalSummary(videoId, title, description)
        if (externalFirst) return externalFirst
      }

      const transcriptProvider = getTranscriptProvider()
      const existing = await videoRepository.getByYouTubeId(videoId)

      let transcript: string | null = existing?.transcript_text || null

      // transcript가 아직 없으면 추출 시도
      if (!transcript && useTranscriptPipeline) {
        if (transcriptProvider.isAvailable()) {
          console.log(`[summary] extracting transcript for ${videoId} via ${transcriptProvider.getName()}`)
          await videoRepository.updateTranscript(videoId, '', 'pending')

          try {
            const result = await transcriptProvider.fetchTranscript(videoId)
            if (result.status === 'READY' && result.text) {
              transcript = cleanTranscript(result.text)
              await videoRepository.updateTranscript(videoId, transcript, 'extracted')
            } else {
              const status = result.status === 'NOT_AVAILABLE' ? 'not_available' : 'failed'
              await videoRepository.updateTranscript(videoId, '', status)
            }
          } catch (err) {
            console.error('[summary] transcript extraction error:', err)
            await videoRepository.updateTranscript(videoId, '', 'failed')
          }
        } else {
          console.warn('[summary] no transcript provider available')
          await videoRepository.updateTranscript(videoId, '', 'failed')
        }
      }

      // transcript 없으면 실패 처리
      if (!transcript) {
        return await fallbackToDescription()
      }

      // transcript 있으면 요약 생성
      const transcriptSummary = await this.generateTranscriptSummary(videoId, transcript)
      if (transcriptSummary) return transcriptSummary

      const external = await this.generateExternalSummary(videoId, title, description)
      if (external) return external
      return await this.generateDescriptionSummary(videoId, title, description)
    } catch (error) {
      console.error('[summary] Error generating new summary:', error)
      return null
    }
  },

  async generateDescriptionSummary(
    videoId: string,
    title: string,
    description: string
  ): Promise<{ text: string; sourceType: 'description' }> {
    const sourceText = [title, description].filter(Boolean).join('\n').trim()
    const local = getLocalSummarizer()
    let summary: string | null = null

    if (local.isAvailable()) {
      try {
        summary = await local.summarize(sourceText, 180)
      } catch (error) {
        console.error('[summary] local description summarizer failed:', error)
      }
    }

    if (!summary) {
      summary = await new DescriptionBasedSummarizer().summarize(sourceText, 180)
    }

    const fallbackText = summary || sourceText || '요약을 생성할 수 없습니다'
    const qualityEnsured = this.ensureDescriptionSummaryQuality(fallbackText, title, description)

    await videoRepository.updateSummary(
      videoId,
      qualityEnsured,
      'description',
      qualityEnsured ? 'complete' : 'failed'
    )

    return { text: qualityEnsured, sourceType: 'description' }
  },

  /**
   * transcript 문자열로 요약 생성 후 DB 저장
   *
   * ✅ 수정: 기존엔 getLocalSummarizer()를 선언만 하고
   *          실제 summarizer.summarize()를 호출하지 않았음
   */
  async generateTranscriptSummary(
    videoId: string,
    transcript: string
  ): Promise<{ text: string; sourceType: 'transcript' } | null> {
    try {
      const cleanedTranscript = cleanTranscript(transcript)
      const translatedTranscript = this.isLikelyEnglishTranscript(cleanedTranscript)
        ? await this.translateEnglishTranscriptToKorean(cleanedTranscript)
        : null
      const transcriptForSummary = translatedTranscript || cleanedTranscript

      if (!transcriptForSummary) {
        const message = '자막 본문을 정리하지 못했습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' }
      }
      const contextVideo = await videoRepository.getByYouTubeId(videoId)
      let summary: string | null = null

      let summarizer: ReturnType<typeof getLocalSummarizer> | null = null
      if (!summary) {
        summarizer = getLocalSummarizer()
        if (summarizer.isAvailable()) {
          console.log(`[summary] summarizing ${videoId} with ${summarizer.getName()}`)
          const shouldChunk =
            this.isChunkedSummarizationEnabled() &&
            transcriptForSummary.length >= this.chunkSummarizationThreshold()

          if (shouldChunk) {
            const chunks = chunkTranscript(transcriptForSummary, this.chunkSize()).slice(0, this.chunkLimit())
            const chunkSummaries: string[] = []

            for (const chunk of chunks) {
              const partial = await summarizer.summarize(chunk, 160)
              if (partial) {
                chunkSummaries.push(formatSummaryText(partial, 2))
              } else {
                chunkSummaries.push(formatSummaryText(buildHeuristicSummary(chunk, 2), 2))
              }
            }

            const mergedChunkSummary = chunkSummaries.join('\n')
            summary = await summarizer.summarize(mergedChunkSummary, 220)
            if (!summary) {
              summary = formatSummaryText(mergedChunkSummary, 5)
            }
          } else {
            summary = await summarizer.summarize(transcriptForSummary, 200)
          }
        } else {
          console.warn('[summary] summarizer not available')
        }
      }

      if (!summary && summarizer && !(summarizer instanceof HeuristicTranscriptSummarizer)) {
        console.warn('[summary] primary summarizer failed, falling back to heuristic transcript summary')
        summary = await new HeuristicTranscriptSummarizer().summarize(transcriptForSummary, 200)
      }

      const heuristicSummary = formatSummaryText(buildHeuristicSummary(transcriptForSummary, 5), 5)
      const formattedSummaryRaw = summary
        ? formatSummaryText(summary, 5)
        : heuristicSummary
      const robustSummaryRaw =
        formattedSummaryRaw.split('\n').filter(Boolean).length >= 2
          ? formattedSummaryRaw
          : formatSummaryText(`${formattedSummaryRaw}\n${heuristicSummary}`, 5)
      const formattedSummary = ensureKoreanSummary(
        robustSummaryRaw,
        `${contextVideo?.title || ''} ${contextVideo?.description || ''} ${transcriptForSummary.slice(0, 500)}`,
        5
      )
      const stabilizedSummary = formattedSummary
        ? this.ensureTranscriptSummaryQuality(
            formattedSummary,
            heuristicSummary,
            contextVideo?.title || '',
            contextVideo?.description || ''
          )
        : ''
      const reinforcedSummary = (() => {
        if (!stabilizedSummary || !this.isSparseSummary(stabilizedSummary)) return stabilizedSummary
        const reinforcedHeuristic = formatSummaryText(buildHeuristicSummary(transcriptForSummary, 6), 5)
        const merged = formatSummaryText(`${stabilizedSummary}\n${reinforcedHeuristic}`, 5)
        const ensuredMerged = ensureKoreanSummary(
          merged,
          `${contextVideo?.title || ''} ${contextVideo?.description || ''} ${transcriptForSummary.slice(0, 2500)}`,
          5
        )
        return this.ensureTranscriptSummaryQuality(
          ensuredMerged,
          reinforcedHeuristic,
          contextVideo?.title || '',
          contextVideo?.description || ''
        )
      })()

      if (reinforcedSummary) {
        await videoRepository.updateTranscript(videoId, transcriptForSummary, 'extracted')
        await videoRepository.updateSummary(videoId, reinforcedSummary, 'transcript', 'complete')
        return { text: reinforcedSummary, sourceType: 'transcript' }
      } else {
        const fallbackFromDescriptionRaw = heuristicSummary
        const fallbackFromDescription = ensureKoreanSummary(
          fallbackFromDescriptionRaw,
          `${contextVideo?.title || ''} ${contextVideo?.description || ''}`,
          5
        )
        const stabilizedFallback = fallbackFromDescription
          ? this.ensureTranscriptSummaryQuality(
              fallbackFromDescription,
              heuristicSummary,
              contextVideo?.title || '',
              contextVideo?.description || ''
            )
          : ''

        if (stabilizedFallback) {
          await videoRepository.updateTranscript(videoId, transcriptForSummary, 'extracted')
          await videoRepository.updateSummary(videoId, stabilizedFallback, 'transcript', 'complete')
          return { text: stabilizedFallback, sourceType: 'transcript' }
        }

        const message = '요약을 생성할 수 없습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' }
      }
    } catch (error) {
      console.error('[summary] Error summarizing transcript:', error)
      return null
    }
  },

  /**
   * 여러 영상 일괄 요약
   */
  async batchSummarize(
    videos: Array<{ id: string; title: string; description: string }>,
    forceRefresh = false
  ): Promise<Map<string, { text: string; sourceType: 'transcript' | 'description' | 'external' }>> {
    const summaries = new Map()
    for (const video of videos) {
      const summary = await this.getSummary(video.id, video.title, video.description, true, forceRefresh)
      if (summary) summaries.set(video.id, summary)
    }
    return summaries
  },

  /**
   * 대기 중인 영상들을 순차적으로 요약 처리
   */
  async processPendingSummaries(): Promise<void> {
    const pending = await videoRepository.getPendingSummaries()
    if (pending.length === 0) return

    console.log(`[summary-worker] Processing ${pending.length} pending summaries`)

    for (const video of pending) {
      await videoRepository.updateSummaryStatus(video.youtube_video_id, 'processing')
      try {
        await this.generateNewSummary(video.youtube_video_id, video.title, video.description, true)
      } catch (err) {
        console.error(`[summary-worker] Failed for ${video.youtube_video_id}:`, err)
        await videoRepository.updateSummaryStatus(video.youtube_video_id, 'failed')
      }
    }
  },

  getTranscriptProviderInfo() {
    if (typeof window !== 'undefined') return { name: 'client (unknown)', available: false }
    const provider = getTranscriptProvider()
    return { name: provider.getName(), available: provider.isAvailable() }
  },

  getSummarizerInfo() {
    const summarizer = getLocalSummarizer()
    return { name: summarizer.getName(), available: summarizer.isAvailable() }
  },
}
