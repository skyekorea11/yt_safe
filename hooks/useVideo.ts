'use client'

/**
 * Custom React hooks for YouTube Digest app
 */

import { useState, useEffect, useCallback } from 'react'
import { Video, VideoNote, VideoFavorite } from '@/types'
import { updateVideoFavoriteAction, updateVideoNoteAction, deleteVideoNoteAction } from '@/actions/note-actions'

/**
 * Hook for managing video favorites with optimistic UI updates
 */
export function useVideoFavorite(videoId: string, initialFavorite = false) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleFavorite = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const newState = !isFavorite
      setIsFavorite(newState)

      const success = await updateVideoFavoriteAction(videoId, newState)
      if (!success) {
        // Revert on error
        setIsFavorite(!newState)
        setError('Failed to update favorite')
      }
    } catch (err) {
      setIsFavorite(!isFavorite)
      setError('An error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [videoId, isFavorite])

  return { isFavorite, toggleFavorite, isLoading, error }
}

/**
 * Hook for managing video notes with optimistic UI updates
 * Saves to localStorage first for instant feedback, then syncs to DB
 */
export function useVideoNote(videoId: string) {
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  // Load note from localStorage on mount
  useEffect(() => {
    const localKey = `video_note_${videoId}`
    const localStorage = typeof window !== 'undefined' ? window.localStorage : null
    if (localStorage) {
      const saved = localStorage.getItem(localKey)
      if (saved) {
        setNote(saved)
      }
    }
  }, [videoId])

  const saveNote = useCallback(async (text: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const localKey = `video_note_${videoId}`
      const localStorage = typeof window !== 'undefined' ? window.localStorage : null

      // Optimistic update: save to localStorage immediately
      if (localStorage) {
        localStorage.setItem(localKey, text)
      }
      setNote(text)

      // Sync to database
      const success = await updateVideoNoteAction(videoId, text)
      if (!success) {
        setError('Failed to save note to database')
      }
    } catch (err) {
      setError('An error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [videoId])

  const deleteNote = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const localKey = `video_note_${videoId}`
      const localStorage = typeof window !== 'undefined' ? window.localStorage : null

      if (localStorage) {
        localStorage.removeItem(localKey)
      }
      setNote('')

      const success = await deleteVideoNoteAction(videoId)
      if (!success) {
        setError('Failed to delete note')
      }
    } catch (err) {
      setError('An error occurred')
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [videoId])

  return { note, saveNote, deleteNote, isLoading, error, isOpen, setIsOpen }
}

/**
 * Hook for managing summary preferences in localStorage
 */
export function useSummaryPreferences() {
  const [showSummary, setShowSummary] = useState(true)
  const [enableTranscriptPipeline, setEnableTranscriptPipeline] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('summary_preferences')
      if (saved) {
        try {
          const { showSummary: s, enableTranscriptPipeline: t } = JSON.parse(saved)
          setShowSummary(s)
          setEnableTranscriptPipeline(t)
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, [])

  const updateShowSummary = useCallback((value: boolean) => {
    setShowSummary(value)
    if (typeof window !== 'undefined') {
      const current = JSON.parse(window.localStorage.getItem('summary_preferences') || '{}')
      window.localStorage.setItem(
        'summary_preferences',
        JSON.stringify({ ...current, showSummary: value })
      )
    }
  }, [])

  const updateEnableTranscriptPipeline = useCallback((value: boolean) => {
    setEnableTranscriptPipeline(value)
    if (typeof window !== 'undefined') {
      const current = JSON.parse(window.localStorage.getItem('summary_preferences') || '{}')
      window.localStorage.setItem(
        'summary_preferences',
        JSON.stringify({ ...current, enableTranscriptPipeline: value })
      )
    }
  }, [])

  return {
    showSummary,
    enableTranscriptPipeline,
    updateShowSummary,
    updateEnableTranscriptPipeline,
  }
}

/**
 * Hook for filtering videos
 */
export function useVideoFilter(videos: Video[]) {
  const [filterText, setFilterText] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])

  const filteredVideos = videos.filter((video) => {
    const matchesText = video.title.toLowerCase().includes(filterText.toLowerCase())

    const matchesChannel = selectedChannels.length === 0 || selectedChannels.includes(video.youtube_channel_id)

    return matchesText && matchesChannel
  })

  const toggleChannel = (channelId: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelId) ? prev.filter((c) => c !== channelId) : [...prev, channelId]
    )
  }

  return {
    filterText,
    setFilterText,
    selectedChannels,
    toggleChannel,
    filteredVideos,
  }
}
