import Image from 'next/image'
import { getInitials, capitalizeName, cn } from '@/lib/utils'

interface AvatarProps {
  firstName: string
  lastName: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'avatar-sm',
  md: 'avatar-md',
  lg: 'avatar-lg',
  xl: 'avatar-xl',
}

const FONT_SIZES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
  xl: 'text-3xl',
}

const PX_SIZES = {
  sm: 36,
  md: 44,
  lg: 64,
  xl: 80,
}

export default function Avatar({ firstName, lastName, avatarUrl, size = 'md', className }: AvatarProps) {
  const first = capitalizeName(firstName)
  const last = capitalizeName(lastName)
  const initials = getInitials(first, last)

  if (avatarUrl) {
    return (
      <div className={cn('avatar overflow-hidden', SIZE_CLASSES[size], className)}>
        <Image
          src={avatarUrl}
          alt={`${first} ${last}`}
          width={PX_SIZES[size]}
          height={PX_SIZES[size]}
          className="w-full h-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn('avatar font-serif', SIZE_CLASSES[size], FONT_SIZES[size], className)}
      aria-label={`${first} ${last}`}
    >
      {initials}
    </div>
  )
}
