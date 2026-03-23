import { logger } from '@/lib/logger'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const INTERVAL_MS = 6 * 60 * 60 * 1000

    const runRefresh = async () => {
      try {
        const { refreshAllChannelsAction } = await import('./actions/channel-actions')
        await refreshAllChannelsAction()
        logger.log('[scheduler] Auto-refresh completed')
      } catch (err) {
        logger.error('[scheduler] Auto-refresh failed:', err)
      }
    }

    setInterval(runRefresh, INTERVAL_MS)
    logger.log('[scheduler] Auto-refresh scheduled every 6 hours')
  }
}
