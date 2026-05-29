interface Props {
  online: boolean
  className?: string
}

export function PresenceIndicator({ online, className = '' }: Props) {
  return (
    <span
      aria-label={online ? 'Online' : 'Offline'}
      className={`inline-block rounded-full border-2 border-white ${
        online ? 'bg-green-400' : 'bg-gray-300'
      } ${className}`}
      style={{ width: 10, height: 10 }}
    />
  )
}
