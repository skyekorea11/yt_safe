import { videoRepository } from '../supabase/videos'
import { summaryService } from '../summarization/summary-service'
import { logger } from '@/lib/logger'

async function main() {
  logger.log('Fetching existing videos from database...')
  const videos = await videoRepository.getAll()
  logger.log(`Found ${videos.length} videos, generating summaries/transcripts...`)

  for (const v of videos) {
    try {
      // this will run the full pipeline (transcript then summary) if needed
      await summaryService.getSummary(v.youtube_video_id, v.title, v.description)
    } catch (err) {
      logger.error('Error processing video', v.youtube_video_id, err)
    }
  }

  logger.log('Precompute complete')
}

main().catch((e) => {
  logger.error('Precompute script failed', e)
  process.exit(1)
})
