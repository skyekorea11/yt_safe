import { getTranscriptProvider } from '@/lib/transcript/transcript-provider'
import { DescriptionBasedSummarizer, getLocalSummarizer, HeuristicTranscriptSummarizer } from '@/lib/summarization/local-summarizer'
import { videoRepository } from '@/lib/supabase/videos'
import { buildHeuristicSummary, chunkTranscript, cleanTranscript, ensureKoreanSummary, formatSummaryText } from '@/lib/utils/transcript'

/**
 * Summary service orchestrates transcript extraction and summarization
 */

export const summaryService = {
  isExternalSummaryPreferred(): boolean {
    return (process.env.EXTERNAL_SUMMARY_PRIORITY || 'true').toLowerCase() !== 'false'
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
    return process.env.ALLOW_DESCRIPTION_FALLBACK === 'true'
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

    const formatted = formatSummaryText(external, 3)
    const ensured = ensureKoreanSummary(formatted, `${title} ${description}`, 3) || formatted
    if (!ensured) return null
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
      const allowDescriptionFallback = this.isDescriptionFallbackEnabled()
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
        if (allowDescriptionFallback) {
          return { text: video.summary_text || '', sourceType: 'description' }
        }
      }

      // 파이프라인 꺼져 있고 description 요약 있으면 반환
      if (
        !useTranscriptPipeline &&
        video &&
        !forceRefresh &&
        video.summary_status === 'complete' &&
        video.summary_source_type === 'description'
      ) {
        if (allowDescriptionFallback) {
          return { text: video.summary_text || '', sourceType: 'description' }
        }
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
      const allowDescriptionFallback = this.isDescriptionFallbackEnabled()
      const preferExternal = this.isExternalSummaryPreferred()
      const fallbackToDescription = async () => {
        const external = await this.generateExternalSummary(videoId, title, description)
        if (external) return external
        if (allowDescriptionFallback) {
          return this.generateDescriptionSummary(videoId, title, description)
        }
        const message = '자막/외부 요약을 확보하지 못했습니다'
        await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
        return { text: message, sourceType: 'transcript' as const }
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
      if (allowDescriptionFallback) {
        return await this.generateDescriptionSummary(videoId, title, description)
      }
      const message = '자막/외부 요약을 확보하지 못했습니다'
      await videoRepository.updateSummary(videoId, message, 'transcript', 'failed')
      return { text: message, sourceType: 'transcript' as const }
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
    const formatted = formatSummaryText(fallbackText, 3)
    const ensured = ensureKoreanSummary(formatted, `${title} ${description}`, 3) || formatted

    await videoRepository.updateSummary(
      videoId,
      ensured,
      'description',
      ensured ? 'complete' : 'failed'
    )

    return { text: ensured, sourceType: 'description' }
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

      if (!cleanedTranscript) {
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
            cleanedTranscript.length >= this.chunkSummarizationThreshold()

          if (shouldChunk) {
            const chunks = chunkTranscript(cleanedTranscript, this.chunkSize()).slice(0, this.chunkLimit())
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
              summary = formatSummaryText(mergedChunkSummary, 3)
            }
          } else {
            summary = await summarizer.summarize(cleanedTranscript, 200)
          }
        } else {
          console.warn('[summary] summarizer not available')
        }
      }

      if (!summary && summarizer && !(summarizer instanceof HeuristicTranscriptSummarizer)) {
        console.warn('[summary] primary summarizer failed, falling back to heuristic transcript summary')
        summary = await new HeuristicTranscriptSummarizer().summarize(cleanedTranscript, 200)
      }

      const heuristicSummary = formatSummaryText(buildHeuristicSummary(cleanedTranscript, 3), 3)
      const formattedSummaryRaw = summary
        ? formatSummaryText(summary, 3)
        : heuristicSummary
      const robustSummaryRaw =
        formattedSummaryRaw.split('\n').filter(Boolean).length >= 2
          ? formattedSummaryRaw
          : formatSummaryText(`${formattedSummaryRaw}\n${heuristicSummary}`, 3)
      const formattedSummary = ensureKoreanSummary(
        robustSummaryRaw,
        `${contextVideo?.title || ''} ${contextVideo?.description || ''} ${cleanedTranscript.slice(0, 500)}`,
        3
      )

      if (formattedSummary) {
        await videoRepository.updateTranscript(videoId, cleanedTranscript, 'extracted')
        await videoRepository.updateSummary(videoId, formattedSummary, 'transcript', 'complete')
        return { text: formattedSummary, sourceType: 'transcript' }
      } else {
        const fallbackFromDescriptionRaw = heuristicSummary
        const fallbackFromDescription = ensureKoreanSummary(
          fallbackFromDescriptionRaw,
          `${contextVideo?.title || ''} ${contextVideo?.description || ''}`,
          3
        )

        if (fallbackFromDescription) {
          await videoRepository.updateTranscript(videoId, cleanedTranscript, 'extracted')
          await videoRepository.updateSummary(videoId, fallbackFromDescription, 'transcript', 'complete')
          return { text: fallbackFromDescription, sourceType: 'transcript' }
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
