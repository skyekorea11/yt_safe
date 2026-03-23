import { supabase } from './client'
import { logger } from '@/lib/logger'

export interface AppPreferences {
  id: string
  show_summary: boolean
  enable_transcript_pipeline: boolean
  updated_at?: string
}

const APP_PREFERENCES_ID = 'global'

export const appPreferencesRepository = {
  async get(): Promise<AppPreferences | null> {
    try {
      const { data, error } = await supabase
        .from('app_preferences')
        .select('*')
        .eq('id', APP_PREFERENCES_ID)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      return data || null
    } catch (error) {
      logger.error('Error fetching app preferences:', error)
      return null
    }
  },

  async upsert(values: Partial<Pick<AppPreferences, 'show_summary' | 'enable_transcript_pipeline'>>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('app_preferences')
        .upsert(
          {
            id: APP_PREFERENCES_ID,
            ...values,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )

      if (error) throw error
      return true
    } catch (error) {
      logger.error('Error upserting app preferences:', error)
      return false
    }
  },
}

