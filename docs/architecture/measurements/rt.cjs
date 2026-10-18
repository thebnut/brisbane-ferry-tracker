const b = require('gtfs-realtime-bindings');
const fs = require('fs');
for (const f of process.argv.slice(2)) {
  const t0 = performance.now();
  const m = b.transit_realtime.FeedMessage.decode(fs.readFileSync(f));
  const ms = (performance.now()-t0).toFixed(1);
  let stu = 0; for (const e of m.entity) if (e.tripUpdate) stu += e.tripUpdate.stopTimeUpdate.length;
  console.log(f, 'entities', m.entity.length, 'stopTimeUpdates', stu, 'decode ms', ms, 'ts', new Date(Number(m.header.timestamp)*1000).toISOString());
}
