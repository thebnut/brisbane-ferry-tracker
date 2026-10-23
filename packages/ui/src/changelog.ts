/**
 * The public "What's new" list (/whats-new in every app), newest first. Add one entry per production release: the
 * date it went live (Brisbane) and a plain-English, rider-facing summary. Public copy only: no PR numbers, internal
 * names, infrastructure, vendors, security detail or anything switched off in production.
 */
export interface ChangelogEntry {
  /** Release date in Brisbane, YYYY-MM-DD. */
  date: string
  summary: string
  items?: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-10-23',
    summary: 'A bigger, clearer Save button on every ferry, train and bus board.',
    items: [
      'Tap Save on a board to add it to My Transit, and tap again to take it off. Undo is there if you change your mind.',
      'Save as many ferry trips as you like, not just one.',
      'Train boards save the station on its own, or with where you’re going.',
      'BrisbaneTransit has one simpler header on every page: a back button and the settings gear on phones, and every mode in one bar on computers.',
      'On BrisbaneTransit boards, “Live · updated 12 s ago” now sits just above the departures. Tap it to refresh.',
      'While a BrisbaneTransit page loads, the header says “Connecting…” instead of briefly showing Offline.',
      'BrisbaneTrain says “Connecting…” too while a station’s times are still on their way, instead of showing Live before they arrive.',
      'When a board first opens with timetable times while its live times are still on their way, it says “Connecting…” instead of briefly showing Offline and “Live times delayed”, on every site.',
      'On the Brisbane Ferry, BrisbaneTrain and BrisbaneBus sites, pages without live times (like the map, the station list and What’s new) no longer show a Live badge.',
      'If your browser isn’t keeping changes, Save now tells you so instead of saying it saved.',
      'On BrisbaneTransit phones, the five tabs are now the only bar at the bottom of the screen, so nothing covers the last departures.',
      'Find a station or a stop from the search at the top of the Train and Bus tabs. Each board has a Map button and shows its alerts.',
      'Tap the tab you’re on again to go back to that mode’s home.',
      'The “Set up your favourite stops?” question now sits at the top of My Transit instead of floating over the boards.',
      'Every board now lists departures the same way: what you board on the left, where it goes, a dot and a word for live or scheduled, and a big countdown.',
      'Train departures show the platform on the line’s colour, with an orange ring when the platform has changed.',
      'Ferry departures show the service (F1, F11) and where the ferry is heading.',
      'Departures after midnight sit under a “Tomorrow” heading instead of a date on every time.',
      'The first service you can still catch is the one highlighted, on every board, never a cancelled one.',
      'Every board starts the same way: what kind of stop it is, its name, its routes or platforms and alerts, and the Save button.',
      'One row of filters under it: All, where you’re going, Express, Map and a “Now” button to see departures from a later time, now on train and bus boards too.',
      'Ferry terminals work like train stations: a terminal’s page lists every ferry leaving it, and “To…” narrows it to one destination. Links to your saved ferry trips open with the destination set.',
      'With a destination set, the ⇄ button flips your trip the other way.',
      'Tap a departure on any board to open its trip, laid out the same for ferries, trains and buses: when it leaves and arrives, and its stops starting from yours, with the earlier ones tucked away.',
      'Ferry trips now open as their own page you can share, instead of a pop-up, and ‹ takes you back to the board where you left it.',
      'Save from a trip too: it saves the stop you board at, and where you’re getting off when you chose a destination.',
      'Trip pages leave out details that aren’t known, instead of showing “—” or “Not reported”.',
      'On a computer, tapping a departure opens its trip beside the board, so you can check one service after another. Back or Esc closes it, and “Open full page” gives it the whole screen.',
      'With a destination set on a computer, the trips back the other way sit beside the board. Without one, there’s a small map of the stop and what’s heading there.',
      'Extra services run outside the timetable now show where they’re going and their platform, and say “Extra service” instead of a delay.',
      'Ferry, Train and Bus each open on the same simple home: a search, your saved trips and stops, the nearest ones once you choose to share your location, and popular places.',
      'Your first saved ferry trip sits at the top of Ferry with a big countdown to its next departure. Save a trip with the star on any board.',
      'Ferry has a full-screen live map like Train and Bus: every terminal and every ferry with GPS. Open it from Ferry’s home or a terminal’s Map button.',
      'A board’s Map button opens the map on that terminal, station or stop, and “Track on map” on a trip follows your ferry, train or bus.',
      'The bus map draws stops once you zoom in to streets, so it stays quick when you look at the whole city.',
    ],
  },
  {
    date: '2026-10-21',
    summary:
      'Quicker recovery when your connection drops out, and clearer messages when something can’t load.',
    items: [
      'Departure boards reconnect faster after a dropped connection, usually within a second or two.',
      'No more false “Offline” warnings on phones whose clock runs a little fast.',
      'If a page can’t load, you now see a clear message and a Try again button instead of a generic error.',
      'On bus search, one Try again now reloads every list that didn’t load.',
      'The first-visit setup sheet now sits clear of the bottom tabs on smaller phones.',
    ],
  },
  {
    date: '2026-10-20',
    summary: 'A new My Transit home, picking stops on a map, and bus route search.',
    items: [
      'Your home screen is now My Transit, and the tabs run My Transit, Nearby, Ferry, Train and Bus on phones and desktops.',
      'A quick first-visit setup lets you choose your stops on a map, in every app.',
      'Search for a bus route by its number.',
      'Maps now work on devices without 3D graphics, and map labels load reliably.',
      'Clearer ferry trip names, and Ask now understands station groups and the airport.',
      'Behind-the-scenes improvements that make live times more accurate and reliable, even on a patchy connection.',
    ],
  },
  {
    date: '2026-10-20',
    summary: 'Bus route pages, named stops on trip views and a smarter Ask box.',
    items: [
      'Every bus route now has its own page.',
      'Bus and ferry trip views name every stop instead of showing stop numbers.',
      'Ask understands “southbank” written as one word, and tells you clearly when it can’t find a stop.',
      'Live times keep updating smoothly even when a refresh is slow.',
    ],
  },
  {
    date: '2026-10-19',
    summary: 'Send us feedback from any app, plus a round of reliability fixes.',
    items: [
      'A Send Feedback & Ideas link in the footer of every app.',
      '“Last updated” now shows when live times last arrived.',
      'Pages no longer hang on a slow network, and the bus boards behave better offline.',
      'Faster repeat visits.',
      'Behind-the-scenes improvements that make the app faster and more reliable.',
    ],
  },
  {
    date: '2026-10-19',
    summary: 'Live departure boards for ferries, trains and buses, all in one place.',
    items: [
      'Live boards for every ferry terminal, train station and bus stop in South East Queensland.',
      'BrisbaneTransit brings your saved ferry, train and bus stops together, with Nearby and service alerts for every mode.',
      'Ask for your next service in plain words, like “next ferry from Bulimba to Riverside”.',
      'Saved stops keep their timetables on your device, so you still see scheduled times offline.',
    ],
  },
]
