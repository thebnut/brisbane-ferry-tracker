// Post-build SEO step, run by `npm run build` after `vite build`.
// Writes dist/sitemap.xml with absolute canonical (www.brisbaneferry.com) URLs.
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../src/utils/terminals.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

if (!existsSync(distDir)) {
  console.error('postbuild: dist/ not found; run `vite build` first');
  process.exit(1);
}

// Brisbane calendar date of this build (pages are rebuilt daily with new data).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());

const urls = [
  { loc: '/', lastmod: today, changefreq: 'daily', priority: '1.0' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.2' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.2' },
];

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(({ loc, lastmod, changefreq, priority }) =>
    [
      '  <url>',
      `    <loc>${SITE_URL}${loc}</loc>`,
      lastmod && `    <lastmod>${lastmod}</lastmod>`,
      changefreq && `    <changefreq>${changefreq}</changefreq>`,
      priority && `    <priority>${priority}</priority>`,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n'),
  )
  .join('\n')}
</urlset>
`;

writeFileSync(path.join(distDir, 'sitemap.xml'), xml);
console.log(`postbuild: wrote sitemap.xml (${urls.length} URLs)`);
