import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin Turbopack root to this project so Next doesn't pick up an unrelated
  // lockfile that happens to live above the project (mostly relevant locally).
  turbopack: { root: process.cwd() },
  // Kick CDN serves user avatars + emotes. Allow them as images.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'files.kick.com' },
      { protocol: 'https', hostname: 'kick.com' },
    ],
  },
}

export default nextConfig
