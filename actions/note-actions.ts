'use server'

/**
 * Server actions for favorites and notes
 * These run on the server and interact with the database
 */

import { videoFavoriteRepository, videoNoteRepository } from '@/lib/supabase/videos'
import { logger } from '@/lib/logger'

/**
 * Update video favorite status
 */
export async function updateVideoFavoriteAction(videoId: string, isFavorite: boolean): Promise<boolean> {
  try {
    const result = await videoFavoriteRepository.toggle(videoId, isFavorite)
    return !!result
  } catch (error) {
    logger.error('Error updating favorite:', error)
    return false
  }
}

/**
 * Update video note
 */
export async function updateVideoNoteAction(videoId: string, note: string): Promise<boolean> {
  try {
    const result = await videoNoteRepository.upsert(videoId, note)
    return !!result
  } catch (error) {
    logger.error('Error updating note:', error)
    return false
  }
}

/**
 * Delete video note
 */
export async function deleteVideoNoteAction(videoId: string): Promise<boolean> {
  try {
    const result = await videoNoteRepository.deleteByVideoId(videoId)
    return result
  } catch (error) {
    logger.error('Error deleting note:', error)
    return false
  }
}

/**
 * Get video favorite status
 */
export async function getVideoFavoriteAction(videoId: string): Promise<boolean> {
  try {
    const favorite = await videoFavoriteRepository.getByVideoId(videoId)
    return favorite?.is_favorite || false
  } catch (error) {
    logger.error('Error getting favorite:', error)
    return false
  }
}

/**
 * Get video note
 */
export async function getVideoNoteAction(videoId: string): Promise<string | null> {
  try {
    const note = await videoNoteRepository.getByVideoId(videoId)
    return note?.note || null
  } catch (error) {
    logger.error('Error getting note:', error)
    return null
  }
}
