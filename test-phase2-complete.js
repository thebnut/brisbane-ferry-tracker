/**
 * Test script for Phase 2 complete implementation
 * Tests serverless cache, GTFS filtering, and mode-specific paths
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

// Test serverless cache endpoint
async function testServerlessCache() {
  console.log('🧪 Testing Phase 2 Complete Implementation\n');
  console.log('=' .repeat(50));

  // Test 1: Test ferry mode filtering
  console.log('\n📍 Test 1: Ferry Mode Filtering');
  try {
    const ferryResponse = await fetch('http://localhost:5173/api/rt/ferry?endpoint=TripUpdates');

    console.log('Response headers:');
    console.log('  X-Cache:', ferryResponse.headers.get('X-Cache'));
    console.log('  X-Mode:', ferryResponse.headers.get('X-Mode'));
    console.log('  X-Entities-Count:', ferryResponse.headers.get('X-Entities-Count'));

    if (ferryResponse.ok) {
      const data = await ferryResponse.arrayBuffer();
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(data)
      );

      console.log(`✅ Received ${feed.entity.length} ferry entities`);

      // Check that all routes are ferry routes (start with F)
      const nonFerryRoutes = feed.entity.filter(e => {
        const routeId = e.tripUpdate?.trip?.routeId || e.vehicle?.trip?.routeId;
        return routeId && !routeId.startsWith('F');
      });

      if (nonFerryRoutes.length === 0) {
        console.log('✅ All routes are ferry routes (F*)');
      } else {
        console.log(`⚠️ Found ${nonFerryRoutes.length} non-ferry routes`);
      }
    } else {
      console.log('❌ Failed to fetch ferry data:', ferryResponse.status);
    }
  } catch (error) {
    console.log('❌ Test 1 failed:', error.message);
  }

  // Test 2: Test cache performance
  console.log('\n📍 Test 2: Cache Performance');
  const times = [];

  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const response = await fetch('http://localhost:5173/api/rt/ferry?endpoint=TripUpdates');
    const elapsed = Date.now() - start;
    times.push(elapsed);

    const cacheStatus = response.headers.get('X-Cache');
    console.log(`  Request ${i + 1}: ${elapsed}ms (${cacheStatus})`);

    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const avgTime = times.reduce((a, b) => a + b) / times.length;
  console.log(`\n  Average response time: ${avgTime.toFixed(2)}ms`);

  if (avgTime < 200) {
    console.log('  ✅ Performance target met (<200ms)');
  } else {
    console.log('  ⚠️ Performance needs improvement');
  }

  // Test 3: Test mode-specific paths
  console.log('\n📍 Test 3: Mode-Specific Schedule Paths');
  try {
    // Check if ferry schedule exists
    const ferrySchedule = await fetch('http://localhost:5173/schedule-data/ferry/latest.json');
    if (ferrySchedule.ok) {
      const data = await ferrySchedule.json();
      console.log('  ✅ Ferry schedule found:', {
        mode: data.mode,
        routeAllowSet: data.routeAllowSet?.slice(0, 5),
        departureCount: data.departureCount
      });
    } else {
      console.log('  ⚠️ Ferry schedule not found at mode-specific path');
    }
  } catch (error) {
    console.log('  ❌ Test 3 failed:', error.message);
  }

  // Test 4: Test error handling
  console.log('\n📍 Test 4: Error Handling');
  try {
    const badResponse = await fetch('http://localhost:5173/api/rt/invalid?endpoint=TripUpdates');
    if (badResponse.status === 400) {
      const error = await badResponse.json();
      console.log('  ✅ Invalid mode handled correctly:', error.error);
    } else {
      console.log('  ⚠️ Unexpected response for invalid mode:', badResponse.status);
    }
  } catch (error) {
    console.log('  ❌ Test 4 failed:', error.message);
  }

  // Test 5: Test train mode fallback
  console.log('\n📍 Test 5: Train Mode Fallback');
  try {
    const trainResponse = await fetch('http://localhost:5173/api/rt/train?endpoint=TripUpdates');
    if (trainResponse.ok) {
      console.log('  ✅ Train mode request successful (using fallback filtering)');
      const mode = trainResponse.headers.get('X-Mode');
      console.log('  Mode:', mode);
    } else {
      console.log('  ⚠️ Train mode request failed:', trainResponse.status);
    }
  } catch (error) {
    console.log('  ❌ Test 5 failed:', error.message);
  }

  console.log('\n' + '=' .repeat(50));
  console.log('✨ Phase 2 Testing Complete!');
}

// Run tests
testServerlessCache().catch(console.error);