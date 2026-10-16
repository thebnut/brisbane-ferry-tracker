// Crawlable copy shown on the home page. Used twice:
//  - src/components/SiteIntro.jsx renders it inside the React app.
//  - seoShellHtml() below is injected into #root of index.html at build time
//    (vite.config.js), so the text and terminal links are in the raw HTML
//    before React mounts. React's createRoot replaces it with the same layout.
// Keep the two in step. Tailwind scans this file, so classes here are emitted.
import { TERMINALS, terminalPath } from './terminals.js';

export const INTRO_HEADING = 'Brisbane ferry times: live CityCat departures';
export const INTRO_TEXT =
  'Live departure boards for every Brisbane River ferry terminal. Pick any two terminals to see the next CityCat, ' +
  'express CityCat and cross-river ferry services in both directions, with real-time updates from TransLink and the ' +
  'full timetable for the next 24 hours.';
export const TERMINALS_HEADING = 'Ferry terminals';

export const CLASSES = {
  section: 'container mx-auto px-4 max-w-6xl pt-4 pb-2 text-charcoal',
  heading: 'text-lg md:text-xl font-bold text-ferry-aqua',
  text: 'mt-2 text-sm text-gray-600 max-w-3xl',
  subheading: 'mt-4 text-sm font-semibold text-gray-700',
  list: 'mt-2 flex flex-wrap gap-2 text-sm',
  link: 'inline-block px-3 py-1 rounded-full bg-white/80 border border-ferry-orange/20 text-ferry-aqua hover:text-ferry-orange hover:border-ferry-orange/50 transition-colors',
};

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const introSectionHtml = () => `
      <section class="${CLASSES.section}" aria-labelledby="site-intro-heading">
        <h1 id="site-intro-heading" class="${CLASSES.heading}">${escapeHtml(INTRO_HEADING)}</h1>
        <p class="${CLASSES.text}">${escapeHtml(INTRO_TEXT)}</p>
        <h2 class="${CLASSES.subheading}">${escapeHtml(TERMINALS_HEADING)}</h2>
        <ul class="${CLASSES.list}">
${TERMINALS.map((t) => `          <li><a class="${CLASSES.link}" href="${terminalPath(t.slug)}">${escapeHtml(t.name)}</a></li>`).join('\n')}
        </ul>
      </section>`;

// Static stand-in for the app's first (loading) render: nav, status bar and
// spinner mirror Navigation, StatusBar and LoadingSpinner so the swap to React
// is not visible. Interactive bits are inert until React takes over.
export const seoShellHtml = () => `
    <div class="min-h-screen bg-gray-50">
      <nav class="bg-gradient-to-r from-white via-ferry-orange-light to-ferry-light-blue shadow-xl sticky top-0 z-50 border-b-2 border-ferry-orange/50">
        <div class="container mx-auto px-4 max-w-6xl">
          <div class="flex items-center justify-between py-1">
            <div class="flex items-start">
              <img src="/bf.com_logo.png" alt="Brisbane Ferry Tracker" width="489" height="199" fetchpriority="high" class="h-16 md:h-28 w-auto max-w-[200px] md:max-w-none" />
            </div>
            <div class="flex items-center space-x-2 md:space-x-3">
              <span class="flex items-center space-x-2 text-xs md:text-sm font-semibold text-ferry-aqua bg-white/90 pl-3 pr-2 md:pl-4 md:pr-3 py-1.5 rounded-full shadow-md border border-ferry-orange/20"><span>Settings</span><span class="inline-block w-4 md:w-5 h-4 md:h-5"></span></span>
              <span class="text-xs text-white font-bold bg-ferry-orange px-3 md:px-4 py-1.5 rounded-full shadow-lg">LIVE</span>
            </div>
          </div>
        </div>
      </nav>
      <div class="bg-gradient-to-r from-white to-ferry-orange-light/50 border-b border-ferry-orange/20">
        <div class="container mx-auto px-4 max-w-6xl py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-sm text-charcoal">
              <div class="flex items-center space-x-1"><span class="inline-block w-4 h-4"></span><span>Last Updated:</span></div>
              <div class="font-semibold flex items-center text-ferry-aqua">Never<span class="ml-2 p-1 inline-block"><span class="block h-4 w-4"></span></span></div>
            </div>
            <div class="flex items-center space-x-2">
              <span class="flex items-center space-x-2 px-4 py-2 rounded-lg font-medium shadow-md bg-white text-ferry-orange border-2 border-ferry-orange"><span class="inline-block w-4 h-4"></span><span class="text-sm sm:text-base">Map</span></span>
            </div>
          </div>
        </div>
      </div>
      <main class="container mx-auto px-4 max-w-6xl py-8 min-h-screen">
        <div class="flex flex-col items-center justify-center py-12">
          <div class="relative">
            <div class="h-20 w-20 rounded-full bg-gradient-to-r from-ferry-orange to-ferry-sunset p-1 animate-pulse">
              <div class="h-full w-full rounded-full bg-white/90 flex items-center justify-center"><span class="text-3xl">⛴️</span></div>
            </div>
            <div class="absolute top-0 left-0 h-20 w-20 rounded-full border-4 border-ferry-orange border-t-transparent animate-spin"></div>
          </div>
          <p class="mt-4 text-ferry-aqua font-bold text-lg">Loading ferry times...</p>
        </div>
      </main>${introSectionHtml()}
    </div>
  `;
