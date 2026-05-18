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
    <div className="flex items-center gap-3 px-4 py-3">
      <Skeleton className="w-11 h-11 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
    </div>
  )
}

// ---- Top bar skeleton ---------------------------------------
export function TopBarSkeleton({ hasSubtitle = true }: { hasSubtitle?: boolean }) {
  return (
    <div className="top-bar">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-28 bg-white/10" />
          {hasSubtitle && <Skeleton className="h-3 w-20 bg-white/10" />}
        </div>
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
