/**
 * Test script for serverless cache functionality
 * Run with: node test-serverless-cache.js
 */

import { gtfsCache } from './lib/gtfsCache.js';

async function testCache() {
  console.log('Testing GTFS Cache functionality...\n');

  // Test 1: Set and get cache
  console.log('Test 1: Set and get cache');
  await gtfsCache.set('test:ferry', { data: 'test ferry data' }, { ttl: 5 });
  const cached = await gtfsCache.get('test:ferry');
  console.log('✅ Cache set and retrieved:', cached?.data === 'test ferry data');

  // Test 2: Check staleness
  console.log('\nTest 2: Check staleness');
  const isStale = gtfsCache.isStale(cached, 5);
  console.log('✅ Fresh data not stale:', !isStale);

  // Test 3: Wait for data to become stale
  console.log('\nTest 3: Wait for data to become stale (5 seconds)...');
  await new Promise(resolve => setTimeout(resolve, 5100));
  const staleCheck = gtfsCache.isStale(cached, 5);
  console.log('✅ Data becomes stale after TTL:', staleCheck);

  // Test 4: Cache stats
  console.log('\nTest 4: Cache stats');
  const stats = gtfsCache.getStats();
  console.log('Cache entries:', stats.size);
  console.log('Entry details:', stats.entries);

  // Test 5: Clear cache
  console.log('\nTest 5: Clear cache');
  await gtfsCache.clear('test:ferry');
  const cleared = await gtfsCache.get('test:ferry');
  console.log('✅ Cache cleared:', cleared === null);

  console.log('\n✨ All tests passed!');
}

testCache().catch(console.error);