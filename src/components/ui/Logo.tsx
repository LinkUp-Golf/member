import Image from 'next/image'
import { cn } from '@/lib/utils'

type LogoVariant = 'color' | 'white' | 'full-color' | 'on-dark' | 'on-green'

const VARIANT_SRC: Record<LogoVariant, string> = {
  'color':      '/linkup-golf.webp',
  'white':      '/logos/logo-white.png',
  'full-color': '/logos/logo-full-color.png',
  'on-dark':    '/logos/logo-on-dark.png',
  'on-green':   '/logos/logo-on-green.png',
}

interface LogoProps {
  size?: number
  className?: string
  variant?: LogoVariant
}

export default function Logo({ size = 48, className, variant = 'color' }: LogoProps) {
  return (
    <Image
      src={VARIANT_SRC[variant]}
      alt="LinkUp Golf"
      width={size}
      height={size}
      className={cn(variant === 'color' ? 'rounded-xl' : '', className)}
      priority
    />
  )
}
