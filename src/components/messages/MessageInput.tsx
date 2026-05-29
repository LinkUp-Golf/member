'use client'

import { useState, useRef, useEffect } from 'react'
import { Spinner } from '@/components/ui/Loading'

interface Props {
  placeholder: string
  onSend: (body: string) => Promise<boolean>
  onTypingStart?: () => void
  onTypingStop?: () => void
  disabled?: boolean
}

export function MessageInput({ placeholder, onSend, onTypingStart, onTypingStop, disabled }: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stopTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleSend() {
    const text = body.trim()
    if (!text || sending || disabled) return

    setBody('')
    setSending(true)
    onTypingStop?.()
    if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current)

    const ok = await onSend(text)
    if (!ok) setBody(text) // restore on failure

    setSending(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setBody(e.target.value)

    if (e.target.value.trim()) {
      onTypingStart?.()
      if (stopTypingTimer.current) clearTimeout(stopTypingTimer.current)
      // Auto-stop typing signal if the user pauses for 3 s without sending
      stopTypingTimer.current = setTimeout(() => onTypingStop?.(), 3000)
    } else {
      onTypingStop?.()
    }
  }

  // Auto-resize textarea up to 120 px
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [body])

  return (
    <div className="flex items-end gap-2 px-4 py-3 bg-white border-t border-green-900/08" style={{ paddingBottom: 'max(12px, calc(12px + env(safe-area-inset-bottom)))' }}>
      <textarea
        ref={textareaRef}
        rows={1}
        placeholder={placeholder}
        value={body}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className="flex-1 bg-green-50 border border-green-900/10 rounded-2xl px-4 py-2 text-sm text-green-900 placeholder-green-900/35 outline-none resize-none min-h-[36px] max-h-[120px] leading-relaxed scrollbar-hide [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        autoComplete="off"
        aria-label="Message input"
      />
      <button
        onClick={handleSend}
        disabled={!body.trim() || sending || disabled}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40 mb-0.5"
        style={{ background: '#002669' }}
        aria-label="Send"
      >
        {sending ? (
          <Spinner className="text-gold w-4 h-4" />
        ) : (
          <SendIcon />
        )}
      </button>
    </div>
  )
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#85bb65' }}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  )
}
