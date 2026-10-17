import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://support-mee.vercel.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/[username]'],
        disallow: [
          '/dashboard',
          '/settings',
          '/admin',
          '/activity',
          '/app',
          '/app/*',
          '/auth',
          '/auth/*',
          '/api/*',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
