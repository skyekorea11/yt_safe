import { createClient, SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase client for browser/client-side operations
 * Used for real-time subscriptions and client-side queries
 * 
 * Environment variables required:
 * - NEXT_PUBLIC_SUPABASE_URL: Your Supabase project URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY: Your Supabase anonymous key
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) {
  console.warn('NEXT_PUBLIC_SUPABASE_URL is not set')
}
if (!supabaseAnonKey) {
  console.warn('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
}

let supabase: SupabaseClient

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey)
} else {
  // Fail fast so deployment issues are visible instead of silently returning empty lists.
  console.warn('Supabase credentials not configured')
  const missingError = () => {
    throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)')
  }
  supabase = new Proxy({} as SupabaseClient, {
    get() {
      return missingError
    },
  })
}

export { supabase }
