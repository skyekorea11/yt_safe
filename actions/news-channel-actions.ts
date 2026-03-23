'use server'

import { youtubeService } from '@/lib/youtube/youtube-service'
import { newsChannelRepository } from '@/lib/supabase/channels'
import { NewsChannel } from '@/types'
import { logger } from '@/lib/logger'

export async function addNewsChannelAction(
  identifier: string,
  region: 'domestic' | 'overseas' = 'domestic'
): Promise<{
  success: boolean
  channel?: NewsChannel
  error?: string
}> {
  try {
    const youtubeChannel = await youtubeService.resolveChannel(identifier)
    if (!youtubeChannel) {
      return { success: false, error: 'Could not resolve YouTube channel. Check the URL, @handle, or channel ID.' }
    }

    const uploadsPlaylistId = youtubeChannel.contentDetails?.relatedPlaylists.uploads
    if (!uploadsPlaylistId) {
      return { success: false, error: 'Could not find uploads playlist for this channel.' }
    }

    const saved = await newsChannelRepository.upsert({
      youtube_channel_id: youtubeChannel.id,
      title: youtubeChannel.snippet.title,
      handle: youtubeChannel.snippet.customUrl || '',
      thumbnail_url: youtubeChannel.snippet.thumbnails.high?.url || youtubeChannel.snippet.thumbnails.medium?.url || '',
      uploads_playlist_id: uploadsPlaylistId,
      region,
    })
    if (!saved) return { success: false, error: 'Failed to save news channel.' }

    return { success: true, channel: saved }
  } catch (error) {
    logger.error('Error adding news channel:', error)
    return { success: false, error: 'Failed to add news channel.' }
  }
}

export async function removeNewsChannelAction(youtubeChannelId: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const ok = await newsChannelRepository.deleteByYouTubeId(youtubeChannelId)
    if (!ok) return { success: false, error: 'Failed to remove news channel.' }
    return { success: true }
  } catch (error) {
    logger.error('Error removing news channel:', error)
    return { success: false, error: 'Failed to remove news channel.' }
  }
}
