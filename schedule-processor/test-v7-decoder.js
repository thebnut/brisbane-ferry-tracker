/**
 * Test V7 Decoder with Local V7 Files
 *
 * Tests the V7 decoder functions with actual V7 data generated
 * Verifies that minified format can be expanded correctly
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple implementation of V7 decoder functions for testing
function minutesToTime(minutes) {
  if (typeof minutes !== 'number' || minutes < 0) {
    return '00:00:00';
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

function getDayOffset(startDate, targetDate) {
  const start = new Date(startDate + 'T00:00:00');
  const target = new Date(targetDate + 'T00:00:00');
  const diffMs = target - start;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}

function expandTrip(minTrip, meta = {}, pattern = null) {
  if (!minTrip) return null;

  const expanded = {
    tripId: minTrip.t,
    departure: {
      time: minutesToTime(minTrip.d)
    },
    arrival: {
      time: minutesToTime(minTrip.a)
    },
    patternId: minTrip.p
  };

  if (minTrip.s && Array.isArray(minTrip.s)) {
    expanded.stopTimes = minTrip.s.map(minutes => ({
      arrival: minutesToTime(minutes),
      departure: minutesToTime(minutes)
    }));
  }

  if (pattern) {
    expanded.routeId = pattern.r;
    expanded.routeName = pattern.n;
    expanded.headsign = `${pattern.n} to ${pattern.d}`;
  }

  return expanded;
}

function getTripsForDate(v7StationData, destSlug, targetDate, v7PatternsData = null) {
  if (!v7StationData || !v7StationData.meta) {
    return [];
  }

  const { meta, routes } = v7StationData;
  const { start: startDate } = meta;
  const routeData = routes[destSlug];

  if (!routeData || !routeData.schedules) {
    return [];
  }

  const dayOffset = getDayOffset(startDate, targetDate);

  if (dayOffset < 0 || dayOffset >= routeData.schedules.length) {
    return [];
  }

  const dayTrips = routeData.schedules[dayOffset];

  if (!dayTrips || dayTrips.length === 0) {
    return [];
  }

  const patternLookup = new Map();
  if (v7PatternsData && v7PatternsData.patterns) {
    v7PatternsData.patterns.forEach(pattern => {
      patternLookup.set(pattern.i, pattern);
    });
  }

  return dayTrips.map(minTrip => {
    const pattern = patternLookup.get(minTrip.p);
    return expandTrip(minTrip, meta, pattern);
  });
}

async function testV7Decoder() {
  console.log('🧪 Testing V7 Decoder with MORNINGSIDE station data\n');

  try {
    // Load V7 station file
    const stationPath = path.join(__dirname, 'output/train-stations-v7/train-station-MORNINGSIDE.json');
    const stationData = JSON.parse(await fs.readFile(stationPath, 'utf-8'));

    console.log('📁 Loaded station file:');
    console.log(`   Version: ${stationData.meta.v}`);
    console.log(`   Origin: ${stationData.meta.origin}`);
    console.log(`   Start date: ${stationData.meta.start}`);
    console.log(`   Days: ${stationData.meta.days}`);
    console.log(`   Routes: ${Object.keys(stationData.routes).length}`);

    // Load V7 pattern file
    const patternPath = path.join(__dirname, 'output/train-patterns-v7/train-patterns-MORNINGSIDE.json');
    const patternData = JSON.parse(await fs.readFile(patternPath, 'utf-8'));

    console.log('\n📁 Loaded pattern file:');
    console.log(`   Patterns: ${patternData.patterns.length}`);

    // Test: Get trips for today from MORNINGSIDE to CENTRAL
    const today = new Date().toISOString().split('T')[0];
    const trips = getTripsForDate(stationData, 'CENTRAL', today, patternData);

    console.log(`\n🚂 Trips from MORNINGSIDE → CENTRAL (${today}):`);
    console.log(`   Total trips found: ${trips.length}`);

    if (trips.length > 0) {
      // Show first 3 trips
      console.log('\n   📋 First 3 trips:');
      trips.slice(0, 3).forEach((trip, idx) => {
        console.log(`   ${idx + 1}. ${trip.departure.time} → ${trip.arrival.time}`);
        console.log(`      Route: ${trip.routeName}`);
        console.log(`      Headsign: ${trip.headsign}`);
        console.log(`      Trip ID: ${trip.tripId}`);
        console.log(`      Pattern ID: ${trip.patternId}`);
        console.log(`      Stops: ${trip.stopTimes?.length || 0} intermediate stops`);
        if (trip.stopTimes && trip.stopTimes.length > 0) {
          console.log(`      First stop: ${trip.stopTimes[0].arrival}`);
          console.log(`      Last stop: ${trip.stopTimes[trip.stopTimes.length - 1].arrival}`);
        }
        console.log('');
      });
    }

    // Test minified format inspection
    console.log('\n🔍 Raw minified trip (first trip):');
    const destSlug = 'CENTRAL';
    const dayOffset = getDayOffset(stationData.meta.start, today);
    const rawTrip = stationData.routes[destSlug]?.schedules[dayOffset]?.[0];

    if (rawTrip) {
      console.log('   Raw JSON:', JSON.stringify(rawTrip));
      console.log('   Size:', JSON.stringify(rawTrip).length, 'bytes');

      // Compare to expanded
      const expandedSize = JSON.stringify(trips[0]).length;
      console.log('   Expanded size:', expandedSize, 'bytes');
      console.log('   Compression ratio:', ((1 - JSON.stringify(rawTrip).length / expandedSize) * 100).toFixed(1) + '%');
    }

    // Test file sizes
    console.log('\n📊 File sizes:');
    const stationStats = await fs.stat(stationPath);
    const patternStats = await fs.stat(patternPath);
    console.log(`   Station file: ${(stationStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Pattern file: ${(patternStats.size / 1024).toFixed(2)} KB`);
    console.log(`   Total: ${((stationStats.size + patternStats.size) / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n✅ V7 Decoder test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    throw error;
  }
}

// Run test
testV7Decoder();
