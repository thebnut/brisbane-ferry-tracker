# App Store Connect + TestFlight submission packet

Single source of truth for Brisbane Ferry's first App Store submission. Every section maps to a specific field or form in App Store Connect or Xcode. Copy the values, paste them into the UI.

Tracks [BRI-28](https://linear.app/brisbanetransport/issue/BRI-28).

**Important scope notes for v1.0:**

- The app's **one native justification for App Review** is **iOS Geolocation** (nearest-stop + locate-me). Status bar customisation, safe-area handling, native splash screen, and offline schedule cache are supporting points.
- **Local notifications** are NOT yet shipped ([BRI-39](https://linear.app/brisbanetransport/issue/BRI-39)). Do not list them in reviewer notes, App Privacy, or the description. Adding them before 1.0 submission would strengthen the 4.2.2 defence but is not required.
- **Push notifications and Firebase** are NOT installed. Do not mention them.
- **CityHopper** (route F4) is commented out in `src/utils/constants.js:35` — the app currently covers F1 (all-stops CityCat) and F11 (Express CityCat) only. Description and keywords reflect this.

---

## 0. Pre-flight checklist (before you open App Store Connect)

- [ ] Apple Developer Program membership active (`developer.apple.com/account` → Membership → Active). If not, enrol (A$149/year in AU, US$99 elsewhere; expect a 24–48h identity check).
- [ ] Team ID captured (`developer.apple.com/account` → Membership → Team ID, 10 chars). You'll paste it in Xcode.
- [ ] Xcode 16 or later installed, signed in with your Apple ID under Settings → Accounts.
- [ ] `package.json` version is `1.0.0` (bumped in this PR).
- [ ] `ios/App/App.xcodeproj` `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1` (already correct — no change needed).
- [ ] Privacy policy live at `https://www.brisbaneferry.com/privacy` (shipped in BRI-13).
- [ ] Terms live at `https://www.brisbaneferry.com/terms` (shipped in BRI-13).
- [ ] Sub-issue [BRI-41](https://linear.app/brisbanetransport/issue/BRI-41) (screenshots) worked on to capture 6.7" and 6.5" images before clicking Submit.

---

## 1. Apple Developer enrolment (skip if already enrolled)

1. Sign in at `https://developer.apple.com/programs/enroll/` with your Apple ID.
2. Individual enrolment is fine — "Brisbane Ferry" can ship under your personal account. Company enrolment requires a D-U-N-S number and takes longer.
3. Pay A$149/year (renews annually). Allow up to 48h for identity checks.
4. Once active, your **Team ID** is under Account → Membership. Keep it handy.

---

## 2. App Store Connect: create the app record

URL: `https://appstoreconnect.apple.com` → My Apps → **+** → New App.

| Field                      | Value                                                                |
|----------------------------|----------------------------------------------------------------------|
| Platform                   | iOS                                                                  |
| Name                       | `Brisbane Ferry Departures` (25 chars). "Brisbane Ferry" alone is taken in ASC. `CFBundleDisplayName` stays `Brisbane Ferry` — the ASC store name and the home-screen name can differ. |
| Primary Language           | English (Australia)                                                  |
| Bundle ID                  | `com.brisbanetransport.ferry` — pick it from the dropdown; Xcode publishes it on first upload. If not listed, create it at `developer.apple.com/account/resources/identifiers/add/bundleId` first. |
| SKU                        | `brisbane-ferry-ios` (internal, never shown publicly)                |
| User Access                | Full Access                                                          |

Once created, the app shell exists in ASC; you can now fill in the metadata.

---

## 3. App Information (ASC → App Information panel)

| Field                      | Value                                                                |
|----------------------------|----------------------------------------------------------------------|
| **Subtitle** (30-char)     | `Live Brisbane ferry times` (25 chars)                               |
| **Category, Primary**      | Travel                                                               |
| **Category, Secondary**    | Navigation                                                           |
| **Content Rights**         | ❌ "Does your app contain, show, or access third-party content?" → **No** (the GTFS feeds are open data we republish; we are not surfacing third-party copyrighted content in the Apple sense) |
| **Age Rating**             | 4+ (no restricted content — run through the age rating questionnaire, answer **None** to every question) |
| **Privacy Policy URL**     | `https://www.brisbaneferry.com/privacy`                              |

---

## 4. Pricing and Availability

| Field                      | Value                                                                |
|----------------------------|----------------------------------------------------------------------|
| Price                      | Free (Tier 0)                                                        |
| Availability               | All countries. (The app is in English and relevant primarily to Brisbane residents, but there's no reason to gate it — Apple does not require us to list device-location restrictions.) |
| Pre-Orders                 | Off                                                                  |

---

## 5. Version 1.0 — Prepare for Submission

This is the main screen where you paste the listing copy, upload screenshots, and pick a build.

### 5.1 Promotional Text (170-char, updatable without re-submission)

> Live CityCat and Express departures for every Brisbane ferry terminal — with real-time GPS tracking on an interactive map.

### 5.2 Description (4000-char limit)

```
Brisbane Ferry is a community-built, unofficial app for live and scheduled
CityCat and Express ferry departures across every Brisbane ferry terminal.

LIVE DEPARTURES
— Real-time countdown for the next ferries at your chosen terminals
— Automatic updates every few minutes from TransLink's GTFS-Realtime feed
— See which scheduled services are actually running and which aren't

INTERACTIVE LIVE MAP
— Watch ferries move on a clean, minimal map of the Brisbane River
— Tap a ferry to see its speed, occupancy, and status (approaching, at
  terminal, in transit)
— Tap your own locate-me pin to find the nearest terminal

ANY TERMINAL PAIR
— Pick any origin and destination from all 19 Brisbane ferry terminals
— The app only shows you services that actually connect the two — no
  wrong-direction ferries cluttering the board
— Remember your selection across visits, or change it any time from the
  terminal dropdowns

NEAREST STOP
— Tap "Use my location" to have the app find your closest terminal
  using iOS's built-in location services. Your location stays on your
  device — it's never sent to any server.

SMART OFFLINE CACHE
— The daily schedule downloads once (about 50 KB) and caches on-device,
  so the app loads instantly and still shows tomorrow's timetables even
  on a patchy connection

EXPRESS OR ALL-STOPS
— Filter to Express CityCat (F11) only, or show everything. Headers make
  it obvious which service you're looking at.

WHO BUILT THIS
Brisbane Ferry is an unofficial, independent app. It is not operated by
TransLink, Translink Transit Authority, Queensland Transport, the
Brisbane City Council, or any ferry operator. Live data comes from
TransLink's publicly published GTFS and GTFS-Realtime feeds.

PRIVACY AT A GLANCE
— No account, no login, no password
— Location is used only on-device to find the nearest terminal, never
  transmitted
— No ads, no ad trackers, no data brokers
— Full policy: www.brisbaneferry.com/privacy

Questions or feedback? Tap the feedback button inside the app.
```

### 5.3 Keywords (<100 chars, comma-separated, no spaces after commas)

```
citycat,express,timetable,transit,queensland,bulimba,hawthorne,riverside,teneriffe,southbank
```

Character count: 92. Apple auto-indexes every word in the App Name (`Brisbane Ferry Departures`) and Subtitle, so `brisbane`, `ferry`, `departures` are deliberately NOT in the keyword list — burning chars there is wasted.

Other intentional omissions:
- `translink` — registered trademark of Translink Transit Authority (Queensland Gov). The app is unofficial; including it risks a trademark-confusion flag in App Review.
- `ferries` — Apple matches singular/plural variants automatically against `ferry`.
- `gtfs` — niche jargon, very low search volume.
- `schedule` — Apple's stemmer matches this against `timetable` and `schedules`.

### 5.4 Support URL

`https://www.brisbaneferry.com`

### 5.5 Marketing URL (optional)

`https://www.brisbaneferry.com`

### 5.6 Version

`1.0` (auto-populated from the build; don't type it manually)

### 5.7 Copyright

`© 2026 Brett Thebault`

### 5.8 Trade Representative Contact Info (Korea only — required for KR availability)

Leave blank; we're not listing in Korea specifically. If you want to include KR, fill it with Brett's details.

### 5.9 Screenshots

Upload 3–10 per device size. See [BRI-41](https://linear.app/brisbanetransport/issue/BRI-41) for the capture brief. Required sizes:

| Device                         | Resolution              | Required? |
|--------------------------------|-------------------------|-----------|
| iPhone 6.9" (15/16/17 Pro Max) | 1290×2796 or 1320×2868  | Yes       |
| iPhone 6.5" (XS Max → 13 PM)   | 1242×2688 or 1284×2778  | Yes       |
| iPad Pro 13" (M4)              | 2064×2752               | Only if iPad |

**What to capture (in order):**

1. Main departures board with a Bluey- or Bingo-wrapped ferry visible (assets in `src/assets/wraps/`)
2. Interactive live map with ferry markers and a locate-me pin showing
3. Stop selector modal with "Use my location" button highlighted
4. Ferry details modal showing LIVE + GPS badges, speed, and occupancy
5. (Optional, marketing) Before/after of a scheduled vs real-time status

**Capture commands:**

```bash
# Real device (preferred) — press Vol Up + Side button; AirDrop to Mac.

# Simulator — boot the right device size in Xcode first, then:
xcrun simctl io booted screenshot ~/Desktop/brisbane-ferry-01.png
```

---

## 6. App Privacy (ASC → App Privacy panel)

Apple asks, for each data category, whether the app **collects** it, and whether collected data is linked to the user or used for tracking. These answers mirror `public/privacy.html` verbatim — do not drift.

### 6.1 Data Types — paste these answers exactly

Apple's form walks you through every category. The abbreviated answers below are what to pick:

| Data Type                      | Collected? | Linked to user? | Used for tracking? | Purposes                    |
|--------------------------------|------------|-----------------|--------------------|------------------------------|
| **Contact Info → Name**        | Yes        | No              | No                 | App Functionality (feedback) |
| **Contact Info → Email**       | Yes        | No              | No                 | App Functionality (feedback) |
| **User Content → Other User Content** | Yes | No              | No                 | App Functionality (feedback messages) |
| **Identifiers → Device ID**    | Yes        | No              | No                 | Analytics (Google Analytics 4) |
| **Usage Data → Product Interaction** | Yes  | No              | No                 | Analytics                    |
| **Usage Data → Other Usage Data** | Yes     | No              | No                 | Analytics                    |
| **Diagnostics → Crash Data**   | Yes        | No              | No                 | App Functionality (Apple-provided crash reports) |
| **Diagnostics → Performance Data** | Yes    | No              | No                 | Analytics (Vercel Speed Insights) |
| **Diagnostics → Other Diagnostic Data** | Yes | No          | No                 | Analytics                    |
| **Location → Precise Location** | **No**    | —               | —                  | — (location never leaves the device; one-shot nearest-stop only) |
| **Location → Coarse Location** | Yes        | No              | No                 | Analytics (Google Analytics infers city from IP) |
| **Browsing History**           | No         | —               | —                  | —                            |
| **Search History**             | No         | —               | —                  | —                            |
| **Purchases**                  | No         | —               | —                  | —                            |
| **Financial Info**             | No         | —               | —                  | —                            |
| **Health & Fitness**           | No         | —               | —                  | —                            |
| **Sensitive Info**             | No         | —               | —                  | —                            |
| **Contacts**                   | No         | —               | —                  | —                            |
| **Photos / Videos / Audio**    | No         | —               | —                  | —                            |

**Key clarifications for the reviewer:**

- **Precise Location = No.** We request iOS location via `NSLocationWhenInUseUsageDescription`, but only for an in-memory haversine calculation to find the closest terminal. We never read, log, upload, or persist the coordinates. Apple's own guidance: "Data that is used for a one-time, on-device calculation and not transmitted or stored is not considered collected." Our use fits this exception; declare Precise Location as Not Collected.
- **Coarse Location = Yes.** Google Analytics 4 infers city-level location from the user's IP address, which Apple treats as coarse-location data collection. Declare it.
- **Tracking across apps/sites = No** for every category. No ad networks, no SDK that shares an identifier with other apps.

### 6.2 Third-party SDKs to declare (ASC asks you to list them)

| SDK                           | Purpose                                              | Collects |
|-------------------------------|------------------------------------------------------|----------|
| Capacitor Core                | Hybrid runtime                                       | None     |
| @capacitor/geolocation        | Nearest-stop lookup                                  | Location (on-device only, not transmitted) |
| @capacitor/status-bar         | Status bar styling                                   | None     |
| Google Analytics 4 (gtag.js)  | Anonymised pageview + event analytics                | Device ID, Coarse Location, Usage Data, Performance Data |
| Vercel Analytics              | Anonymous page-view counting                         | Usage Data |
| Vercel Speed Insights         | Web Vitals (page-load timings)                       | Diagnostics |

No Firebase. No Sentry. No ad networks. No cross-app identifiers.

---

## 7. Notes for App Review (Reviewer Notes field)

This is the single most important text block for getting past 4.2.2 ("copycat / minimum functionality / web-clipping"). Paste the following into the **Notes** field under App Review Information.

```
Hi! Thanks for reviewing Brisbane Ferry.

The app is a hybrid iOS build (Capacitor) of our web app
(brisbaneferry.com). It is not a web-clip and not a thin wrapper. The
iOS build ships native functionality that is either impossible or
meaningfully worse in a plain web browser. Here's what I'd like to
highlight:

1. iOS Core Location — "Nearest stop"
   On the stop-selector modal, tap "Use my location". The app requests
   When-In-Use location via NSLocationWhenInUseUsageDescription
   ("Brisbane Ferry uses your location to find the ferry terminal
   closest to you.") and returns the nearest of the 19 Brisbane ferry
   terminals. The calculation runs on-device; coordinates are never
   transmitted or persisted. This is a genuine native feature — the
   web app cannot provide the same one-tap experience because browser
   permission UX is slower and less trusted by users.

2. Same feature on the map
   On the live ferry map, tap the locate-me button to drop your current
   location as a pin and highlight the nearest terminal from the
   current map view.

3. Native status-bar styling + safe-area handling
   We use @capacitor/status-bar to render a dark status-bar style
   against a cream background matching our brand, and we respect the
   Dynamic Island + notch safe areas throughout the UI. The web build
   cannot guarantee either.

4. Native launch storyboard
   LaunchScreen.storyboard renders our branded splash natively, not via
   HTML — so the app has an instant branded launch even before the web
   view is initialised.

5. On-device schedule cache
   The daily ferry schedule (~50 KB) is cached in localStorage on first
   run and re-used for subsequent launches. The app remains usable when
   the device goes offline mid-trip, as long as the schedule was fetched
   at least once. This is functionality that a plain browser can't
   guarantee across sessions.

DATA
All live and scheduled ferry data comes from TransLink's publicly
published GTFS / GTFS-Realtime feeds (openly licensed open-government
data). The app is independent and unaffiliated with TransLink,
Translink Transit Authority, Queensland Transport, the Brisbane City
Council, or any ferry operator — this is stated in the description and
in the privacy policy.

DEMO / TEST ACCOUNT
No account or login required. To exercise the native behaviour:
  1. Launch the app.
  2. On first launch, pick two Brisbane ferry terminals (e.g. Bulimba
     and Riverside) in the stop-selector modal.
     — or tap "Use my location" to have the app pick the nearest
       terminal automatically. Please accept the location prompt.
  3. Watch live ferries populate on the departures board.
  4. Tap "Map" in the header to see the live GPS map. Tap any ferry
     marker for its modal. Tap the locate-me button to drop your pin.
  5. Tap any departure row for the ferry details modal.

There is nothing gated or behind any feature flag.

CONTACT
Feedback button in-app; support URL https://www.brisbaneferry.com;
privacy https://www.brisbaneferry.com/privacy.

Thanks for reviewing!
```

---

## 8. Xcode: pre-flight for the build

### 8.1 Open the workspace

```bash
cd ios/App
open App.xcworkspace    # NB: workspace, not project — Capacitor uses CocoaPods/SPM.
```

**First-time setup on a fresh checkout:** the Apple Developer Team ID is read from `ios/Team.xcconfig`, which is gitignored. Copy the committed template and fill in your 10-char Team ID (from `developer.apple.com/account → Membership`):

```bash
cp ios/Team.xcconfig.sample ios/Team.xcconfig
# Edit ios/Team.xcconfig and replace YOUR_10_CHAR_TEAM_ID_HERE
```

The `#include?` directives in `ios/debug.xcconfig` and `ios/release.xcconfig` use the optional form — a missing `Team.xcconfig` doesn't break the build, just the signing step (Xcode will show "No signing certificate" in Signing & Capabilities until you create it).

### 8.2 Signing & Capabilities tab

For the **App** target:

| Setting                    | Value                                                   |
|----------------------------|---------------------------------------------------------|
| Automatically manage signing | ☑ ticked                                              |
| Team                       | Your Apple Developer team (name + Team ID in dropdown)  |
| Bundle Identifier          | `com.brisbanetransport.ferry` (should auto-fill)        |
| Provisioning Profile       | Xcode Managed Profile (leave as-is, Xcode creates it)   |

Capabilities expected: none beyond defaults. Geolocation does NOT require a capability — only an Info.plist usage string, which is already set.

### 8.3 Verify Info.plist values

Info.plist should already contain:

- `CFBundleDisplayName` = `Brisbane Ferry`
- `CFBundleIdentifier` = `$(PRODUCT_BUNDLE_IDENTIFIER)` (which resolves via `PRODUCT_BUNDLE_IDENTIFIER = com.brisbanetransport.ferry` in `project.pbxproj`)
- `CFBundleShortVersionString` = `$(MARKETING_VERSION)` → `1.0`
- `CFBundleVersion` = `$(CURRENT_PROJECT_VERSION)` → current build number (1, 2, 3, …)
- `NSLocationWhenInUseUsageDescription` = `Brisbane Ferry uses your location to find the ferry terminal closest to you.`
- `NSLocationAlwaysAndWhenInUseUsageDescription` = `Brisbane Ferry uses your location only while the app is open, to find the ferry terminal closest to you. It does not track your location in the background.` — **required** even though we don't use Always authorisation; `@capacitor/geolocation` links against the Always API symbol, so Apple's static analyser demands a matching purpose string. Without this key, ASC emits warning 90683 on upload.
- `ITSAppUsesNonExemptEncryption` = `false` — declares we only use iOS's built-in HTTPS (exempt from encryption export compliance), so ASC stops prompting the App Encryption Documentation question on every upload.

If any of those are off, fix before archiving.

### 8.4 Version/build convention (for future builds)

- **Marketing version** bumps on every public release (1.0 → 1.1 → 1.1.1 → 2.0). Edit in Xcode target → General → **Version**.
- **Build number** must be unique per upload to App Store Connect (1 → 2 → 3 → …). Edit in Xcode target → General → **Build**. Do NOT reset it between submissions, even if they fail review.
- Keep `package.json:version` aligned with the marketing version for dev convenience.

### 8.5 Archive

1. In Xcode, select the scheme **App** and the destination **Any iOS Device (arm64)**. (Archive menu is disabled when a Simulator is selected.)
2. Product → Archive. Expect 2–5 minutes.
3. When the Organizer opens: select the new archive → **Distribute App** → **App Store Connect** → **Upload** → Automatically manage signing → Upload.
4. ASC receives the build. It shows up in "TestFlight → iOS Builds" after 5–15 min of processing (look for an email once processing completes, or a green tick in the row).

---

## 9. TestFlight

### 9.1 Internal testing

1. ASC → your app → **TestFlight** → **Internal Testing**.
2. Create a group called "Team" (or reuse Default).
3. Add yourself and any team members (must already be invited as users of your ASC account).
4. Assign the 1.0 build to the group. Internal testers get an email within minutes; no Beta App Review needed.

### 9.2 External testing

1. ASC → TestFlight → **External Testing** → **+** → Create group.
2. Add testers by email (up to 10,000) or via a public TestFlight link.
3. Assign the 1.0 build.
4. Apple runs **Beta App Review** on the first build submitted to external testing — 1–2 business days typically. Subsequent builds pass through without review unless major metadata changes.
5. Write concise "What to Test" notes in the TestFlight build metadata, e.g.:

   > First TestFlight build. Please sanity-check:
   > — Live departures board updates
   > — Map shows ferries moving
   > — "Use my location" on the stop selector finds the right terminal
   > — Anything visually off on your specific iPhone model

---

## 10. Submit for App Review (after TestFlight confirms it works)

1. ASC → App Store tab → Version 1.0 → ensure all sections are green (no red triangles).
2. "App Review Information" — copy Section 7 of this doc into Notes; set Sign-in required = No; contact info = your phone + email.
3. "Version Release" — **Automatically release this version** (or Manual if you want to schedule a marketing push).
4. Click **Add for Review**, then **Submit for Review** on the confirmation.
5. Review takes 1–3 days typically. Watch for email updates.

**If rejected (common reasons):**

- **4.2.2** — reviewer thinks it's a web clip. Your reviewer notes (Section 7) are the answer; reply in Resolution Center and point to the specific native features listed there. Do not argue — reference the features and ask them to test again.
- **5.1.1** — location purpose string unclear. The current Info.plist string is fine but if asked, reply explaining it's only for nearest-stop.
- **2.1 Performance** — crashes. Fix, bump build number, re-upload.

---

## 11. Icon, launch screen, splash (current state)

- **AppIcon** — `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, 1024×1024 PNG. Now shows the Brisbane Ferry brand mark (teal + orange ferry inside a circle, waves below) on a cream `#FFE5D9` background with ~12% padding for breathing room. Generated by cropping the ferry symbol out of `public/bf.com_logo.png` (the 157×157 region on the left) and upscaling with ImageMagick's Lanczos filter, then flattening alpha onto cream. No URL or wordmark in the icon — important for passing 4.2.2 App Review. Upscale from 157→1024 is 6.5x so slightly soft at zoom; a proper vector master is [BRI-40](https://linear.app/brisbanetransport/issue/BRI-40).
- **LaunchScreen** — `ios/App/App/Base.lproj/LaunchScreen.storyboard` → `Splash` image (1366×1366) on `systemBackgroundColor` (white). Simple and compliant.
- **Splash asset** — `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png` (+1 and +2 variants). Compliant with Apple's iPad Pro requirement.

The modern iOS app icon only requires the single 1024×1024 size in the asset catalogue — Xcode derives the rest. No need to pre-render 60+ sizes as the original issue suggested.

**Regenerating the icon** (if the source art changes):

```bash
# 1. Crop the ferry symbol out of bf.com_logo.png (wordmark logo)
magick public/bf.com_logo.png -trim +repage /tmp/logo-trimmed.png
magick /tmp/logo-trimmed.png -crop 170x157+0+0 +repage \
  -background none -gravity center -extent 170x170 \
  /tmp/ferry-only.png

# 2. Scale to 1024, cream background, 80% padded
magick /tmp/ferry-only.png \
  -background none -filter Lanczos -resize 800x800 \
  -gravity center -background "#FFE5D9" -extent 1024x1024 \
  -alpha remove -alpha off \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
```

---

## 12. What's NOT in this PR (follow-up work)

| Item                                          | Tracked by                                                                             |
|-----------------------------------------------|----------------------------------------------------------------------------------------|
| Apple Developer enrolment (Brett's Apple ID)  | Manual                                                                                 |
| ASC app record creation                       | Manual, Section 2                                                                      |
| Xcode signing with Brett's team               | Manual, Section 8.2                                                                    |
| Archive + upload                              | Manual, Section 8.5                                                                    |
| Screenshots capture                           | [BRI-41](https://linear.app/brisbanetransport/issue/BRI-41)                            |
| Crisp 1024×1024 icon master                   | [BRI-40](https://linear.app/brisbanetransport/issue/BRI-40) — not blocking             |
| Local notifications feature                   | [BRI-39](https://linear.app/brisbanetransport/issue/BRI-39) — not blocking             |
