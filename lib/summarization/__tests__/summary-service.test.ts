import { describe, it, expect } from 'vitest'
import { summaryService } from '../summary-service'

describe('summaryService.finalizeSummaryText', () => {
  it('returns empty string for empty input', () => {
    expect(summaryService.finalizeSummaryText('')).toBe('')
    expect(summaryService.finalizeSummaryText('   ')).toBe('')
  })

  it('deduplicates identical sentences', () => {
    const input = '삼성전자 주가가 상승했습니다. 삼성전자 주가가 상승했습니다.'
    const result = summaryService.finalizeSummaryText(input)
    const lines = result.split('\n')
    expect(lines.length).toBe(1)
  })

  it('respects maxLines limit', () => {
    const input = Array.from({ length: 10 }, (_, i) => `문장 ${i + 1}번입니다.`).join(' ')
    const result = summaryService.finalizeSummaryText(input, 3)
    const lines = result.split('\n').filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(3)
  })

  it('respects maxTotalChars limit', () => {
    const input = Array.from({ length: 10 }, (_, i) => `문장 ${i + 1}번입니다.`).join(' ')
    const result = summaryService.finalizeSummaryText(input, 5, 50)
    expect(result.length).toBeLessThanOrEqual(50)
  })

  it('adds period to sentences missing end punctuation', () => {
    const result = summaryService.finalizeSummaryText('마무리 없는 문장')
    expect(result.endsWith('.')).toBe(true)
  })

  it('filters boilerplate sentences', () => {
    const input = '핵심 질문과 판단 포인트를 제시합니다. 실제 뉴스 내용입니다.'
    const result = summaryService.finalizeSummaryText(input)
    expect(result).not.toContain('핵심 질문과 판단 포인트')
    expect(result).toContain('실제 뉴스 내용')
  })
})

describe('summaryService.isLikelyEnglishTranscript', () => {
  it('returns true for mostly English text', () => {
    const english = 'This is an English transcript with lots of Latin characters and words.'
    expect(summaryService.isLikelyEnglishTranscript(english.repeat(20))).toBe(true)
  })

  it('returns false for Korean text', () => {
    const korean = '이것은 한국어 자막입니다. 한글이 많이 포함되어 있습니다.'
    expect(summaryService.isLikelyEnglishTranscript(korean.repeat(20))).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(summaryService.isLikelyEnglishTranscript('')).toBe(false)
  })
})
