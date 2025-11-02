const fs = require('fs');
const data = JSON.parse(fs.readFileSync('output/train-stations-v5/train-station-MORNINGSIDE.json', 'utf-8'));

// Analyze one route to Central
const centralTrips = data.routes.CENTRAL.schedules['2025-11-02'] || [];

console.log('Trips to Central today:', centralTrips.length);
console.log('');

// Check how many unique intermediate stop patterns
const patterns = new Map();
centralTrips.forEach(trip => {
  const pattern = trip.intermediateStops.map(s => s.station).join('->');
  if (!patterns.has(pattern)) {
    patterns.set(pattern, []);
  }
  patterns.get(pattern).push(trip.tripId);
});

console.log('Unique stop patterns:', patterns.size);
patterns.forEach((trips, pattern) => {
  console.log(`\nPattern: ${pattern || '(direct)'}`);
  console.log(`  Used by ${trips.length} trips`);
});

// Calculate size with and without intermediate stops
const withStops = JSON.stringify(centralTrips).length;
const withoutStops = JSON.stringify(centralTrips.map(t => ({...t, intermediateStops: undefined}))).length;

console.log(`\nSize with intermediate stops: ${(withStops/1024).toFixed(2)} KB`);
console.log(`Size without intermediate stops: ${(withoutStops/1024).toFixed(2)} KB`);
console.log(`Savings: ${((1 - withoutStops/withStops) * 100).toFixed(1)}%`);

// Now analyze the whole file
console.log('\n=== WHOLE FILE ANALYSIS ===');
const fullSize = JSON.stringify(data).length;

const withoutIntermediateStops = {
  ...data,
  routes: {}
};

Object.entries(data.routes).forEach(([dest, destData]) => {
  withoutIntermediateStops.routes[dest] = {
    ...destData,
    schedules: {}
  };

  Object.entries(destData.schedules).forEach(([date, trips]) => {
    withoutIntermediateStops.routes[dest].schedules[date] = trips.map(t => ({
      ...t,
      intermediateStops: undefined
    }));
  });
});

const slimSize = JSON.stringify(withoutIntermediateStops).length;

console.log(`Full file with intermediate stops: ${(fullSize/1024/1024).toFixed(2)} MB`);
console.log(`Slim file without intermediate stops: ${(slimSize/1024/1024).toFixed(2)} MB`);
console.log(`Savings: ${((1 - slimSize/fullSize) * 100).toFixed(1)}%`);
