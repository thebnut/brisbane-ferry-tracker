# Wrap icons

Small stylized dog-head SVGs used as visual indicators for specially wrapped CityCats in the departure list, modal, and map.

## Design choice

These are **stylized original icons**, not reproductions of the official Bluey/Bingo character art. The blue/orange dog heads evoke the CityDogs theme via colour + context (they're labelled "Bluey" / "Bingo" alongside), without copying the trademarked character designs owned by Ludo Studio.

If the app ever acquires rights or licensed assets to use the official artwork, swap the SVG files here for the licensed versions — no other code changes needed. The data JSON (`src/data/wrappedVessels.json`) references these by filename via `iconKey`.

## Files

| File | Vessel (current) | Wrap |
| --- | --- | --- |
| `bluey.svg` | Gootcha | Bluey |
| `bingo.svg` | Kuluwin | Bingo |

## Usage

- `src/utils/wrappedVessels.js` imports both via Vite's `?url` suffix (for `<img src>`) and `?raw` suffix (for embedding in Leaflet divIcon HTML).
- Icons render at 16–24px in the departure badge, ~48px in the modal callout, and ~18px overlaid on the map marker.
