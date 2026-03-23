/**
 * Gemini-based summarization service
 * Uses Google Generative AI to summarize transcripts
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { chunkTranscript, cleanTranscript, isTranscriptTooShort } from '@/lib/utils/transcript'
import { logger } from '@/lib/logger'

const API_KEY = process.env.GEMINI_API_KEY

export interface GeminiSummarizerConfig {
  maxSummaryLength?: number
  language?: string
}

export const geminiSummarizer = {
  /**
   * Check if Gemini API is configured
   */
  isAvailable(): boolean {
    return !!API_KEY?.trim()
  },

  /**
   * Summarize transcript using Gemini
   * Works with long transcripts by chunking + combining
   */
  async summarizeTranscript(
    text: string,
    config: GeminiSummarizerConfig = {}
  ): Promise<string | null> {
    if (!this.isAvailable()) {
      logger.warn('Gemini API not configured (GEMINI_API_KEY not set)')
      return null
    }

    try {
      const cleaned = cleanTranscript(text)

      if (isTranscriptTooShort(cleaned)) {
        return cleaned
      }

      const client = new GoogleGenerativeAI(API_KEY!)
      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' })

      // For short transcripts, summarize directly
      if (cleaned.length < 1000) {
        return await this.summarizeChunk(model, cleaned, config)
      }

      // For longer transcripts, chunk + summarize each, then combine
      const chunks = chunkTranscript(cleaned, 1500)

      if (chunks.length === 1) {
        return await this.summarizeChunk(model, chunks[0], config)
      }

      // Summarize each chunk
      const summaries = await Promise.all(chunks.map((chunk) => this.summarizeChunk(model, chunk, config)))

      // Combine summaries
      const combined = summaries.filter((s): s is string => s !== null).join(' ')

      if (combined.length > 500) {
        // If combined summary is still long, summarize again
        return await this.summarizeChunk(model, combined, config)
      }

      return combined
    } catch (error) {
      logger.error('Error summarizing with Gemini:', error)
      return null
    }
  },

  /**
   * Summarize a single chunk
   */
  async summarizeChunk(
    model: any,
    chunk: string,
    config: GeminiSummarizerConfig
  ): Promise<string | null> {
    try {
      const language = config.language || 'Korean'
      const prompt = `Please summarize the following video transcript in 1-2 sentences in ${language}. 
Make it concise and suitable for a video card UI. 
Focus on the main topic and key points.

Transcript:
${chunk}`

      const result = await model.generateContent(prompt)
      const text = result.response.text()

      return text ? text.trim() : null
    } catch (error) {
      logger.error('Error summarizing chunk:', error)
      return null
    }
  },
}
