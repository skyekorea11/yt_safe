/**
 * Core type definitions for YouTube Digest app
 */

export interface Channel {
  id: string;
  youtube_channel_id: string;
  title: string;
  channel_group?: 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc' | null;
  stock_mode?: 'auto' | 'strict' | 'off' | 'low_stock';
  news_mode?: 'auto' | 'strict' | 'off';
  handle: string;
  description: string;
  thumbnail_url: string;
  uploads_playlist_id: string;
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: string;
  youtube_video_id: string;
  youtube_channel_id: string;
  channel_title?: string;
  title: string;
  description: string;
  thumbnail_url: string;
  published_at: string;
  duration_text?: string;
  duration_seconds?: number;
  like_count?: number | null;
  video_url: string;
  transcript_status: 'pending' | 'extracted' | 'failed' | 'not_available' | null;
  transcript_text?: string;
  summary_status: 'pending' | 'processing' | 'complete' | 'failed' | null;
  summary_text?: string;
  summary_source_type?: 'transcript' | 'description' | 'external' | null;
  summarized_at?: string;
  related_news?: Array<{ title: string; link: string; source: string; publishedAt: string | null }> | null;
  related_stocks?: Array<{ ticker: string; name: string; market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'HKEX' | 'TSE' | 'TWSE'; is_core?: boolean }> | null;
  created_at: string;
  updated_at: string;
}

export interface VideoNote {
  id: string;
  youtube_video_id: string;
  note: string;
  updated_at: string;
}

export interface VideoFavorite {
  id: string;
  youtube_video_id: string;
  is_favorite: boolean;
  updated_at: string;
}

export interface TranscriptUsageEvent {
  id: string;
  provider: string;
  youtube_video_id: string;
  status: 'ready' | 'pending' | 'not_available' | 'failed' | 'blocked';
  created_at: string;
}

export interface ChannelSubscriptionDemo {
  id: string;
  youtube_channel_id: string;
  added_at: string;
}

export interface NewsChannel {
  id: string;
  youtube_channel_id: string;
  title: string;
  handle: string;
  thumbnail_url: string;
  uploads_playlist_id: string;
  region: 'domestic' | 'overseas';
  added_at: string;
  updated_at: string;
}

/**
 * YouTube Data API derived types
 */
export interface YouTubeChannel {
  id: string;
  snippet: {
    title: string;
    description: string;
    customUrl?: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  contentDetails?: {
    relatedPlaylists: {
      uploads: string;
    };
  };
}

export interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    liveBroadcastContent?: 'live' | 'upcoming' | 'none';
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  contentDetails?: {
    duration?: string;
  };
  status?: {
    caption?: 'true' | 'false';
  };
  statistics?: {
    likeCount?: string;
  };
}

export interface YouTubePlaylistItem {
  id: string;
  snippet: {
    title: string;
    description: string;
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    resourceId: {
      videoId: string;
      kind: string;
    };
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  contentDetails?: {
    videoId: string;
    startAt?: string;
    endAt?: string;
    note?: string;
  };
}

/**
 * UI and local state types
 */
export interface FilterChip {
  id: string;
  label: string;
  active: boolean;
}

export interface SummaryPreference {
  showSummary: boolean;
  enableTranscriptPipeline: boolean;
}
