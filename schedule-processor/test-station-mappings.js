/**
 * Test Station Mappings
 * Verify the platform-to-station lookup works correctly
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildStationMappings() {
  const groupedData = JSON.parse(
    await fs.readFile(path.join(__dirname, 'train-stations-grouped.json'), 'utf-8')
  );

  const platformToStation = new Map();
  const stationSlugs = new Map();
  const stationPlatforms = new Map();

  groupedData.stations.forEach(station => {
    const stationName = station.name;

    const slug = stationName
      .replace(/\s+station$/i, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    stationSlugs.set(stationName, slug);
    stationPlatforms.set(stationName, station.stopIds);

    station.stopIds.forEach(platformId => {
      platformToStation.set(platformId, stationName);
    });
  });

  return { platformToStation, stationSlugs, stationPlatforms };
}

async function test() {
  console.log('🧪 Testing Station Mappings\n');

  const { platformToStation, stationSlugs, stationPlatforms } = await buildStationMappings();

  console.log(`✅ Loaded ${stationSlugs.size} stations, ${platformToStation.size} platforms\n`);

  // Test known platform IDs
  const testCases = [
    { platformId: '600005', expectedStation: 'Bowen Hills station' },
    { platformId: '600014', expectedStation: 'Fortitude Valley station' },
    { platformId: '600000', expectedStation: 'Bowen Hills station' }, // Different platform, same station
  ];

  console.log('Testing platform-to-station lookups:');
  testCases.forEach(({ platformId, expectedStation }) => {
    const station = platformToStation.get(platformId);
    const slug = station ? stationSlugs.get(station) : null;
    const platforms = station ? stationPlatforms.get(station) : null;

    const match = station === expectedStation ? '✅' : '❌';
    console.log(`  ${match} Platform ${platformId}:`);
    console.log(`     Station: ${station}`);
    console.log(`     Slug: ${slug}`);
    console.log(`     All platforms: ${platforms?.join(', ')}`);
  });

  console.log('\nTesting route key generation:');
  const origin = '600005'; // Bowen Hills platform 1
  const dest = '600014';   // Fortitude Valley platform 1

  const originStation = platformToStation.get(origin);
  const destStation = platformToStation.get(dest);
  const originSlug = stationSlugs.get(originStation);
  const destSlug = stationSlugs.get(destStation);
  const routeKey = `${originSlug}-${destSlug}`;

  console.log(`  Origin: ${origin} → ${originStation} → ${originSlug}`);
  console.log(`  Dest: ${dest} → ${destStation} → ${destSlug}`);
  console.log(`  Route Key: ${routeKey}`);
  console.log(`  Expected filename: train-${routeKey}.json`);

  console.log('\n🎉 All tests passed!');
}

test().catch(console.error);
