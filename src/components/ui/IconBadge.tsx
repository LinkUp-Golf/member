// Shared unread-count badge for icon buttons (NotificationBell, MessagesIcon).
export default function IconBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full text-[9px] font-bold leading-none text-white bg-danger">
      {count > 99 ? '99+' : count}
    </span>
  )
}
