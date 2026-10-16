// Static /terminal/<slug> page content, generated at build time by
// scripts/postbuild.mjs from schedule-data/latest.json. Pure functions with no
// browser APIs so Node can run them; Tailwind scans this file for classes.
// The section carries data-static-section: main.jsx hands it to App, which keeps
// it on the page under the live board after React mounts.
import { TERMINALS, SITE_URL, terminalPath } from './terminals.js';
import { CLASSES, escapeHtml } from './seoContent.js';
import { haversineMeters } from './geo.js';

const TIMEZONE = 'Australia/Brisbane';

const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });
const timeFormat = new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true });
const dateLabelFormat = new Intl.DateTimeFormat('en-AU', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const brisbaneDateKey = (date) => dateKeyFormat.format(date);

export const routeCode = (routeId) => routeId.split('-')[0];

export const routeLabel = (code) => {
  if (code === 'F1') return 'CityCat (all stops)';
  if (code === 'F11') return 'CityCat express';
  if (/^F1\d$/.test(code)) return 'CityCat';
  if (/^F2\d$/.test(code)) return 'Cross-river ferry';
  return 'Ferry';
};

const cleanName = (name) => (name || '').replace(/ ferry terminal$/i, '');

const byRouteCode = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/**
 * Pre-compute per-terminal data from the schedule file.
 * Returns Map<stopId, { date, dateLabel, rows, routes }>; empty when there is no schedule.
 */
export function buildTerminalData(schedule, now = new Date()) {
  const result = new Map();
  const departures = Array.isArray(schedule?.departures) ? schedule.departures : [];
  if (departures.length === 0) return result;

  const terminalIds = new Set(TERMINALS.map((t) => t.id));
  const nameById = new Map(TERMINALS.map((t) => [t.id, t.name]));

  // Last stop of each trip: a departure there is really an arrival.
  const lastSeq = new Map();
  // Terminals each route calls at, in GTFS order of first appearance.
  const routeStops = new Map();
  for (const d of departures) {
    lastSeq.set(d.tripId, Math.max(lastSeq.get(d.tripId) ?? -Infinity, d.stopSequence));
    if (terminalIds.has(d.stopId)) {
      const code = routeCode(d.routeId);
      if (!routeStops.has(code)) routeStops.set(code, new Set());
      routeStops.get(code).add(d.stopId);
    }
  }

  const today = brisbaneDateKey(now);
  for (const terminal of TERMINALS) {
    const own = departures.filter((d) => d.stopId === terminal.id && d.stopSequence < lastSeq.get(d.tripId));
    const routes = [...new Set(own.map((d) => routeCode(d.routeId)))].sort(byRouteCode).map((code) => ({
      code,
      label: routeLabel(code),
      stops: [...(routeStops.get(code) || [])].map((id) => nameById.get(id)).filter(Boolean).sort(),
    }));

    // Today's timetable; if the schedule file has nothing for today yet, the
    // next day it covers (labelled with that date). Never an earlier day.
    const byDate = new Map();
    for (const d of own) {
      const when = new Date(d.departureTime);
      if (Number.isNaN(when.getTime())) continue;
      const key = brisbaneDateKey(when);
      if (key < today) continue;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push({ when, d });
    }
    const date = [...byDate.keys()].sort()[0] || null;
    const seen = new Set();
    const rows = (date ? byDate.get(date) : [])
      .sort((a, b) => a.when - b.when)
      .map(({ when, d }) => ({
        time: timeFormat.format(when),
        route: routeCode(d.routeId),
        towards: cleanName(d.headsign) || 'Unknown',
      }))
      .filter((r) => {
        const key = `${r.time}|${r.route}|${r.towards}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    result.set(terminal.id, {
      date,
      dateLabel: date ? dateLabelFormat.format(new Date(`${date}T12:00:00+10:00`)) : null,
      isToday: date === today,
      rows,
      routes,
    });
  }
  return result;
}

export function nearbyTerminals(terminal, count = 3) {
  return TERMINALS.filter((t) => t.id !== terminal.id)
    .map((t) => ({ ...t, meters: haversineMeters(terminal.lat, terminal.lng, t.lat, t.lng) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, count);
}

const formatDistance = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

const routeList = (routes) => {
  const codes = routes.map((r) => r.code);
  if (codes.length <= 1) return codes.join('');
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]}`;
};

export function terminalMeta(terminal, data) {
  const routes = data?.routes?.length ? ` ${data.routes.length > 1 ? 'Routes' : 'Route'} ${routeList(data.routes)}.` : '';
  return {
    title: `Next ferry from ${terminal.name} - live CityCat times | Brisbane Ferry`,
    description: `Live ferry departures and today's timetable for ${terminal.name} ferry terminal, Brisbane.${routes} Real-time CityCat updates and nearby terminals.`,
    url: `${SITE_URL}${terminalPath(terminal.slug)}`,
  };
}

export function terminalJsonLd(terminal, meta) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BoatTerminal',
        '@id': `${meta.url}#terminal`,
        name: `${terminal.name} ferry terminal`,
        url: meta.url,
        geo: { '@type': 'GeoCoordinates', latitude: terminal.lat, longitude: terminal.lng },
        address: { '@type': 'PostalAddress', addressLocality: 'Brisbane', addressRegion: 'QLD', addressCountry: 'AU' },
        containedInPlace: { '@type': 'City', name: 'Brisbane' },
      },
      {
        '@type': 'WebPage',
        '@id': meta.url,
        url: meta.url,
        name: meta.title,
        description: meta.description,
        about: { '@id': `${meta.url}#terminal` },
        isPartOf: { '@id': `${SITE_URL}/#website` },
        inLanguage: 'en-AU',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Brisbane Ferry', item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 2, name: `${terminal.name} ferry terminal`, item: meta.url },
        ],
      },
    ],
  };
}

const T = {
  table: 'mt-2 w-full max-w-xl text-sm text-left',
  th: 'py-1 pr-4 font-semibold text-gray-700 border-b border-gray-300',
  td: 'py-1 pr-4 border-b border-gray-100',
  scroll: 'mt-2 max-h-96 overflow-y-auto max-w-xl rounded-lg bg-white/80 border border-ferry-orange/20 px-3',
  crumbs: 'text-xs text-gray-500',
  crumbLink: 'hover:text-ferry-orange underline',
};

export function terminalSectionHtml(terminal, data) {
  const name = escapeHtml(terminal.name);
  const routes = data?.routes || [];
  const rows = data?.rows || [];
  const nearby = nearbyTerminals(terminal);
  const others = TERMINALS.filter((t) => t.id !== terminal.id);
  const link = (t) => `<a class="${CLASSES.link}" href="${terminalPath(t.slug)}">${escapeHtml(t.name)}</a>`;

  const servedBy = routes.length
    ? ` It is served by ${routes.map((r) => `${escapeHtml(r.code)} (${escapeHtml(r.label)})`).join(', ')}.`
    : '';
  const dateLabel = data?.dateLabel ? escapeHtml(data.dateLabel) : null;
  const timetable = rows.length
    ? `
        <h2 class="${CLASSES.subheading}">Timetable for ${dateLabel}${data.isToday ? '' : ' (next day available)'}</h2>
        <p class="${CLASSES.text}">Scheduled departures from ${name} from ${escapeHtml(rows[0].time)}, Brisbane time, from the daily TransLink timetable. Live times are on the board above.</p>
        <div class="${T.scroll}">
          <table class="${T.table}">
            <thead><tr><th scope="col" class="${T.th}">Departs</th><th scope="col" class="${T.th}">Route</th><th scope="col" class="${T.th}">Towards</th></tr></thead>
            <tbody>
${rows.map((r) => `              <tr><td class="${T.td}">${escapeHtml(r.time)}</td><td class="${T.td}">${escapeHtml(r.route)}</td><td class="${T.td}">${escapeHtml(r.towards)}</td></tr>`).join('\n')}
            </tbody>
          </table>
        </div>`
    : `
        <h2 class="${CLASSES.subheading}">Timetable</h2>
        <p class="${CLASSES.text}">The scheduled timetable is not available right now. The live board above shows the next departures.</p>`;

  const routesHtml = routes.length
    ? `
        <h2 class="${CLASSES.subheading}">Routes</h2>
        <ul class="${CLASSES.text} list-disc pl-5">
${routes.map((r) => `          <li><strong>${escapeHtml(r.code)}</strong> ${escapeHtml(r.label)}: ${r.stops.map(escapeHtml).join(', ')}</li>`).join('\n')}
        </ul>`
    : '';

  return `
      <section class="${CLASSES.section}" data-static-section data-terminal-page="${escapeHtml(terminal.slug)}" aria-labelledby="terminal-heading">
        <nav aria-label="Breadcrumb" class="${T.crumbs}"><a class="${T.crumbLink}" href="/">Brisbane Ferry</a> › ${name} ferry terminal</nav>
        <h1 id="terminal-heading" class="${CLASSES.heading}">Next ferry from ${name}</h1>
        <p class="${CLASSES.text}">Live CityCat and ferry departures from ${name} ferry terminal on the Brisbane River.${servedBy} The board above updates with real-time TransLink data; pick any destination to see services in both directions.</p>${routesHtml}${timetable}
        <h2 class="${CLASSES.subheading}">Nearby terminals</h2>
        <ul class="${CLASSES.list}">
${nearby.map((t) => `          <li>${link(t)} <span class="text-xs text-gray-500">${formatDistance(t.meters)}</span></li>`).join('\n')}
        </ul>
        <h2 class="${CLASSES.subheading}">All ferry terminals</h2>
        <ul class="${CLASSES.list}">
${others.map((t) => `          <li>${link(t)}</li>`).join('\n')}
        </ul>
        <p class="${CLASSES.text}"><a class="${T.crumbLink}" href="/">Live departure boards for every Brisbane ferry terminal</a></p>
      </section>`;
}
