import { supabase } from './client'
import { TranscriptUsageEvent, Video, VideoNote, VideoFavorite } from '@/types'

/**
 * Video repository for CRUD operations
 * Handles database interactions for videos
 */

export const videoRepository = {
  /**
   * Get all videos
   */
  async getAll(): Promise<Video[]> {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .order('published_at', { ascending: false })

      if (error) {
        console.error('Supabase error fetching videos raw:', error)
        try {
          console.error('Supabase error fetching videos serialized:',
            JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
        } catch {}
        console.error('Supabase error fetching videos:', {
          message: error.message,
          code: error.code,
          details: error.details,
        })
        if (error.code === 'PGRST205') {
          console.warn('It looks like the videos table does not exist. Did you run lib/supabase/schema.sql against your database?')
        }
        throw error
      }
      return data || []
    } catch (error) {
      console.error('Error fetching videos:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      return []
    }
  },

  /**
   * Get videos by channel ID
   */
  async getByChannelId(youtubeChannelId: string, limit = 5): Promise<Video[]> {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('youtube_channel_id', youtubeChannelId)
        .order('published_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching videos by channel:', error)
      return []
    }
  },

  /**
   * Get latest videos across all channels
   */
  async getLatestAcrossChannels(limit = 7): Promise<Video[]> {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .order('published_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching latest videos:', error)
      return []
    }
  },

  /**
   * Get videos by a set of YouTube video IDs
   */
  async getByYouTubeIds(youtubeVideoIds: string[]): Promise<Video[]> {
    try {
      if (youtubeVideoIds.length === 0) return []
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .in('youtube_video_id', youtubeVideoIds)
        .order('published_at', { ascending: false })

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching videos by ids:', error)
      return []
    }
  },

  /**
   * Get video by YouTube video ID
   */
  async getByYouTubeId(youtubeVideoId: string): Promise<Video | null> {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('youtube_video_id', youtubeVideoId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    } catch (error) {
      console.error('Error fetching video:', error)
      return null
    }
  },

  /**
   * Create or update video (upsert)
   */
  async upsert(video: Partial<Video> & { youtube_video_id: string; youtube_channel_id: string }): Promise<Video | null> {
    try {
      const payload = {
        ...video,
        updated_at: new Date().toISOString(),
      } as Record<string, unknown>

      const attemptUpsert = async (row: Record<string, unknown>) => {
        return supabase
          .from('videos')
          .upsert(row, { onConflict: 'youtube_video_id' })
          .select()
          .single()
      }

      let { data, error } = await attemptUpsert(payload)

      // Backward compatibility: if DB has not yet migrated `like_count`, retry without it.
      if (error && typeof error === 'object') {
        const e = error as { code?: string; message?: string; details?: string }
        const lower = `${e.message || ''} ${e.details || ''}`.toLowerCase()
        if ((e.code === 'PGRST204' || lower.includes('like_count') || lower.includes('column')) && 'like_count' in payload) {
          const retryPayload = { ...payload }
          delete retryPayload.like_count
          const retried = await attemptUpsert(retryPayload)
          data = retried.data
          error = retried.error
        }
      }

      if (error) throw error
      return data || null
    } catch (error) {
      console.error('Error upserting video:', error)
      return null
    }
  },

  /**
   * Update video's transcript
   */
  async updateTranscript(youtubeVideoId: string, transcriptText: string, status: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .update({
          transcript_text: transcriptText,
          transcript_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating transcript:', error)
      return false
    }
  },

  /**
   * Update video's summary
   */
  async updateSummary(
    youtubeVideoId: string,
    summaryText: string,
    summarySourceType: string,
    status: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .update({
          summary_text: summaryText,
          summary_source_type: summarySourceType,
          summary_status: status,
          summarized_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating summary:', error)
      return false
    }
  },

  /**
   * Update only the summary_status field
   */
  async updateSummaryStatus(youtubeVideoId: string, status: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .update({ summary_status: status, updated_at: new Date().toISOString() })
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating summary status:', error)
      return false
    }
  },

  /**
   * Update related news and stocks cache
   */
  async updateRelatedNews(
    youtubeVideoId: string,
    articles: unknown[],
    stocks: unknown[]
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .update({
          related_news: articles,
          related_stocks: stocks,
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating related news:', error)
      return false
    }
  },

  /**
   * Get videos that need summarization (pending status)
   */
  async getPendingSummaries(): Promise<Video[]> {
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('summary_status', 'pending')
        .order('created_at', { ascending: true })

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching pending summaries:', error)
      return []
    }
  },

  /**
   * Delete video by YouTube video ID
   */
  async deleteByYouTubeId(youtubeVideoId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('videos')
        .delete()
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error deleting video:', error)
      return false
    }
  },

  /**
   * Delete videos older than N days, excluding favorited ones
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      const favorites = await videoFavoriteRepository.getAllFavorites()
      const favoriteIds = favorites.filter(f => f.is_favorite).map(f => f.youtube_video_id)

      let query = supabase.from('videos').delete({ count: 'exact' }).lt('published_at', cutoff)
      if (favoriteIds.length > 0) {
        query = query.not('youtube_video_id', 'in', `(${favoriteIds.join(',')})`)
      }

      const { error, count } = await query
      if (error) throw error
      return count ?? 0
    } catch (error) {
      console.error('Error deleting old videos:', error)
      return 0
    }
  },
}

export const transcriptUsageRepository = {
  async log(
    provider: string,
    youtubeVideoId: string,
    status: TranscriptUsageEvent['status']
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('transcript_usage_events')
        .insert({
          provider,
          youtube_video_id: youtubeVideoId,
          status,
        })

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error logging transcript usage event:', error)
      return false
    }
  },

  async countSince(provider: string, sinceIso: string): Promise<number | null> {
    try {
      const { count, error } = await supabase
        .from('transcript_usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('provider', provider)
        .gte('created_at', sinceIso)

      if (error) throw error
      return count ?? 0
    } catch (error) {
      console.error('Error counting transcript usage events:', error)
      return null
    }
  },
}

/**
 * Video notes repository
 */
export const videoNoteRepository = {
  /**
   * Get all notes
   */
  async getAll(): Promise<VideoNote[]> {
    try {
      const { data, error } = await supabase
        .from('video_notes')
        .select('*')

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching all notes:', error)
      return []
    }
  },

  /**
   * Get note for a video
   */
  async getByVideoId(youtubeVideoId: string): Promise<VideoNote | null> {
    try {
      const { data, error } = await supabase
        .from('video_notes')
        .select('*')
        .eq('youtube_video_id', youtubeVideoId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    } catch (error) {
      console.error('Error fetching note:', error)
      return null
    }
  },

  /**
   * Create or update note (upsert)
   */
  async upsert(youtubeVideoId: string, note: string): Promise<VideoNote | null> {
    try {
      // First try to get existing note
      const existing = await this.getByVideoId(youtubeVideoId)

      let data
      let error

      if (existing) {
        // Update existing
        const result = await supabase
          .from('video_notes')
          .update({
            note,
            updated_at: new Date().toISOString(),
          })
          .eq('youtube_video_id', youtubeVideoId)
          .select()
          .single()
        data = result.data
        error = result.error
      } else {
        // Insert new
        const result = await supabase
          .from('video_notes')
          .insert({ youtube_video_id: youtubeVideoId, note })
          .select()
          .single()
        data = result.data
        error = result.error
      }

      if (error) throw error
      return data || null
    } catch (error) {
      console.error('Error upserting note:', error)
      return null
    }
  },

  /**
   * Delete note
   */
  async deleteByVideoId(youtubeVideoId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('video_notes')
        .delete()
        .eq('youtube_video_id', youtubeVideoId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error deleting note:', error)
      return false
    }
  },
}

/**
 * Video favorites repository
 */
export const videoFavoriteRepository = {
  /**
   * Get favorite status for a video
   */
  async getByVideoId(youtubeVideoId: string): Promise<VideoFavorite | null> {
    try {
      const { data, error } = await supabase
        .from('video_favorites')
        .select('*')
        .eq('youtube_video_id', youtubeVideoId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    } catch (error) {
      console.error('Error fetching favorite:', error)
      return null
    }
  },

  /**
   * Get all favorite videos
   */
  async getAllFavorites(): Promise<VideoFavorite[]> {
    try {
      const { data, error } = await supabase
        .from('video_favorites')
        .select('*')
        .eq('is_favorite', true)

      if (error) throw error
      return data || []
    } catch (error) {
      console.error('Error fetching favorites:', error)
      return []
    }
  },

  /**
   * Toggle favorite status
   */
  async toggle(youtubeVideoId: string, isFavorite: boolean): Promise<VideoFavorite | null> {
    try {
      // First try to get existing favorite
      const existing = await this.getByVideoId(youtubeVideoId)

      let data
      let error

      if (existing) {
        // Update existing
        const result = await supabase
          .from('video_favorites')
          .update({
            is_favorite: isFavorite,
            updated_at: new Date().toISOString(),
          })
          .eq('youtube_video_id', youtubeVideoId)
          .select()
          .single()
        data = result.data
        error = result.error
      } else {
        // Insert new
        const result = await supabase
          .from('video_favorites')
          .insert({ youtube_video_id: youtubeVideoId, is_favorite: isFavorite })
          .select()
          .single()
        data = result.data
        error = result.error
      }

      if (error) throw error
      return data || null
    } catch (error) {
      console.error('Error toggling favorite:', error)
      return null
    }
  },

  /**
   * Set favorite status
   */
  async set(youtubeVideoId: string, isFavorite: boolean): Promise<VideoFavorite | null> {
    return this.toggle(youtubeVideoId, isFavorite)
  },
}
