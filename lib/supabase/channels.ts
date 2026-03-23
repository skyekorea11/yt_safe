import { supabase } from './client'
import { Channel, ChannelSubscriptionDemo, NewsChannel } from '@/types'
import { logger } from '@/lib/logger'

/**
 * Channel repository for CRUD operations
 * Handles database interactions for YouTube channels
 */

export const channelRepository = {
  /**
   * Get all channels from database
   */
  async getAll(): Promise<Channel[]> {
    try {
      const runSortedQuery = () =>
        supabase
          .from('channels')
          .select('*')
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })

      let { data, error } = await runSortedQuery()

      // Backward compatibility: if DB has not migrated `sort_order`, fallback to created_at only.
      if (error && typeof error === 'object') {
        const e = error as { code?: string; message?: string; details?: string }
        const lower = `${e.message || ''} ${e.details || ''}`.toLowerCase()
        if (e.code === 'PGRST204' || lower.includes('sort_order') || lower.includes('column')) {
          const fallback = await supabase
            .from('channels')
            .select('*')
            .order('created_at', { ascending: false })
          data = fallback.data
          error = fallback.error
        }
      }

      if (error) {
        // log raw object first (may be non-enumerable)
        logger.error('Supabase error fetching channels raw:', error)
        // also serialize all properties to make sure nothing is hidden
        try {
          logger.error('Supabase error fetching channels serialized:',
            JSON.stringify(error, Object.getOwnPropertyNames(error), 2))
        } catch {}
        logger.error('Supabase error fetching channels:', {
          message: error.message,
          code: error.code,
          details: error.details,
        })
        if (error.code === 'PGRST205') {
          logger.warn('It looks like the channels table does not exist. Did you run lib/supabase/schema.sql against your database?')
        }
        throw error
      }
      return data || []
    } catch (error) {
      logger.error('Error fetching channels:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      return []
    }
  },

  async updateSortOrders(
    orderedChannelIds: string[]
  ): Promise<{ success: boolean; reason?: 'missing_column' | 'error'; message?: string }> {
    try {
      for (let idx = 0; idx < orderedChannelIds.length; idx += 1) {
        const youtubeChannelId = orderedChannelIds[idx]
        const { error } = await supabase
          .from('channels')
          .update({
            sort_order: idx + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('youtube_channel_id', youtubeChannelId)
        if (error) throw error
      }
      return { success: true }
    } catch (error) {
      let message = '채널 순서 저장에 실패했습니다.'
      let reason: 'missing_column' | 'error' = 'error'
      if (error && typeof error === 'object') {
        const e = error as { message?: string; details?: string; code?: string }
        if (typeof e.message === 'string' && e.message.trim()) {
          message = e.message
        }
        const lower = `${e.message || ''} ${e.details || ''}`.toLowerCase()
        if (e.code === 'PGRST204' || lower.includes('sort_order') || lower.includes('column')) {
          reason = 'missing_column'
        }
      }
      logger.error('Error updating channel sort order:', error)
      return { success: false, reason, message }
    }
  },

  /**
   * Get channel by YouTube channel ID
   */
  async getByYouTubeId(youtubeChannelId: string): Promise<Channel | null> {
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('*')
        .eq('youtube_channel_id', youtubeChannelId)
        .single()

      if (error && error.code !== 'PGRST116') throw error // PGRST116 = no rows found
      return data || null
    } catch (error) {
      logger.error('Error fetching channel:', error)
      return null
    }
  },

  /**
   * Create or update channel (upsert)
   */
  async upsert(channel: Partial<Channel> & { youtube_channel_id: string }): Promise<Channel | null> {
    try {
      const { data, error } = await supabase
        .from('channels')
        .upsert(
          {
            ...channel,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'youtube_channel_id' }
        )
        .select()
        .single()

      if (error) throw error
      return data || null
    } catch (error) {
      logger.error('Error upserting channel:', error)
      return null
    }
  },

  async updateStockMode(
    youtubeChannelId: string,
    stockMode: 'auto' | 'strict' | 'off' | 'low_stock'
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('channels')
        .update({
          stock_mode: stockMode,
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_channel_id', youtubeChannelId)

      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error updating channel stock mode:', error)
      return false
    }
  },

  async updateNewsMode(
    youtubeChannelId: string,
    newsMode: 'auto' | 'strict' | 'off'
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('channels')
        .update({
          news_mode: newsMode,
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_channel_id', youtubeChannelId)

      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error updating channel news mode:', error)
      return false
    }
  },

  async updateChannelGroup(
    youtubeChannelId: string,
    channelGroup: 'news' | 'finance' | 'real_estate' | 'tech' | 'lifestyle' | 'etc' | null
  ): Promise<{ success: boolean; reason?: 'missing_column' | 'error'; message?: string }> {
    try {
      const { error } = await supabase
        .from('channels')
        .update({
          channel_group: channelGroup,
          updated_at: new Date().toISOString(),
        })
        .eq('youtube_channel_id', youtubeChannelId)

      if (error) throw error
      return { success: true }
    } catch (error) {
      let message = '채널 분류 업데이트에 실패했습니다.'
      let reason: 'missing_column' | 'error' = 'error'
      if (error && typeof error === 'object') {
        const e = error as { message?: string; details?: string; code?: string }
        if (typeof e.message === 'string' && e.message.trim()) {
          message = e.message
        }
        const lower = `${e.message || ''} ${e.details || ''}`.toLowerCase()
        if (e.code === 'PGRST204' || lower.includes('channel_group') || lower.includes('column')) {
          reason = 'missing_column'
        }
        try {
          logger.error(
            'Error updating channel group serialized:',
            JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          )
        } catch {}
      }
      logger.error('Error updating channel group:', error)
      return { success: false, reason, message }
    }
  },

  /**
   * Delete channel by YouTube channel ID
   */
  async deleteByYouTubeId(youtubeChannelId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('channels')
        .delete()
        .eq('youtube_channel_id', youtubeChannelId)

      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error deleting channel:', error)
      return false
    }
  },
}

/**
 * Channel subscription repository for demo mode
 */
export const channelSubscriptionRepository = {
  /**
   * Get all subscribed channels
   */
  async getAll(): Promise<ChannelSubscriptionDemo[]> {
    try {
      const { data, error } = await supabase
        .from('channel_subscriptions_demo')
        .select('*')
        .order('added_at', { ascending: false })

      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching subscriptions:', error)
      return []
    }
  },

  /**
   * Add channel subscription
   */
  async add(youtubeChannelId: string): Promise<ChannelSubscriptionDemo | null> {
    try {
      const { data, error } = await supabase
        .from('channel_subscriptions_demo')
        .upsert(
          { youtube_channel_id: youtubeChannelId },
          { onConflict: 'youtube_channel_id' }
        )
        .select()
        .single()

      if (error) throw error
      return data || null
    } catch (error) {
      logger.error('Error adding subscription:', error)
      return null
    }
  },

  /**
   * Remove channel subscription
   */
  async remove(youtubeChannelId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('channel_subscriptions_demo')
        .delete()
        .eq('youtube_channel_id', youtubeChannelId)

      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error removing subscription:', error)
      return false
    }
  },

  /**
   * Check if channel is subscribed
   */
  async isSubscribed(youtubeChannelId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('channel_subscriptions_demo')
        .select('id')
        .eq('youtube_channel_id', youtubeChannelId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return !!data
    } catch (error) {
      logger.error('Error checking subscription:', error)
      return false
    }
  },
}

export const newsChannelRepository = {
  async getAll(): Promise<NewsChannel[]> {
    try {
      const { data, error } = await supabase
        .from('news_channels')
        .select('*')
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    } catch (error) {
      logger.error('Error fetching news channels:', error)
      return []
    }
  },

  async upsert(channel: {
    youtube_channel_id: string
    title: string
    handle?: string
    thumbnail_url?: string
    uploads_playlist_id?: string
    region?: 'domestic' | 'overseas'
  }): Promise<NewsChannel | null> {
    try {
      const { data, error } = await supabase
        .from('news_channels')
        .upsert(
          {
            ...channel,
            region: channel.region || 'domestic',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'youtube_channel_id' }
        )
        .select()
        .single()
      if (error) throw error
      return data || null
    } catch (error) {
      logger.error('Error upserting news channel:', error)
      return null
    }
  },

  async deleteByYouTubeId(youtubeChannelId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('news_channels')
        .delete()
        .eq('youtube_channel_id', youtubeChannelId)
      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error deleting news channel:', error)
      return false
    }
  },
}
