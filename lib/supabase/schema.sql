/**
 * Supabase SQL Schema for YouTube Digest
 * 
 * Run this SQL in your Supabase dashboard to set up the required tables.
 * Go to: https://supabase.com/dashboard -> SQL Editor -> New Query
 * Copy and paste this entire file's SQL content, then click "Execute" or "RUN"
 */

-- Create channels table
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  stock_mode TEXT NOT NULL DEFAULT 'auto',
  news_mode TEXT NOT NULL DEFAULT 'auto',
  handle TEXT,
  description TEXT,
  thumbnail_url TEXT,
  uploads_playlist_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS stock_mode TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS news_mode TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS channel_group TEXT;

-- Create videos table
CREATE TABLE IF NOT EXISTS public.videos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  youtube_channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  duration_text TEXT,
  duration_seconds INTEGER,
  like_count BIGINT,
  video_url TEXT NOT NULL,
  transcript_status TEXT DEFAULT NULL,
  transcript_text TEXT,
  summary_status TEXT DEFAULT NULL,
  summary_text TEXT,
  summary_source_type TEXT DEFAULT NULL,
  summarized_at TIMESTAMP WITH TIME ZONE,
  related_news JSONB DEFAULT NULL,
  related_stocks JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (youtube_channel_id) REFERENCES public.channels(youtube_channel_id) ON DELETE CASCADE
);

-- Create channel_subscriptions_demo table
CREATE TABLE IF NOT EXISTS public.channel_subscriptions_demo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (youtube_channel_id) REFERENCES public.channels(youtube_channel_id) ON DELETE CASCADE
);

-- Create video_notes table
CREATE TABLE IF NOT EXISTS public.video_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_video_id TEXT NOT NULL,
  note TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (youtube_video_id) REFERENCES public.videos(youtube_video_id) ON DELETE CASCADE
);

-- Create video_favorites table
CREATE TABLE IF NOT EXISTS public.video_favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  is_favorite BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (youtube_video_id) REFERENCES public.videos(youtube_video_id) ON DELETE CASCADE
);

-- Create transcript usage events table (for Azure budget guard)
CREATE TABLE IF NOT EXISTS public.transcript_usage_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create news_channels table (separate from main video channels)
CREATE TABLE IF NOT EXISTS public.news_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  handle TEXT,
  thumbnail_url TEXT,
  uploads_playlist_id TEXT,
  region TEXT NOT NULL DEFAULT 'domestic',
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE public.news_channels
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'domestic';

-- Migration: add related news/stocks cache columns (run if upgrading existing DB)
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS related_news JSONB DEFAULT NULL;
-- ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS related_stocks JSONB DEFAULT NULL;
ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS like_count BIGINT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON public.videos(youtube_channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON public.videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_notes_video_id ON public.video_notes(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_video_favorites_video_id ON public.video_favorites(youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_video_favorites_is_favorite ON public.video_favorites(is_favorite);
CREATE INDEX IF NOT EXISTS idx_transcript_usage_events_provider_created_at ON public.transcript_usage_events(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_channels_added_at ON public.news_channels(added_at DESC);

-- Enable RLS (Row Level Security) - optional but recommended for demo
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_subscriptions_demo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_channels ENABLE ROW LEVEL SECURITY;

-- Create basic RLS policies (allow all reads and writes for demo - no authentication required)
CREATE POLICY "Allow all reads" ON public.channels FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.channels FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.channels FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.channels FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.videos FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.videos FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.videos FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.videos FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.channel_subscriptions_demo FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.channel_subscriptions_demo FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.channel_subscriptions_demo FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.channel_subscriptions_demo FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.video_notes FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.video_notes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.video_notes FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.video_notes FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.video_favorites FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.video_favorites FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.video_favorites FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.video_favorites FOR DELETE USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transcript_usage_events' AND policyname = 'Allow all reads'
  ) THEN
    CREATE POLICY "Allow all reads" ON public.transcript_usage_events FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transcript_usage_events' AND policyname = 'Allow all inserts'
  ) THEN
    CREATE POLICY "Allow all inserts" ON public.transcript_usage_events FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transcript_usage_events' AND policyname = 'Allow all updates'
  ) THEN
    CREATE POLICY "Allow all updates" ON public.transcript_usage_events FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transcript_usage_events' AND policyname = 'Allow all deletes'
  ) THEN
    CREATE POLICY "Allow all deletes" ON public.transcript_usage_events FOR DELETE USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'news_channels' AND policyname = 'Allow all reads'
  ) THEN
    CREATE POLICY "Allow all reads" ON public.news_channels FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'news_channels' AND policyname = 'Allow all inserts'
  ) THEN
    CREATE POLICY "Allow all inserts" ON public.news_channels FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'news_channels' AND policyname = 'Allow all updates'
  ) THEN
    CREATE POLICY "Allow all updates" ON public.news_channels FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'news_channels' AND policyname = 'Allow all deletes'
  ) THEN
    CREATE POLICY "Allow all deletes" ON public.news_channels FOR DELETE USING (true);
  END IF;
END $$;

-- ============================================================================
-- Taxonomy / Industry / Mapping tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.content_taxonomy (
  taxonomy_id TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.industry_classification (
  sector_id TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  industry_id TEXT NOT NULL,
  industry_name TEXT NOT NULL,
  subindustry_id TEXT PRIMARY KEY,
  subindustry_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public.taxonomy_industry_mapping (
  taxonomy_id TEXT NOT NULL REFERENCES public.content_taxonomy(taxonomy_id),
  subindustry_id TEXT NOT NULL REFERENCES public.industry_classification(subindustry_id),
  PRIMARY KEY (taxonomy_id, subindustry_id)
);

CREATE TABLE IF NOT EXISTS public.stock_example_mapping (
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  subindustry_id TEXT NOT NULL REFERENCES public.industry_classification(subindustry_id),
  PRIMARY KEY (ticker, subindustry_id)
);

CREATE INDEX IF NOT EXISTS idx_content_taxonomy_sector ON public.content_taxonomy(sector);
CREATE INDEX IF NOT EXISTS idx_industry_classification_sector ON public.industry_classification(sector_name);
CREATE INDEX IF NOT EXISTS idx_taxonomy_industry_mapping_taxonomy ON public.taxonomy_industry_mapping(taxonomy_id);
CREATE INDEX IF NOT EXISTS idx_stock_example_mapping_subindustry ON public.stock_example_mapping(subindustry_id);

ALTER TABLE public.content_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taxonomy_industry_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_example_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all reads" ON public.content_taxonomy FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.content_taxonomy FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.content_taxonomy FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.content_taxonomy FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.industry_classification FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.industry_classification FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.industry_classification FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.industry_classification FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.taxonomy_industry_mapping FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.taxonomy_industry_mapping FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.taxonomy_industry_mapping FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.taxonomy_industry_mapping FOR DELETE USING (true);

CREATE POLICY "Allow all reads" ON public.stock_example_mapping FOR SELECT USING (true);
CREATE POLICY "Allow all inserts" ON public.stock_example_mapping FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all updates" ON public.stock_example_mapping FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all deletes" ON public.stock_example_mapping FOR DELETE USING (true);
