# Measurement scripts

These scripts produced the numbers in `../transit-architecture.md` §5. They are reproducible and run against `/tmp`.

```sh
mkdir -p /tmp/bft-gtfs && curl -sSL -o /tmp/bft-gtfs/SEQ_GTFS.zip https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip
unzip -o -q /tmp/bft-gtfs/SEQ_GTFS.zip -d /tmp/bft-gtfs/x
python3 -I measure.py  /tmp/bft-gtfs/x 20261020   # per-mode counts, per-stop shards (no downstream), stop index
python3 -I measure2.py /tmp/bft-gtfs/x 20261020   # per-stop (per-station for train) shards with downstream times
curl -s --compressed -o /tmp/tu.pb https://gtfsrt.api.translink.com.au/api/realtime/SEQ/TripUpdates
node rt.cjs /tmp/tu.pb                            # needs gtfs-realtime-bindings installed
```

Use a service date inside the feed's `feed_info` range.
