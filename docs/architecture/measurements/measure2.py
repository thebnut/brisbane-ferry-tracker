"""Per-stop (per-station for train) day shards with downstream ARRIVAL times (seconds), stop_sequence,
pickup/drop-off rules and a trip-instance index. Revised after the Codex review (finding 1)."""
import csv, gzip, json, sys, statistics, datetime, collections, os
D, DATE = sys.argv[1], sys.argv[2]
MODE = {"4": "ferry", "2": "train", "3": "bus", "0": "tram"}
rows = lambda n: csv.DictReader(open(os.path.join(D, n), newline="", encoding="utf-8-sig"))
routes = {r["route_id"]: r for r in rows("routes.txt")}
dow = datetime.datetime.strptime(DATE, "%Y%m%d").strftime("%A").lower()
active = {c["service_id"] for c in rows("calendar.txt") if c["start_date"] <= DATE <= c["end_date"] and c[dow] == "1"}
for c in rows("calendar_dates.txt"):
    if c["date"] == DATE: (active.add if c["exception_type"] == "1" else active.discard)(c["service_id"])
trips = {t["trip_id"]: t for t in rows("trips.txt") if t["service_id"] in active}
stops = {s["stop_id"]: s for s in rows("stops.txt")}
key = lambda sid, m: (stops[sid].get("parent_station") or sid) if m == "train" else sid
seq = collections.defaultdict(list)
for st in rows("stop_times.txt"):
    if st["trip_id"] in trips:
        t = lambda v: (lambda h, m, x: int(h)*3600+int(m)*60+int(x))(*(v or st["departure_time"]).split(":"))
        seq[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], t(st["departure_time"]), t(st["arrival_time"]),
                                   st.get("pickup_type") or "0", st.get("drop_off_type") or "0"))
shards = collections.defaultdict(list); smode = {}
for tid, s in seq.items():
    s.sort(); r = routes[trips[tid]["route_id"]]; m = MODE[r["route_type"]]
    ids = [x[1] for x in s]
    for i, (q, sid, dep, arr, pu, do) in enumerate(s[:-1]):
        if pu == "1":
            continue  # no boarding here
        k = key(sid, m); smode[k] = m
        # downstream: (stop key, seconds from this departure to ARRIVAL there), only where alighting is allowed
        down = [[key(x[1], m), x[3]-dep] for x in s[i+1:] if x[5] != "1"]
        shards[k].append([dep, r["route_short_name"], trips[tid]["trip_headsign"], sid, down, q, tid])
by = collections.defaultdict(list); tot = collections.Counter()
for k, v in shards.items():
    v.sort(key=lambda x: x[0])
    # dictionary-encode stop keys per shard
    keys = sorted({d[0] for row in v for d in row[4]}); ki = {x: i for i, x in enumerate(keys)}
    heads = sorted({row[2] for row in v}); hi = {x: i for i, x in enumerate(heads)}
    body = {"k": keys, "h": heads, "d": [[r[0], r[1], hi[r[2]], r[3], r[5], r[6], [x for d in r[4] for x in (ki[d[0]], d[1])]] for r in v]}
    g = len(gzip.compress(json.dumps(body, separators=(",", ":")).encode(), 9))
    by[smode[k]].append(g); tot[smode[k]] += g
for m, g in by.items():
    g.sort()
    print(f"{m}: shards={len(g)} gz median={statistics.median(g)/1024:.1f}KB p95={g[int(len(g)*.95)]/1024:.1f}KB max={g[-1]/1024:.1f}KB total={tot[m]/1e6:.2f}MB")
