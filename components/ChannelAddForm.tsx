'use client'

/**
 * ChannelAddForm component - form for adding new YouTube channels
 */

import { useState } from 'react'
import { Plus, AlertCircle, CheckCircle } from 'lucide-react'
import { addChannelAction } from '@/actions/channel-actions'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'

interface ChannelAddFormProps {
  onSuccess?: () => void
  onError?: (error: string) => void
  compact?: boolean
}

export default function ChannelAddForm({
  onSuccess,
  onError,
  compact = false,
}: ChannelAddFormProps) {
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    setIsLoading(true)
    setMessage(null)

    try {
      const result = await addChannelAction(input.trim())

      if (result.success) {
        setMessage({
          type: 'success',
          text: `${result.channel?.title} 채널이 추가되었습니다.`,
        })
        setInput('')
        onSuccess?.()

        setTimeout(() => setMessage(null), 3000)
      } else {
        const errorText = result.error || '채널 추가에 실패했습니다.'
        setMessage({ type: 'error', text: errorText })
        onError?.(errorText)
      }
    } catch (error) {
      const errorText = '오류가 발생했습니다.'
      setMessage({ type: 'error', text: errorText })
      onError?.(errorText)
      logger.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className={cn(
        'w-full min-w-0 overflow-hidden bg-white border border-gray-100',
        compact ? 'rounded-xl p-4 shadow-none' : 'rounded-2xl p-6 shadow-sm'
      )}
    >
      {!compact && (
        <h2 className="text-lg font-semibold text-gray-900 mb-4">채널 추가</h2>
      )}

      <form onSubmit={handleSubmit} className="w-full min-w-0 space-y-4">
        <div className="w-full min-w-0">
          {!compact && (
            <label
              htmlFor="channel-input"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              YouTube 채널 URL, @핸들 또는 채널 ID
            </label>
          )}

          <div
            className={cn(
              'w-full min-w-0',
              compact ? 'flex flex-col gap-2' : 'flex gap-2'
            )}
          >
            <input
              id="channel-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                compact
                  ? '@channelname 또는 URL'
                  : '예: @channelname, UCxxxxxx, 또는 https://youtube.com/@channelname'
              }
              className="w-full min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isLoading}
            />

            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className={cn(
                'rounded-lg font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap',
                compact ? 'w-full px-4 py-2 text-sm' : 'px-6 py-2',
                isLoading || !input.trim()
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              <Plus size={18} />
              추가
            </button>
          </div>
        </div>

        {message && (
          <div
            className={cn(
              'flex items-start gap-3 rounded-lg p-3',
              message.type === 'success'
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            )}
          >
            {message.type === 'success' ? (
              <CheckCircle size={18} className="text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            )}

            <p
              className={cn(
                'text-sm font-medium break-words',
                message.type === 'success' ? 'text-green-800' : 'text-red-800'
              )}
            >
              {message.text}
            </p>
          </div>
        )}

        {!compact && (
          <div className="text-xs text-gray-500 space-y-1">
            <p>• YouTube 채널의 URL을 직접 붙여넣기</p>
            <p>• @channelname 형식의 핸들 사용</p>
            <p>• UC로 시작하는 채널 ID 입력</p>
          </div>
        )}
      </form>
    </div>
  )
}