'use client'

import AppShell from '@/components/AppShell'
import EmptyState from '@/components/EmptyState'
import { LoadingGridSkeleton } from '@/components/LoadingSkeleton'
import VideoListPanel from '@/components/VideoListPanel'
import VideoDetailPanel from '@/components/VideoDetailPanel'
import NewsPanel from '@/components/NewsPanel'
import { useDashboard } from '@/hooks/useDashboard'
import { removeChannelAction } from '@/actions/channel-actions'

export default function DashboardPage() {
  const panelMaxHeight = 'calc(100vh - 64px - 40px)'

  const {
    channels,
    isLoading,
    selectedVideoId,
    setSelectedVideoId,
    selectedChannelIds,
    setSelectedChannelIds,
    videoSortMode,
    setVideoSortMode,
    visibleCount,
    setVisibleCount,
    summaryLoadingVideoId,
    summaryElapsedSeconds,
    confirmedUnavailableIds,
    favoriteIds,
    togglingIds,
    refreshStatus,
    newsByVideoId,
    stocksByVideoId,
    newsLoadingVideoId,
    newsErrorByVideoId,
    domesticNewsItems,
    overseasNewsItems,
    newsPanelLoading,
    newsPanelError,
    newsPanelCollapsed,
    setNewsPanelCollapsed,
    supadataQuota,
    externalChannelVideosById,
    externalChannelVideoLoadingById,
    externalChannelVideoErrorById,
    relatedVideoRecommendationsById,
    sortedVideos,
    selectedVideo,
    weeklyVideoCount,
    channelThumbById,
    filterText,
    setFilterText,
    videoListRef,
    loadData,
    loadRelatedNews,
    loadNewsChannelPanel,
    handleManualRefresh,
    handleRefreshSummary,
    handleChannelGroupChanged,
    handleChannelOrderChanged,
    toggleFavorite,
    refreshRelatedVideos,
    isNewVideo,
    getChannelDisplayName,
    getChannelModes,
    getEmptyNewsMessage,
    formatPublishedDate,
  } = useDashboard()

  const shellProps = {
    channels,
    onChannelAdded:    loadData,
    onChannelRemoved:  async (channelId: string) => {
      await removeChannelAction(channelId)
      await loadData()
    },
    onChannelSelected: (id: string) => setSelectedChannelIds(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    ),
    onChannelGroupChanged: handleChannelGroupChanged,
    onChannelOrderChanged: handleChannelOrderChanged,
    onChannelClearFilter: () => setSelectedChannelIds([]),
    selectedChannelIds,
    newVideoCount:     refreshStatus?.newVideoCount ?? 0,
    onManualRefresh:   handleManualRefresh,
  }

  const detailPanelProps = {
    summaryLoadingVideoId,
    summaryElapsedSeconds,
    confirmedUnavailableIds,
    favoriteIds,
    togglingIds,
    newsByVideoId,
    stocksByVideoId,
    newsLoadingVideoId,
    newsErrorByVideoId,
    externalChannelVideosById,
    externalChannelVideoLoadingById,
    externalChannelVideoErrorById,
    relatedVideoRecommendationsById,
    isNewVideo,
    getChannelModes,
    getEmptyNewsMessage,
    formatPublishedDate,
    onToggleFavorite: toggleFavorite,
    onRefreshSummary: handleRefreshSummary,
    onRefreshNews: (videoId: string, cacheKey: string, target: 'news') =>
      void loadRelatedNews(videoId, cacheKey, target),
    onRefreshRelatedVideos: refreshRelatedVideos,
  }

  if (isLoading) {
    return <AppShell {...shellProps}><LoadingGridSkeleton count={6} /></AppShell>
  }

  return (
    <AppShell {...shellProps}>
      <div className={`grid grid-cols-1 gap-4 xl:text-slate-900 ${newsPanelCollapsed ? 'xl:grid-cols-[350px_minmax(0,1fr)_auto]' : 'xl:grid-cols-[350px_minmax(0,1fr)_280px]'}`}>

        {/* ── 좌측: 영상 목록 ──────────────────────────────────────────── */}
        <VideoListPanel
          sortedVideos={sortedVideos}
          selectedVideo={selectedVideo}
          selectedVideoId={selectedVideoId}
          setSelectedVideoId={setSelectedVideoId}
          visibleCount={visibleCount}
          setVisibleCount={setVisibleCount}
          videoSortMode={videoSortMode}
          setVideoSortMode={setVideoSortMode}
          weeklyVideoCount={weeklyVideoCount}
          filterText={filterText}
          setFilterText={setFilterText}
          channelThumbById={channelThumbById}
          panelMaxHeight={panelMaxHeight}
          videoListRef={videoListRef}
          getChannelDisplayName={getChannelDisplayName}
          {...detailPanelProps}
        />

        {/* ── 가운데: 영상 상세 ────────────────────────────────────────── */}
        <div
          className="hidden xl:block border border-slate-100 rounded-2xl bg-white shadow-[0_1px_4px_rgba(16,24,40,0.06)] p-5 overflow-y-auto"
          style={{ maxHeight: panelMaxHeight }}
        >
          {selectedVideo ? (
            <VideoDetailPanel video={selectedVideo} {...detailPanelProps} />
          ) : (
            <EmptyState
              title="영상을 선택하세요"
              description="좌측 목록에서 영상을 클릭하면 상세 정보가 표시됩니다."
            />
          )}
        </div>

        {/* ── 우측: 뉴스 채널 최신 제목 ───────────────────────────────── */}
        <NewsPanel
          domesticNewsItems={domesticNewsItems}
          overseasNewsItems={overseasNewsItems}
          newsPanelLoading={newsPanelLoading}
          newsPanelError={newsPanelError}
          newsPanelCollapsed={newsPanelCollapsed}
          setNewsPanelCollapsed={setNewsPanelCollapsed}
          supadataQuota={supadataQuota}
          panelMaxHeight={panelMaxHeight}
          onRefreshNewsPanel={(refresh) => void loadNewsChannelPanel(refresh)}
        />

      </div>
    </AppShell>
  )
}
