interface Props {
  names: string[]
}

export function TypingIndicator({ names }: Props) {
  if (names.length === 0) return null

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : 'Several people are typing'

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      {/* Animated dots */}
      <div className="flex gap-0.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-green-900/35 animate-bounce"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>
      <span className="text-xs text-green-900/40 italic">{label}…</span>
    </div>
  )
}
