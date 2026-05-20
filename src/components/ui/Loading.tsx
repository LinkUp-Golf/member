'use client'

import { cn } from '@/lib/utils'

// ---- Spinner ------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin',
        className
      )}
      role="status"
      aria-label="Loading"
    />
  )
}

// ---- Full screen loader -------------------------------------
export function FullScreenLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-cream">
      <div className="flex flex-col items-center gap-4">
        <div className="font-serif text-2xl italic text-green-900" style={{ color: '#85bb65' }}>
          LinkUp Golf
        </div>
        <Spinner className="text-green-700" />
      </div>
    </div>
  )
}

// ---- Skeleton block -----------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-green-50', className)}
    />
  )
}

// ---- Member row skeleton ------------------------------------
export function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3.5 px-5 py-3.5 border-b border-green-900/[0.06] last:border-0">
      <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
    </div>
  )
}

// ---- Card skeleton ------------------------------------------
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card card-pad space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === 0 ? 'w-3/4' : i === lines - 1 ? 'w-1/2' : 'w-full'}`} />
      ))}
    </div>
  )
}

// ---- Promo card skeleton ------------------------------------
export function PromoCardSkeleton() {
  return (
    <div className="card card-pad space-y-3 animate-pulse">
      <Skeleton className="h-2.5 w-16 rounded-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-8 w-24 rounded-xl mt-1" />
    </div>
  )
}
