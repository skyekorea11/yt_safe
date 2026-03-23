/**
 * Dashboard-specific types for the main page and its sub-components.
 */

export interface RefreshStatus {
  lastRefreshed: string | null
  nextRefresh: string | null
  newVideoCount: number
}

export interface RelatedNewsItem {
  title: string
  link: string
  source: string
  publishedAt: string | null
}

export interface StockSuggestion {
  ticker: string
  name: string
  market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'HKEX' | 'TSE' | 'TWSE'
  is_core?: boolean
}

export interface NewsChannelItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

export interface ChannelVideoItem {
  youtubeVideoId: string
  title: string
  channelTitle: string
  publishedAt: string
  videoUrl: string
}

export type ChannelNewsMode = 'auto' | 'strict' | 'off'
export type SidebarChannelGroup = 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc'
export type VideoSortMode = 'latest' | 'interest'
