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
      'If your browser isn’t keeping changes, Save now tells you so instead of saying it saved.',
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
