import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'lat.md',
  description: 'Structure your codebase knowledge in markdown for humans and agents',
  openGraph: {
    title: 'lat.md — a knowledge graph for your codebase',
    description: 'Structure your codebase knowledge in markdown for humans and agents',
    url: 'https://lat.md',
    siteName: 'lat.md',
    images: [{ url: '/og.jpg', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'lat.md — a knowledge graph for your codebase',
    description: 'Structure your codebase knowledge in markdown for humans and agents',
    images: ['/og.jpg'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#000' }}>
        <style>{`
          body { line-height: 1.6; }
          a.foot { color: #777; text-decoration: none; border-bottom: 1px dotted #777; transition: color 0.2s, border-bottom-color 0.2s; }
          a.foot:hover { color: #ccc; border-bottom-color: #ccc; }
          ul li { padding-left: 2ch; text-indent: -2ch; }
          ul li + li { margin-top: 1em; }
          .nosel { -webkit-user-select: none; user-select: none; }
          @media (max-width: 600px) { body { padding-top: 8vh !important; } }
        `}</style>
        {children}
      </body>
    </html>
  )
}
