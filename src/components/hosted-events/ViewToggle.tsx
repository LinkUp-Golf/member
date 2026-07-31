import Link from 'next/link'
import { List, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'

// List ⇄ Calendar switch shared by the hosted-events browse page and its
// calendar view. Each side is a plain link to the other route.

export default function HostedEventsViewToggle({ active }: { active: 'list' | 'calendar' }) {
  const tab = 'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors'
  const on = 'bg-white text-green-950 shadow-sm'
  const off = 'text-green-900/50 hover:text-green-900/70'

  return (
    <div className="flex gap-1 p-1 bg-green-900/5 rounded-xl mb-4">
      <Link href="/more/hosted-events" className={cn(tab, active === 'list' ? on : off)}>
        <List className="w-4 h-4" strokeWidth={2} />
        List
      </Link>
      <Link href="/more/hosted-events/calendar" className={cn(tab, active === 'calendar' ? on : off)}>
        <CalendarDays className="w-4 h-4" strokeWidth={2} />
        Calendar
      </Link>
    </div>
  )
}
