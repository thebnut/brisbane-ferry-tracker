# Ferry look spec (round 2): copy BrisbaneFerry's look, feel and logo style

Brett's feedback on round 1: "I like the modern design elements, but you need to copy the look and feel and logo style of brisbaneferry.com." This round **replaces round 1's per-mode brand colours (violet/gold) and per-direction fonts**. Every product now wears the ferry app's own skin, taken from its source (`tailwind.config.js`, `src/index.css`, `Navigation.jsx`, `DepartureItem.jsx`, `public/bf.com_logo.png`). The modern elements from round 1 stay, restyled.

Still applies from round 1 (`family-spec.md`): status vocabulary, countdown rules, sample data, one-handed layout, accessibility, no emoji, no fake status bars, stylised SVG maps.

## Logo (uploaded assets: use these urls verbatim in `<img src>`)

- Ferry real lockup (emblem + "BrisbaneFerry / Departure Boards"): `/_blob/18cf5597f2ae16936eb06cd2fc413912` (489×199)
- Ferry emblem only: `/_blob/0126358b928cb9b28297b556d7a37a9d` (163×157)
- Train emblem: `/_blob/c529a31f2397418a458da66f4007f78e` (square SVG)
- Bus emblem: `/_blob/f469fc98762384bbed3dbe954bca5d44` (square SVG)
- Transit emblem (map pin): `/_blob/6cb3ef13ed0162256b2e66a39e2db32e` (square SVG)

**Lockup** (exactly the ferry logo's structure): emblem on the left, then two lines of wordmark:
- line 1 "Brisbane" + mode word, one word, no space: `BrisbaneTrain`, Poppins 700, logo teal `#2A9A9E` (header size about 26px; use `#1E7C80` only if it must pass AA as small text).
- line 2 "Departure Boards", Poppins 600, logo orange `#FE8E22`, slightly smaller (about 21px).
Load fonts in `<helmet>`: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700&display=swap`.
Header lockup height: 56–64px on phone (emblem 56px), 96–112px on desktop. Ferry uses its real lockup image; the others build the lockup from emblem image + HTML text.

## Colour (from the ferry app)

- Logo teal `#2A9A9E`, logo orange `#FE8E22`.
- App: ferry-orange `#FF6B35` (primary accent, LIVE pill, highlights), ferry-orange-dark `#E55A2B`, ferry-sunset `#FF8C42`, ferry-orange-light `#FFE5D9`, ferry-aqua `#00A8CC`, ferry-aqua-light `#5DCCDB`, ferry-light-blue `#E6F2FF`, ferry-blue `#0066CC`, charcoal `#2D3436` (body text), cream `#FDF5E6`, golden `#F5B800`.
- **AA adjustments** (keep the look, fix contrast): teal text on white uses `#1E7C80`; aqua headings use `#007C99` instead of `#00A8CC` for text; white text on orange only at 18.66px+ bold (large text) on `#E55A2B`, or use charcoal text on `#FF8C42`/`#FFE5D9`.
- **All three standalone apps use the identical palette.** The mode is told by the emblem, the wordmark word and a mode pictogram, not by a new brand colour. Train line colours remain as data (line pills/strips); bus route tiles are teal.
- In multimodal views, modes are told apart by pictogram + label + pin shape (ferry circle, train square, bus diamond), all in teal/orange family colours, with lightness differences (ferry `#00A8CC` light aqua, train `#1E7C80` deep teal, bus `#E55A2B` orange) when colour coding is needed.

## Surfaces and components (match the ferry app)

- **Page ground**: diagonal gradient `linear-gradient(135deg, #FFE5D9 0%, #FFFFFF 50%, #E6F2FF 100%)` (the app's body).
- **Header bar**: `linear-gradient(90deg, #FFFFFF, #FFE5D9, #E6F2FF)`, `border-bottom: 2px solid rgba(255,107,53,.5)`, big shadow `0 20px 25px -5px rgba(0,0,0,.1)`. Lockup left; right side: "Settings" pill (white 90%, `#007C99` semibold text, gear icon, `1px solid rgba(255,107,53,.2)`, full radius, shadow) and the **LIVE pill** (orange `#FF6B35` fill, white bold 12px text, full radius, glow `0 0 15px rgba(255,107,53,.5)`).
- **Status strip** under header: `linear-gradient(90deg,#FFFFFF, rgba(255,229,217,.5))`, thin `rgba(255,107,53,.2)` bottom border; "Last updated 2:41 pm" charcoal 14px with orange clock icon; service filter pills (All / Express) and Map / Refresh pills in the same pill style.
- **Board header strip**: rounded 12px, `linear-gradient(90deg, rgba(255,255,255,.8), rgba(255,229,217,.5))`, `1px solid rgba(255,107,53,.1)`, semibold 16px `#007C99` text, e.g. "Roma Street → Indooroopilly".
- **ferry-card** (each departure): white 90% (`rgba(255,255,255,.9)`), radius 12px, padding 20px, `box-shadow: 0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)`, min-height 96px, 12px gap between cards.
- **Next/express highlighted card**: `2px solid #FF6B35` border, `linear-gradient(90deg, #FFE5D9, #FFFFFF)` fill, glow `0 0 20px rgba(255,107,53,.45)`.
- **Countdown chip** (full radius, bold): <1 min "Departing" `linear-gradient(90deg,#EF4444,#FF6B35)` white; ≤5 min `#E55A2B` white; ≤15 min `#FF8C42` with charcoal text; later: `#DCFCE7` fill, `#166534` text, `#86EFAC` border. Make chips 16–18px bold so white text stays legible.
- **Badges**: LIVE `#FF6B35` white bold 12px pill (pulse); SCHEDULED `#F3F4F6` fill, `#4B5563` text; GPS: aqua pill with location icon (`#007C99` fill, white). Express: orange text "EXPRESS" + small boat/train/bus glyph.
- **Buttons**: primary = `#FF6B35` fill (white text bold ≥16px) radius 8px shadow; secondary = white with 2px `#FF6B35` border and `#E55A2B` text; "More departures" = full-width `linear-gradient(90deg,#FFFFFF,#FFE5D9)` with 2px `rgba(255,107,53,.3)` border, orange bold text.
- **Type**: Inter for all UI (the app's font), weights 400–800; Poppins only in the wordmark. Times use `font-variant-numeric: tabular-nums`, bold 20–24px (express a size bigger, as in the app).
- **Bottom navigation** (new, one-handed): white 95% with blur, top border `rgba(255,107,53,.2)`, active item orange `#E55A2B` with `#FFE5D9` pill behind the icon.
- **Maps**: stylised, matching the app's minimal light map: pale `#F4F7F8` ground, river `#CDE9F0`, streets white, lines grey; vehicles are **pulsing dots** with white border and drop shadow (express red-orange `#E55A2B`, all-stops teal `#00A8CC`), exactly as the ferry map.
- **Dark mode** (new; the app has none): ground `#14191B` → `#1B2326` gradient, cards `#222B2E`, text `#F1F5F6`, teal `#5DCCDB`, orange `#FF8C42`; LIVE pill keeps orange.

## The modern elements to keep (restyled in the ferry skin)

- **Train**: platform as a large square tile (56px, white card with teal `#1E7C80` numeral; platform change = orange `#FF6B35` tile "NOW 7" with old number struck through); stopping-pattern strip on every departure (dots on a line in the line's colour, hollow dots for skipped stations on express); picker shows only reachable stations grouped by line; vertical line in service detail with the train as a moving capsule; line-status board for alerts.
- **Bus**: route number as the hero in a "blind" tile (teal `#1E7C80` tile, white bold numerals; CityGlider/BUZ variants as orange tiles), huge right-aligned tabular countdown, search-first home with the "Stop name or number" field in a bottom sheet at thumb height, results stacking upward, "My stops" cards with next 3 routes, per-stop and per-route maps, busway platform letters.
- **Transit**: Mode Tabs shell (bottom tabs Ferry | Train | Bus | Nearby | Saved); each mode tab shows that standalone app's own lockup in the header, so the brands survive inside the combined app; Saved mixes all modes; Nearby tab = "around you" stops grouped by mode with pin shapes; merged alerts filtered by mode chips.

## Canvas

Canvas: https://claude.ai/artifact/1ra2iuys2FPAwGNeQfYrw8. Root folder: `/private/tmp/claude-501/-Users-brett-Dev-local-BrisFerry-bft-transit-design/8fe91b73-a1fe-4658-bce1-612b9ecb4061/scratchpad/family` (files at `project/…`). The index `project/canvas.json` is already written and published by the lead with every board; **never send the index**. Files per product: `<P>-Home`, `-Search`, `-Departures`, `-Detail`, `-Map`, `-Alerts` (390×844 fixed), `<P>-States` (1700×844, four 390-wide panels), `<P>-DarkWidget` (1200×844), `<P>-Desktop` (fluid PAGE, `expand: fill`, w 1280, about 900 tall), each `.dc.html`. P = T (train), B (bus), X (transit).
