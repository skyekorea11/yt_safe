/**
 * Type-safe parsers for API request bodies.
 * All parsers accept unknown input and return fully typed, safe values.
 */

function toObj(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

export interface SummaryRefreshBody {
  force: boolean
  useTranscriptPipeline: boolean
}

export function parseSummaryRefreshBody(raw: unknown): SummaryRefreshBody {
  const obj = toObj(raw)
  return {
    force: obj.force !== false,
    useTranscriptPipeline: obj.useTranscriptPipeline !== false,
  }
}

export interface SummarizeBody {
  force: boolean
  useTranscriptPipeline: boolean
}

export function parseSummarizeBody(raw: unknown): SummarizeBody {
  const obj = toObj(raw)
  return {
    force: obj.force === true,
    useTranscriptPipeline: obj.useTranscriptPipeline !== false,
  }
}

export interface TranscriptBody {
  force: boolean
  videoIds: string[]
}

export function parseTranscriptBody(raw: unknown): TranscriptBody {
  const obj = toObj(raw)
  const force = obj.force === true
  const rawIds = Array.isArray(obj.videoIds) ? obj.videoIds : []
  const videoIds = rawIds.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  )
  return { force, videoIds }
}
