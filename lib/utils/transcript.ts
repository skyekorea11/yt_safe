/**
 * Transcript preprocessing utilities
 * Cleans transcript text for summarization
 */

/**
 * Clean transcript text:
 * - Remove timestamps
 * - Remove noise tags [Music], [Applause], etc.
 * - Remove duplicate sentences
 * - Normalize whitespace
 */
export function cleanTranscript(text: string): string {
  if (!text) return ''

  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/^WEBVTT[\s\S]*?\n{2,}/i, '')
    .replace(/^\uFEFF/, '')

  // Remove subtitle cue indices and standalone numeric sequence rows.
  cleaned = cleaned.replace(/^\s*\d+\s*$/gm, '')

  // Remove timestamps such as "00:00:01.000 --> 00:00:03.500" or bare [00:00:01].
  cleaned = cleaned.replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?\s+-->\s+\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?.*$/gm, '')
  cleaned = cleaned.replace(/(?:^|\s)[[(]?\d{1,2}:\d{2}(?::\d{2})?[)\]]?(?=\s|$)/g, ' ')

  // Remove common VTT metadata rows and HTML tags.
  cleaned = cleaned.replace(/^(?:Kind|Language|NOTE)[^\n]*$/gim, '')
  cleaned = cleaned.replace(/<[^>]+>/g, ' ')

  // Remove noise tags: [Music], [Applause], etc.
  cleaned = cleaned.replace(/\[[^\]]*(?:music|applause|laugh|sound|silence|music playing|background|noise).*?\]/gi, ' ')

  // Decode a few HTML entities and normalize whitespace early.
  cleaned = cleaned.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  cleaned = cleaned.replace(/\n+/g, ' ')

  // Remove filler words.
  cleaned = cleaned.replace(/\b(um+|uh+|you know|like|i mean|sort of|kind of|basically|literally|actually|right)\b[\s,]*/gi, ' ')

  // Remove common YouTube CTA phrases that pollute summaries.
  cleaned = cleaned.replace(/(구독과\s*좋아요(?:,\s*알림\s*설정(?:까지)?)?\s*(?:부탁(?:드립니다|드려요)?|눌러주세요)?)/gi, ' ')
  cleaned = cleaned.replace(/(시작하기\s*전에\s*구독(?:과)?\s*좋아요[^\s,.!?]*)/gi, ' ')

  // Collapse obvious repeated phrase loops from ASR/VTT overlap.
  cleaned = cleaned.replace(/(.{8,50}?)(?:\s+\1){1,}/g, '$1')
  cleaned = cleaned.replace(/(\b\S+\b)(?:\s+\1){2,}/g, '$1')

  // Normalize whitespace and collapse duplicated punctuation.
  cleaned = cleaned.replace(/\s+/g, ' ')
  cleaned = cleaned.replace(/([.!?])\1+/g, '$1')

  // Remove duplicate sentences.
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  const seen = new Set<string>()
  const uniqueSentences = sentences.filter((s) => {
    const key = s.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Reconstruct as paragraphs (every 4 sentences)
  if (uniqueSentences.length > 4) {
    const paragraphs: string[] = []
    for (let i = 0; i < uniqueSentences.length; i += 4) {
      paragraphs.push(uniqueSentences.slice(i, i + 4).join(' '))
    }
    cleaned = paragraphs.join('\n\n')
  } else {
    cleaned = uniqueSentences.join(' ')
  }

  return cleaned.trim()
}

export function formatSummaryText(text: string, maxSentences = 3): string {
  if (!text) return ''

  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim()

  const sentences = splitSentenceLikeUnits(normalized)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .map(stripLeadingBullet)
    .map(postprocessSummarySentence)
    .map(ensureSentenceEnding)
    .filter(isLikelyCompleteSentence)

  if (sentences.length === 0) {
    return ensureSentenceEnding(postprocessSummarySentence(stripLeadingBullet(normalized)))
  }

  const minSentences = 2
  const takeCount = Math.min(maxSentences, Math.max(minSentences, sentences.length))
  return sentences.slice(0, takeCount).join('\n').trim()
}

function splitSentenceLikeUnits(text: string): string[] {
  const byPunctuation = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
  if (byPunctuation.length > 1) return byPunctuation

  // Fallback 1: split by common Korean sentence endings even without punctuation.
  const byKoreanEndings = text
    .split(/\s+(?=(?:또한|그리고|하지만|그런데|이마저도|다만)\s+)|(?<=(?:입니다|습니다|됩니다|있습니다|없습니다|했다|했다면|한다|된다|있다|없다|있음|없음|남짓))\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15)
  if (byKoreanEndings.length > 1) return byKoreanEndings

  // Fallback 2 for ASR text without sentence punctuation.
  return text
    .split(/\s*(?:;|:|그리고|그런데|하지만|또한)\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 15)
}

function ensureSentenceEnding(sentence: string): string {
  const trimmed = sentence.trim().replace(/\s+/g, ' ')
  if (!trimmed) return ''
  if (/[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function postprocessSummarySentence(sentence: string): string {
  let out = sentence.trim().replace(/\s+/g, ' ')

  // Strip inline bullet symbols that may come from model output.
  out = out.replace(/[✔✓☑][️︎]?\s*/g, ' ')
  out = out.replace(/>>+/g, ' ')
  out = out.replace(/<<+/g, ' ')
  out = out.replace(/^\s*>+\s*/g, '')
  out = out.replace(/\s*>+\s*/g, ' ')

  // Basic punctuation/spacing normalization.
  out = out
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/([,.!?])([^\s])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')

  // Remove obvious repeated words/phrases from ASR artifacts.
  out = out.replace(/(\b\S+\b)(?:\s+\1){1,}/g, '$1')
  out = out.replace(/(.{8,40}?)(?:\s+\1){1,}/g, '$1')

  // Remove noisy lead-ins that frequently pollute summaries.
  out = out.replace(/^(여러분\s*)+/g, '')
  out = out.replace(/^(시작하기\s*전에\s*)+/g, '')

  return out.trim()
}

function stripLeadingBullet(sentence: string): string {
  return sentence
    .replace(/^\s*(?:[-*•]+|[✔✓☑][️︎]?)\s*/g, '')
    .trim()
}

function isLikelyCompleteSentence(sentence: string): boolean {
  if (!sentence) return false
  if (sentence.length < 20 || sentence.length > 260) return false
  if (/(구독|좋아요|알림|시작하기 전에)/i.test(sentence)) return false
  if (/(^\W+$|^[0-9\s]+$)/.test(sentence)) return false
  return true
}

function hasEnoughHangul(text: string): boolean {
  const hangulCount = (text.match(/[가-힣]/g) || []).length
  const letterCount = (text.match(/[A-Za-z가-힣]/g) || []).length
  if (hangulCount >= 10) return true
  if (letterCount === 0) return false
  return hangulCount / letterCount >= 0.2
}

export function ensureKoreanSummary(summaryText: string, contextText = '', maxSentences = 3): string {
  const formatted = formatSummaryText(summaryText, maxSentences)
  if (hasEnoughHangul(formatted)) return formatted

  const contextCandidates = splitSentenceLikeUnits(cleanTranscript(contextText))
    .map(s => s.trim())
    .filter(Boolean)
    .map(postprocessSummarySentence)
    .map(ensureSentenceEnding)
    .filter(isLikelyCompleteSentence)
    .filter(hasEnoughHangul)

  if (contextCandidates.length > 0) {
    const minSentences = 2
    const takeCount = Math.min(maxSentences, Math.max(minSentences, contextCandidates.length >= minSentences ? minSentences : contextCandidates.length))
    return contextCandidates.slice(0, takeCount).join('\n')
  }

  return '요약 결과를 한국어 문장으로 재구성하지 못했습니다.\n요약 다시 생성을 한 번 더 시도해 주세요.'
}

function sentenceScore(sentence: string): number {
  const normalized = sentence.toLowerCase()
  let score = 0

  if (sentence.length >= 45 && sentence.length <= 220) score += 2
  if (/[.!?]$/.test(sentence)) score += 1
  if (/\b(중요|핵심|결론|요약|설명|이유|방법|전략|문제|해결|결과|변화|impact|important|key|summary|because|how|why|result)\b/i.test(normalized)) score += 3
  if (/\d/.test(sentence)) score += 1
  if (/[,:;]/.test(sentence)) score += 1

  return score
}

export function buildHeuristicSummary(text: string, maxSentences = 3): string {
  const cleaned = cleanTranscript(text)
  if (!cleaned) return ''

  const sentences = splitSentenceLikeUnits(cleaned.replace(/\n+/g, ' '))
    .map(sentence => ensureSentenceEnding(sentence))
    .filter(sentence => isLikelyCompleteSentence(sentence))

  if (sentences.length === 0) return ''
  if (sentences.length <= maxSentences) return formatSummaryText(sentences.join(' '), maxSentences)

  const candidates = [
    { index: 0, sentence: sentences[0], score: sentenceScore(sentences[0]) + 2 },
    { index: Math.floor(sentences.length / 2), sentence: sentences[Math.floor(sentences.length / 2)], score: sentenceScore(sentences[Math.floor(sentences.length / 2)]) + 1 },
    { index: sentences.length - 1, sentence: sentences[sentences.length - 1], score: sentenceScore(sentences[sentences.length - 1]) + 1 },
    ...sentences.map((sentence, index) => ({ index, sentence, score: sentenceScore(sentence) })),
  ]

  const deduped = new Map<string, { index: number; sentence: string; score: number }>()
  for (const candidate of candidates) {
    const key = candidate.sentence.toLowerCase()
    const existing = deduped.get(key)
    if (!existing || existing.score < candidate.score) {
      deduped.set(key, candidate)
    }
  }

  const prioritized = [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence)

  const tuned = prioritized.filter(sentence => !/(구독|좋아요|알림|시작하기 전에|구독과 좋아요|알림 설정|구독과 좋아요, 알림)/i.test(sentence))
  const finalSentences = tuned.length > 0 ? tuned : prioritized

  return formatSummaryText(finalSentences.join(' '), maxSentences)
}

/**
 * Check if transcript is critically short
 */
export function isTranscriptTooShort(text: string): boolean {
  const words = text.split(/\s+/).length
  return words < 50
}

/**
 * Chunk transcript for processing
 * Returns chunks if text is too long
 * Otherwise returns single chunk [text]
 */
export function chunkTranscript(text: string, maxChunkLength = 2000): string[] {
  if (text.length <= maxChunkLength) {
    return [text]
  }

  const chunks: string[] = []
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [text]

  let currentChunk = ''

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
      }
      currentChunk = sentence
    } else {
      currentChunk += sentence
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

/**
 * Extract key excerpts from transcript
 * Takes beginning, middle, and end
 */
export function extractKeyExcerpts(text: string, count = 3): string {
  const sentences = text.match(/[^.!?]*[.!?]+/g) || [text]

  if (sentences.length <= count) {
    return text
  }

  const excerpts: string[] = []

  // Beginning
  if (sentences[0]) {
    excerpts.push(sentences[0].trim())
  }

  // Middle
  const middleIndex = Math.floor(sentences.length / 2)
  if (sentences[middleIndex]) {
    excerpts.push(sentences[middleIndex].trim())
  }

  // End
  if (sentences[sentences.length - 1]) {
    excerpts.push(sentences[sentences.length - 1].trim())
  }

  return excerpts.join(' ')
}

/**
 * Select representative sentences from across the transcript.
 * Divides the transcript into `segmentCount` equal-sized segments and picks
 * the highest-scoring sentence from each segment using sentenceScore().
 * Results are returned in document order to preserve narrative flow.
 */
export function selectRepresentativeSentences(text: string, segmentCount = 8): string {
  const rawSentences = text.match(/[^.!?]*[.!?]+/g) || [text]
  const sentences = rawSentences.map(s => s.trim()).filter(s => s.length > 15)

  if (sentences.length === 0) return text
  if (sentences.length <= segmentCount) return sentences.join(' ')

  const segmentSize = Math.ceil(sentences.length / segmentCount)
  const selected: { index: number; sentence: string }[] = []

  for (let seg = 0; seg < segmentCount; seg++) {
    const start = seg * segmentSize
    const end = Math.min(start + segmentSize, sentences.length)
    const segment = sentences.slice(start, end)

    let best = segment[0]
    let bestScore = -Infinity
    let bestLocalIdx = 0

    for (let i = 0; i < segment.length; i++) {
      const score = sentenceScore(segment[i])
      if (score > bestScore) {
        bestScore = score
        best = segment[i]
        bestLocalIdx = i
      }
    }

    selected.push({ index: start + bestLocalIdx, sentence: best })
  }

  return selected
    .sort((a, b) => a.index - b.index)
    .map(item => item.sentence)
    .join(' ')
}

/**
 * Build a richer transcript context for LLM summarization.
 * Keeps intro + representative body + ending so the model does not overfit to the opening section.
 */
export function buildGeminiTranscriptContext(text: string, maxChars = 12000): string {
  const cleaned = cleanTranscript(text).replace(/\n+/g, ' ').trim()
  if (!cleaned) return ''
  if (cleaned.length <= maxChars) return cleaned

  const sentences = splitSentenceLikeUnits(cleaned)
    .map(s => ensureSentenceEnding(postprocessSummarySentence(s)))
    .filter(s => s.length >= 20 && s.length <= 280)

  if (sentences.length === 0) {
    return cleaned.slice(0, maxChars)
  }

  const intro = sentences.slice(0, 3)
  const outro = sentences.slice(-3)
  const representative = selectRepresentativeSentences(cleaned, 14)
    .split(/(?<=[.!?])\s+/)
    .map(s => ensureSentenceEnding(postprocessSummarySentence(s)))
    .filter(s => s.length >= 20 && s.length <= 280)

  const dedup = new Set<string>()
  const merged: string[] = []
  for (const sentence of [...intro, ...representative, ...outro]) {
    const key = sentence.toLowerCase().replace(/[\s,.!?]/g, '')
    if (!key || dedup.has(key)) continue
    dedup.add(key)
    merged.push(sentence)
  }

  const packed = merged.join(' ')
  return packed.length <= maxChars ? packed : packed.slice(0, maxChars)
}

/**
 * Prepare transcript for summarization
 * Clean + chunk if needed
 */
export function prepareTranscriptForSummarization(text: string): {
  cleaned: string
  chunks: string[]
  isShort: boolean
  isTooLong: boolean
} {
  const cleaned = cleanTranscript(text)
  const isShort = isTranscriptTooShort(cleaned)
  const isTooLong = cleaned.length > 3000

  let chunks: string[]
  if (isTooLong) {
    // If very long, use key excerpts instead
    chunks = [extractKeyExcerpts(cleaned)]
  } else {
    chunks = chunkTranscript(cleaned)
  }

  return {
    cleaned,
    chunks,
    isShort,
    isTooLong,
  }
}
