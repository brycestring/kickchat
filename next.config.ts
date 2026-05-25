import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // Pin Turbopack root to this project so Next doesn't pick up an unrelated
  // lockfile that happens to live in the user's home directory.
  turbopack: { root: path.join(__dirname) },
  // Kick CDN serves user avatars + emotes. Allow them as images.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'files.kick.com' },
      { protocol: 'https', hostname: 'kick.com' },
    ],
  },
}

export default nextConfig
