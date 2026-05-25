import Image from 'next/image'
import { cn } from '@/lib/utils'

interface LogoProps {
  size?: number
  className?: string
}

export default function Logo({ size = 48, className }: LogoProps) {
  return (
    <Image
      src="/linkup-golf.webp"
      alt="LinkUp Golf"
      width={size}
      height={size}
      className={cn('rounded-xl', className)}
      priority
    />
  )
}
