import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kick Chat Overlay',
  description: 'Embeddable Kick chat for OBS browser source — like chatis, but for Kick.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
