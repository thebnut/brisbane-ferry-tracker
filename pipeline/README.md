# @bft/pipeline

Static timetable pipeline (`docs/architecture/transit-architecture.md` §3.2, ADR-0002). It turns the TransLink SEQ
GTFS zip into content-addressed stop-day files for service days D−1..D+6 and publishes them to R2
(bucket `bft-transit-data`). The daily run is `.github/workflows/transit-static.yml`. The legacy ferry job
(`update-schedule.yml`) and GitHub Pages are untouched.

## Commands

Run these from `pipeline/`. Node 22.18+ runs the TypeScript directly with `--experimental-transform-types`.

```sh
pnpm build:data --gtfs /tmp/bft-gtfs/x --out out              # whole network, ~70 s, <1 GB RSS
pnpm build:data --date 20261020 --now 2026-10-19T17:15:00Z    # pinned date/instant (tests, reproductions)
pnpm publish:data --from out --target dir --to /tmp/store     # or --target r2 | uploader | assets
pnpm measure --gtfs /tmp/bft-gtfs/x --date 20261020           # Phase 0 numbers (§5)
pnpm golden --gtfs /tmp/bft-gtfs/x                            # regenerate packages/core/fixtures/golden
```

`--gtfs` takes a URL (the default is the TransLink feed), a zip or an extracted directory.

`build` exit codes:
- 0: built.
- 2: structural failure. Nothing was written to the manifest.
- 3: quarantined. The quarantined modes keep their previous generation in `manifest.json`. The new generation is in
  `manifest.staging.json`, with its client data under `staging/`.

To promote a quarantined build, use `--accept <generation>`, or the workflow input `accept`.

## Publishing to R2

- **CI:** the workflow derives S3 credentials from the `CLOUDFLARE_API_TOKEN` secret. The key id is the token id and
  the secret is the token's SHA-256. The token needs R2 write permission.
- **This Mac:** wrangler is logged in, so use the local uploader. It is a `wrangler dev` Worker on 127.0.0.1 with a
  *remote* R2 binding, and it is never deployed:

  ```sh
  scripts/with-r2-uploader.sh sh -c 'pnpm build:data --gtfs /tmp/bft-gtfs/SEQ_GTFS.zip --out out --previous uploader &&
                                      pnpm publish:data --from out --target uploader'
  ```

- The publisher never HEADs objects one at a time. It skips every content file that the bucket's own
  `manifest.json` / `manifest.staging.json` already reference, PUTs the rest, then uploads the generation indexes,
  then client data, and `manifest.json` last.
- A next-day run on an unchanged feed is about 13k Class A operations. A full feed change is about 100k.

## Layout

| Key | What |
|---|---|
| `manifest.json` | `Manifest` (written last); `manifest.staging.json` only while something is quarantined |
| `static/{generation}/{mode}/index.json` | `GenerationIndex`: blobs, tripIndex, stats, and for bus `shards` |
| `static/blobs/{sha256}.json.gz` | `StaticStopDay` or `TripIndexDay`, gzip; the hash is over the gz bytes |
| `static/shards/{sha256}.json.gz` | bus `StaticShard` (`{stopKey: StaticStopDay}`), bucket = `shardOf(stopKey, count)` |
| `data/{mode}/stops.json`, `lines.json`, `geo/{geohash5}.json` | client data (`StopIndexFile`, `LinesFile`, `GeoTileFile`) |
| `legacy/latest.json` | byte-identical to `schedule-processor/process-schedule.js` output |

**Generations.** A generation is `{feed_start}-{feed_end}-{feed content sha8}-{build sha12}`. The build hash covers the
blob hashes, so the same feed and date always produce the same generation and the same bytes.

**Gzip.** Blobs are gzipped with fflate at level 9 and mtime 0. Node's zlib writes a platform-specific OS byte, so it
can't give identical hashes on every machine.

## Validators

Structural failures fail closed:
- missing or unparseable files and columns
- referential breaks
- malformed times
- `feed_end_date` earlier than today + 7
- SEQ golden landmarks missing
- MobilityData gtfs-validator ERROR notices (in CI)

Plausible changes are quarantined:
- per-mode trip count per date moves more than ±20% against the previous generation
- a station the previous generation served on a date has no service now, and `calendar_dates` doesn't explain it

## Not done yet

- **Weekly GC of unreferenced blobs.** Storage grows about 75 MB a day on an unchanged feed. GC deletes objects, so
  it needs Brett's go-ahead.
- **Bus index size.** The bus `GenerationIndex` is 7.4 MB raw (§5). Splitting it per date, or reading bus by shard,
  is a contract decision for the edge.
