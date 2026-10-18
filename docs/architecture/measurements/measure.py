"""Measure SEQ GTFS per mode and estimate shard sizes for one service day."""
import csv, gzip, json, sys, statistics, datetime, collections, os

D = sys.argv[1]
DATE = sys.argv[2] if len(sys.argv) > 2 else "20261020"
MODE = {"4": "ferry", "2": "train", "3": "bus", "0": "tram"}

def rows(name):
    with open(os.path.join(D, name), newline="", encoding="utf-8-sig") as f:
        yield from csv.DictReader(f)

routes = {r["route_id"]: r for r in rows("routes.txt")}
rmode = {rid: MODE.get(r["route_type"], r["route_type"]) for rid, r in routes.items()}
print("routes per mode:", collections.Counter(rmode.values()))
print("distinct route_short_name per mode:",
      {m: len({r["route_short_name"] for rid, r in routes.items() if rmode[rid] == m}) for m in set(rmode.values())})

# active services on DATE
dow = datetime.datetime.strptime(DATE, "%Y%m%d").strftime("%A").lower()
active = set()
for c in rows("calendar.txt"):
    if c["start_date"] <= DATE <= c["end_date"] and c[dow] == "1":
        active.add(c["service_id"])
for c in rows("calendar_dates.txt"):
    if c["date"] == DATE:
        (active.add if c["exception_type"] == "1" else active.discard)(c["service_id"])

trips = {}
tmode = collections.Counter(); tmode_day = collections.Counter()
for t in rows("trips.txt"):
    m = rmode[t["route_id"]]
    tmode[m] += 1
    if t["service_id"] in active:
        trips[t["trip_id"]] = (t["route_id"], t["trip_headsign"], t["direction_id"])
        tmode_day[m] += 1
print("trips per mode (whole feed):", dict(tmode))
print(f"trips per mode active on {DATE} ({dow}):", dict(tmode_day))

stops = {s["stop_id"]: s for s in rows("stops.txt")}
print("stops.txt rows:", len(stops), "location_type counts:",
      collections.Counter(s.get("location_type", "") for s in stops.values()))

st_mode = collections.Counter()
per_stop = collections.defaultdict(list)       # stop -> departures today
trip_seq = collections.defaultdict(list)
stop_modes = collections.defaultdict(set)
all_trip_mode = {}
for t in rows("trips.txt"):
    all_trip_mode[t["trip_id"]] = rmode[t["route_id"]]
for st in rows("stop_times.txt"):
    m = all_trip_mode[st["trip_id"]]
    st_mode[m] += 1
    stop_modes[st["stop_id"]].add(m)
    tr = trips.get(st["trip_id"])
    if tr:
        h, mi, s = st["departure_time"].split(":")
        secs = int(h) * 3600 + int(mi) * 60 + int(s)
        per_stop[st["stop_id"]].append((secs, tr[0], tr[1], st["trip_id"], int(st["stop_sequence"])))
        trip_seq[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], secs))
print("stop_times per mode (whole feed):", dict(st_mode))
print("served stops per mode:", collections.Counter(m for ms in stop_modes.values() for m in ms))
print("departures today per mode:", collections.Counter(rmode[d[1]] for v in per_stop.values() for d in v))

# patterns (unique stop sequences)
pat = collections.Counter()
for tid, seq in trip_seq.items():
    seq.sort()
    pat[(all_trip_mode[tid], tuple(s for _, s, _ in seq))] += 1
print("unique stop patterns today per mode:", collections.Counter(m for m, _ in pat))

def gz(b):
    return len(gzip.compress(b, 9))

# per-stop day shard: [dep_secs_from_midnight, route_short, headsign_idx, pattern_idx, seq]
pidx = {k: i for i, k in enumerate(pat)}
results = collections.defaultdict(list); tot = collections.Counter(); totgz = collections.Counter()
for sid, deps in per_stop.items():
    deps.sort()
    heads = sorted({d[2] for d in deps}); hi = {h: i for i, h in enumerate(heads)}
    body = {"s": sid, "h": heads,
            "d": [[d[0], routes[d[1]]["route_short_name"], hi[d[2]],
                   pidx[(all_trip_mode[d[3]], tuple(s for _, s, _ in trip_seq[d[3]]))], d[4]] for d in deps]}
    b = json.dumps(body, separators=(",", ":")).encode()
    m = sorted(stop_modes[sid])[0]
    results[m].append((len(b), gz(b))); tot[m] += len(b); totgz[m] += results[m][-1][1]
for m, v in results.items():
    g = sorted(x[1] for x in v)
    print(f"{m}: per-stop day shard gz median={statistics.median(g)/1024:.1f}KB "
          f"p95={g[int(len(g)*.95)]/1024:.1f}KB max={g[-1]/1024:.1f}KB  n={len(g)} total raw={tot[m]/1e6:.1f}MB gz={totgz[m]/1e6:.1f}MB")

# stop index for search/nearby
idx = [[s["stop_id"], s["stop_name"], round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5),
        "".join(sorted(x[0] for x in stop_modes.get(s["stop_id"], ())))] for s in stops.values()
       if s["stop_id"] in stop_modes]
b = json.dumps(idx, separators=(",", ":")).encode()
print(f"stop index (served stops={len(idx)}): raw={len(b)/1024:.0f}KB gz={gz(b)/1024:.0f}KB")
for m in ("ferry", "train", "bus"):
    sub = [r for r in idx if m[0] in r[4]]
    bb = json.dumps(sub, separators=(",", ":")).encode()
    print(f"  {m} stop index n={len(sub)} gz={gz(bb)/1024:.1f}KB")

# patterns file per mode
for m in ("ferry", "train", "bus", "tram"):
    ps = [list(k[1]) for k in pat if k[0] == m]
    bb = json.dumps(ps, separators=(",", ":")).encode()
    print(f"patterns {m}: n={len(ps)} gz={gz(bb)/1024:.0f}KB")
