// Rate limiting: minimum 8s between Gemini requests
let lastGeminiRequestTime = 0

/**
 * Abstract local summarizer interface
 * Implementations should summarize text using different local LLM approaches:
 * - Ollama with models like llama2, mistral
 * - LM Studio with quantized models
 * - LangChain with transformers
 * - CustomHTTP services
 */

export interface LocalSummarizer {
  /**
   * Summarize text using a locally available LLM
   * Returns a summary string or null if unavailable
   * 
   * @param text Text to summarize
   * @param maxLength Maximum length of summary (optional)
   */
  summarize(text: string, maxLength?: number): Promise<string | null>

  /**
   * Check if summarizer is configured and available
   */
  isAvailable(): boolean

  /**
   * Get summarizer name for logging/debugging
   */
  getName(): string
}

/**
 * No-op summarizer - always returns null
 * Used as a fallback when no real summarizer is configured
 */
export class NoOpLocalSummarizer implements LocalSummarizer {
  summarize(): Promise<null> {
    return Promise.resolve(null)
  }

  isAvailable(): boolean {
    return false
  }

  getName(): string {
    return 'NoOp (Disabled)'
  }
}

/**
 * Gemini-based summarizer using Google's Generative AI API
 * Requires GEMINI_API_KEY environment variable
 * Models: gemini-1.5-flash, gemini-1.5-pro
 */
export class GeminiSummarizer implements LocalSummarizer {
  private apiKey: string
  private model: string

  constructor(apiKey = process.env.GEMINI_API_KEY || '', model = 'gemini-2.5-flash-lite') {
    this.apiKey = apiKey
    this.model = model
  }

  async summarize(text: string, _maxLength = 200): Promise<string | null> {
    if (!this.apiKey) {
      console.warn('Gemini API key not configured')
      return null
    }

    const { cleanTranscript, buildGeminiTranscriptContext, isTranscriptTooShort } = await import('@/lib/utils/transcript')
    const cleaned = cleanTranscript(text)

    if (isTranscriptTooShort(cleaned)) return cleaned || null

    // Preserve intro/body/outro context so the summary captures the full narrative.
    const input = buildGeminiTranscriptContext(cleaned, 12000)

    // Rate limiting: 최소 8초 간격
    const elapsed = Date.now() - lastGeminiRequestTime
    if (elapsed < 8000) {
      await new Promise(r => setTimeout(r, 8000 - elapsed))
    }
    lastGeminiRequestTime = Date.now()

    const systemInstruction = [
      '당신은 유튜브 영상 자막을 한국어로 요약하는 전문가입니다.',
      '다음 규칙을 반드시 따르십시오.',
      '1. 완전한 서술형 문장 3개로 작성한다.',
      '2. 구어체, 반복 표현, 불필요한 세부 예시는 제거한다.',
      '3. 영상 전체의 핵심 메시지 중심으로 정리하며 도입/중반/결론을 균형 있게 반영한다.',
      '4. 객관적이고 간결한 문어체 문체를 사용한다.',
      '5. 번호, 불릿, 타임스탬프 없이 자연스러운 문단으로만 작성한다.',
      '6. 반드시 한국어로만 답한다.',
      '7. 첫 문장은 주제와 문제의식을, 둘째 문장은 핵심 근거/데이터를, 셋째 문장은 결론/시사점을 담는다.',
    ].join(' ')

    // Exponential backoff on 429: up to 3 attempts (delays: 8s, 16s)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delay = 8000 * Math.pow(2, attempt - 1)
        console.warn(`Gemini 429, retrying in ${delay}ms (attempt ${attempt + 1})`)
        await new Promise(r => setTimeout(r, delay))
        lastGeminiRequestTime = Date.now()
      }
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents: [{ role: 'user', parts: [{ text: input }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
            }),
          }
        )
        if (response.status === 429) continue
        if (!response.ok) {
          const errText = await response.text()
          console.error('Gemini API error:', response.status, errText)
          return null
        }
        const data = await response.json()
        const result = data?.candidates?.[0]?.content?.parts?.[0]?.text
        return typeof result === 'string' ? result.trim() : null
      } catch (err) {
        console.error('Gemini summarization error:', err)
        return null
      }
    }
    return null
  }

  isAvailable(): boolean {
    return !!this.apiKey
  }

  getName(): string {
    return `Gemini (${this.model})`
  }
}

/**
 * Ollama-based local summarizer
 * 
 * Requirements:
 * - Ollama must be running: `ollama serve`
 * - A model must be pulled: `ollama pull mistral` or similar
 */
export class OllamaLocalSummarizer implements LocalSummarizer {
  private ollamaUrl: string
  private model: string

  constructor(
    ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434',
    model = process.env.OLLAMA_MODEL || 'llama2'
  ) {
    this.ollamaUrl = ollamaUrl
    this.model = model
  }

  async summarize(text: string, maxLength = 150): Promise<string | null> {
    try {
      const prompt = `다음 내용을 한국어 완전한 문장 2~3개로 자연스럽게 요약해 주세요. 번호나 불릿 없이 문단으로만 답하세요.\n\n${text}`
      const resp = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          max_tokens: maxLength * 2,
          temperature: 0.3,
          stream: false,
        }),
      })
      if (!resp.ok) {
        console.error('Ollama request failed', resp.status, await resp.text())
        return null
      }
      const data = await resp.json()
      const out = data?.response
      if (typeof out === 'string') {
        return out.trim()
      }
      return null
    } catch (err) {
      console.error('Ollama summarization error:', err)
      return null
    }
  }

  isAvailable(): boolean {
    // In cloud runtimes, localhost Ollama is usually not reachable.
    // Only treat Ollama as available when URL is explicitly configured.
    return !!process.env.OLLAMA_URL?.trim()
  }

  getName(): string {
    return `Ollama (${this.model})`
  }
}

/**
 * Fallback summarizer that creates a summary from title + description
 * This always works and requires no external dependencies
 */
export class DescriptionBasedSummarizer implements LocalSummarizer {
  async summarize(text: string, maxLength = 150): Promise<string | null> {
    if (!text || text.length === 0) {
      return null
    }

    // Clean up text: remove extra whitespace, URLs, etc.
    const cleaned = text
      .replace(/https?:\/\/[\S]+/g, '') // Remove URLs
      .replace(/\n\n+/g, '\n') // Remove multiple newlines
      .trim()

    // Take first sentence or first maxLength characters
    let summary = cleaned.split('\n')[0] || cleaned.substring(0, maxLength)

    // Ensure it doesn't exceed maxLength
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength).split(' ').slice(0, -1).join(' ') + '...'
    }

    return summary
  }

  isAvailable(): boolean {
    return true
  }

  getName(): string {
    return 'Description-Based (Local, Always Available)'
  }
}

export class HeuristicTranscriptSummarizer implements LocalSummarizer {
  async summarize(text: string, _maxLength = 200): Promise<string | null> {
    if (!text || text.length === 0) return null

    const { buildHeuristicSummary } = await import('@/lib/utils/transcript')
    const summary = buildHeuristicSummary(text, 3)
    return summary || null
  }

  isAvailable(): boolean {
    return true
  }

  getName(): string {
    return 'Heuristic Transcript (Local, Free Fallback)'
  }
}

/**
 * Placeholder for HTTP-based external summarizer
 * TODO: Implement HTTP summarizer integration
 */
export class HttpSummarizerService implements LocalSummarizer {
  constructor(_serviceUrl: string) {}

  async summarize(_text: string, _maxLength = 150): Promise<string | null> {
    // TODO: Implement HTTP POST to external summarization service
    // 1. POST to {serviceUrl}/summarize with { text, maxLength }
    // 2. Parse response and return { summary }
    console.warn('HttpSummarizerService not yet implemented')
    return null
  }

  isAvailable(): boolean {
    // TODO: Check if HTTP service is accessible
    return false
  }

  getName(): string {
    return 'HTTP Service'
  }
}

/**
 * Get the configured summarizer
 * Priority:
 * 1. Check SUMMARIZER_SERVICE_URL for HTTP service
 * 2. Check Ollama availability
 * 3. Fall back to description-based summarizer (always available)
 */
export function getLocalSummarizer(): LocalSummarizer {
  const geminiKey = process.env.GEMINI_API_KEY

  // Prefer Gemini API if key is available
  if (geminiKey) {
    const gemini = new GeminiSummarizer(geminiKey)
    if (gemini.isAvailable()) {
      console.log('Using Gemini summarizer')
      return gemini
    }
  }

  const serviceUrl = process.env.SUMMARIZER_SERVICE_URL

  if (serviceUrl) {
    console.warn('HTTP summarizer service not yet implemented')
  }

  const ollama = new OllamaLocalSummarizer()
  if (ollama.isAvailable()) {
    console.log('Using Ollama summarizer')
    return ollama
  }

  // Always fall back to description-based summarizer
  console.log('Using heuristic transcript summarizer (fallback)')
  return new HeuristicTranscriptSummarizer()
}
