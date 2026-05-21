const withPWA = require('next-pwa')({
  dest: 'public',
  register: false,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.linkup\.golf\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-cache',
        expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        networkTimeoutSeconds: 10,
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'image-cache',
        expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
  ],
})

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Remove X-Powered-By header — minor hardening + saves a response header byte
  poweredByHeader: false,

  // Ship AVIF first (45–55% smaller than JPEG), fall back to WebP, then original.
  // next/image will auto-negotiate based on the Accept header.
  images: {
    formats: ['image/avif', 'image/webp'],
    domains: [
      'your-supabase-project.supabase.co', // replace with your Supabase project URL
    ],
  },

  // Strip console.log/debug/info in production builds; keep warn and error.
  // This shaves a few KB from every page bundle and avoids leaking internal
  // data into the browser console on prod.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },

  // Tells Next.js's SWC transform to barrel-import only the named exports that
  // are actually used from these packages, so tree-shaking works even when the
  // package re-exports everything from a barrel index.
  experimental: {
    optimizePackageImports: ['date-fns', 'clsx'],
  },
}

module.exports = withBundleAnalyzer(withPWA(nextConfig))
