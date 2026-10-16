// Post-build SEO step, run by `npm run build` after `vite build`.
//  - dist/terminal/<slug>/index.html for every ferry terminal: the built
//    index.html (same app bundle) with its own title, description, canonical,
//    OG tags, JSON-LD and a static timetable section from schedule-data.
//  - dist/404.html: the app with a "page not found" section, noindex.
//  - dist/sitemap.xml with absolute canonical (www.brisbaneferry.com) URLs.
// A missing or unreadable schedule-data/latest.json must not fail the build
// (the daily data commit triggers the production deploy): terminal pages are
// still written, without a timetable.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL, TERMINALS, terminalPath } from '../src/utils/terminals.js';
import { CLASSES, escapeHtml, seoShellHtml } from '../src/utils/seoContent.js';
import { buildTerminalData, terminalJsonLd, terminalMeta, terminalSectionHtml } from '../src/utils/terminalPage.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const templatePath = path.join(distDir, 'index.html');

if (!existsSync(templatePath)) {
  console.error('postbuild: dist/index.html not found; run `vite build` first');
  process.exit(1);
}

const now = new Date();
// Brisbane calendar date of this build (pages are rebuilt daily with new data).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(now);

function loadSchedule() {
  const file = path.join(rootDir, 'schedule-data', 'latest.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.warn(`postbuild: no usable schedule-data/latest.json (${error.code || error.message}); terminal pages will have no timetable`);
    return null;
  }
}

function replaceOnce(html, pattern, replacement, label) {
  let count = 0;
  const out = html.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count !== 1) throw new Error(`postbuild: expected exactly one ${label} in dist/index.html, found ${count}`);
  return out;
}

const template = readFileSync(templatePath, 'utf8');
const homeShell = seoShellHtml();
if (!template.includes(homeShell)) {
  throw new Error('postbuild: dist/index.html does not contain the seo-shell output (vite.config.js seoShell plugin)');
}

const attr = (s) => escapeHtml(s);

function renderPage({ title, description, url, jsonLd, sectionHtml, noindex = false }) {
  let html = template;
  html = replaceOnce(html, /<title>[^<]*<\/title>/g, `<title>${escapeHtml(title)}</title>`, '<title>');
  html = replaceOnce(html, /<meta name="description" content="[^"]*" \/>/g, `<meta name="description" content="${attr(description)}" />`, 'meta description');
  html = replaceOnce(
    html,
    /<link rel="canonical" href="[^"]*" \/>/g,
    noindex ? '<meta name="robots" content="noindex" />' : `<link rel="canonical" href="${attr(url)}" />`,
    'canonical',
  );
  html = replaceOnce(html, /<meta property="og:url" content="[^"]*" \/>/g, `<meta property="og:url" content="${attr(url)}" />`, 'og:url');
  for (const key of ['og:title', 'twitter:title']) {
    const kind = key.startsWith('og:') ? 'property' : 'name';
    html = replaceOnce(html, new RegExp(`<meta ${kind}="${key}" content="[^"]*" />`, 'g'), `<meta ${kind}="${key}" content="${attr(title)}" />`, key);
  }
  for (const key of ['og:description', 'twitter:description']) {
    const kind = key.startsWith('og:') ? 'property' : 'name';
    html = replaceOnce(html, new RegExp(`<meta ${kind}="${key}" content="[^"]*" />`, 'g'), `<meta ${kind}="${key}" content="${attr(description)}" />`, key);
  }
  html = replaceOnce(
    html,
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
    jsonLd ? `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2).replace(/</g, '\\u003c')}\n    </script>` : '',
    'JSON-LD block',
  );
  return html.replace(homeShell, seoShellHtml(sectionHtml));
}

function writePage(relPath, html) {
  const file = path.join(distDir, relPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
}

// Terminal pages
const terminalData = buildTerminalData(loadSchedule(), now);
let withTimetable = 0;
for (const terminal of TERMINALS) {
  const data = terminalData.get(terminal.id);
  if (data?.rows.length) withTimetable += 1;
  const meta = terminalMeta(terminal, data);
  writePage(
    path.join('terminal', terminal.slug, 'index.html'),
    renderPage({ ...meta, jsonLd: terminalJsonLd(terminal, meta), sectionHtml: terminalSectionHtml(terminal, data) }),
  );
}

// 404 page (Vercel serves dist/404.html for unknown paths). The app still
// loads, so the visitor gets the live board plus this notice.
const notFoundSection = `
      <section class="${CLASSES.section}" data-static-section aria-labelledby="not-found-heading">
        <h1 id="not-found-heading" class="${CLASSES.heading}">Page not found</h1>
        <p class="${CLASSES.text}">That page doesn't exist. The live departure board is above, or pick a ferry terminal:</p>
        <ul class="${CLASSES.list}">
${TERMINALS.map((t) => `          <li><a class="${CLASSES.link}" href="${terminalPath(t.slug)}">${escapeHtml(t.name)}</a></li>`).join('\n')}
        </ul>
      </section>`;
writePage(
  '404.html',
  renderPage({
    title: 'Page not found | Brisbane Ferry',
    description: 'This page does not exist. See live Brisbane ferry departures for every terminal.',
    url: `${SITE_URL}/`,
    jsonLd: null,
    sectionHtml: notFoundSection,
    noindex: true,
  }),
);

// Sitemap
const urls = [
  { loc: '/', lastmod: today, changefreq: 'daily', priority: '1.0' },
  ...TERMINALS.map((t) => ({ loc: terminalPath(t.slug), lastmod: today, changefreq: 'daily', priority: '0.8' })),
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
console.log(
  `postbuild: wrote ${TERMINALS.length} terminal pages (${withTimetable} with a timetable), 404.html and sitemap.xml (${urls.length} URLs)`,
);
