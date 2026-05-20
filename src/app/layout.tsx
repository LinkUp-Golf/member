import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import dynamic from 'next/dynamic'
import SessionProvider from '@/components/providers/SessionProvider'
import './globals.css'

// process.env.NODE_ENV is a compile-time constant — webpack replaces it with
// the literal string at build time. In production the entire dynamic import()
// branch becomes dead code and is eliminated from the bundle. MSW and all
// mock fixtures are never shipped to production.
const MockProvider = process.env.NODE_ENV === 'development'
  ? dynamic(() => import('@/components/dev/MockProvider'), { ssr: false })
  : ({ children }: { children: React.ReactNode }) => <>{children}</>

const lexendDeca = localFont({
  src: '../../public/fonts/LexendDeca-VariableFont_wght.ttf',
  variable: '--font-lexend',
  display: 'swap',
})

const caveatBrush = localFont({
  src: '../../public/fonts/CaveatBrush-Regular.ttf',
  variable: '--font-caveat',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LinkUp Golf',
  description: 'The LinkUp Golf member community',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LinkUp Golf',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#002669',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${lexendDeca.variable} ${caveatBrush.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="font-sans bg-cream antialiased">
        <MockProvider>
          <SessionProvider>
            {children}
          </SessionProvider>
        </MockProvider>
      </body>
    </html>
  )
}
