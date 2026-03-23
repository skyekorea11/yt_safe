import { describe, it, expect } from 'vitest'
import {
  parseSummarizeBody,
  parseSummaryRefreshBody,
  parseTranscriptBody,
} from '../validate'

describe('parseSummarizeBody', () => {
  it('defaults: force=false, useTranscriptPipeline=true', () => {
    expect(parseSummarizeBody(null)).toEqual({ force: false, useTranscriptPipeline: true })
    expect(parseSummarizeBody({})).toEqual({ force: false, useTranscriptPipeline: true })
  })

  it('force=true only with strict true', () => {
    expect(parseSummarizeBody({ force: true })).toEqual({ force: true, useTranscriptPipeline: true })
    expect(parseSummarizeBody({ force: 'true' })).toEqual({ force: false, useTranscriptPipeline: true })
    expect(parseSummarizeBody({ force: 1 })).toEqual({ force: false, useTranscriptPipeline: true })
  })

  it('useTranscriptPipeline=false only with strict false', () => {
    expect(parseSummarizeBody({ useTranscriptPipeline: false })).toEqual({ force: false, useTranscriptPipeline: false })
    expect(parseSummarizeBody({ useTranscriptPipeline: 0 })).toEqual({ force: false, useTranscriptPipeline: true })
  })

  it('ignores non-object input', () => {
    expect(parseSummarizeBody('string')).toEqual({ force: false, useTranscriptPipeline: true })
    expect(parseSummarizeBody([1, 2, 3])).toEqual({ force: false, useTranscriptPipeline: true })
  })
})

describe('parseSummaryRefreshBody', () => {
  it('defaults: force=true, useTranscriptPipeline=true', () => {
    expect(parseSummaryRefreshBody(null)).toEqual({ force: true, useTranscriptPipeline: true })
    expect(parseSummaryRefreshBody({})).toEqual({ force: true, useTranscriptPipeline: true })
  })

  it('force=false only with strict false', () => {
    expect(parseSummaryRefreshBody({ force: false })).toEqual({ force: false, useTranscriptPipeline: true })
    expect(parseSummaryRefreshBody({ force: 0 })).toEqual({ force: true, useTranscriptPipeline: true })
  })
})

describe('parseTranscriptBody', () => {
  it('defaults: force=false, videoIds=[]', () => {
    expect(parseTranscriptBody(null)).toEqual({ force: false, videoIds: [] })
    expect(parseTranscriptBody({})).toEqual({ force: false, videoIds: [] })
  })

  it('filters non-string values from videoIds', () => {
    const result = parseTranscriptBody({ videoIds: ['abc', null, 123, '', { evil: true }, 'def'] })
    expect(result.videoIds).toEqual(['abc', 'def'])
  })

  it('force requires strict true', () => {
    expect(parseTranscriptBody({ force: true }).force).toBe(true)
    expect(parseTranscriptBody({ force: 'true' }).force).toBe(false)
    expect(parseTranscriptBody({ force: 1 }).force).toBe(false)
  })

  it('handles non-array videoIds gracefully', () => {
    expect(parseTranscriptBody({ videoIds: 'abc' }).videoIds).toEqual([])
    expect(parseTranscriptBody({ videoIds: null }).videoIds).toEqual([])
  })
})
