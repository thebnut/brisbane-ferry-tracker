/**
 * Group train platforms into stations for UI
 */

import fs from 'fs/promises';

async function groupStations() {
  console.log('🏗️  Grouping platforms into stations...\n');

  // Read the extracted stations
  const data = JSON.parse(
    await fs.readFile('./train-stations.json', 'utf-8')
  );

  const stations = data.stations;
  console.log(`📍 Processing ${stations.length} platforms...`);

  // Group by station name (remove platform info)
  const stationMap = new Map();

  stations.forEach(stop => {
    // Extract station name (before ", platform")
    const match = stop.name.match(/^(.+?),?\s*platform\s+\d+$/i);
    const stationName = match ? match[1].trim() : stop.name;

    if (!stationMap.has(stationName)) {
      stationMap.set(stationName, {
        name: stationName,
        platforms: [],
        ids: []
      });
    }

    const station = stationMap.get(stationName);

    // Extract platform number
    const platformMatch = stop.name.match(/platform\s+(\d+)/i);
    if (platformMatch) {
      station.platforms.push(platformMatch[1]);
    }

    station.ids.push(stop.id);
  });

  // Convert to array and sort
  const groupedStations = Array.from(stationMap.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(station => ({
      name: station.name,
      platformCount: station.platforms.length,
      platforms: station.platforms.sort((a, b) => a - b),
      stopIds: station.ids  // All platform stop IDs for this station
    }));

  console.log(`✅ Grouped into ${groupedStations.length} unique stations\n`);

  // Display sample
  console.log('Sample stations:');
  groupedStations.slice(0, 10).forEach(station => {
    console.log(`  - ${station.name} (${station.platformCount} platforms)`);
  });

  // Save grouped stations
  const output = {
    generated: new Date().toISOString(),
    totalStations: groupedStations.length,
    totalPlatforms: stations.length,
    stations: groupedStations
  };

  await fs.writeFile(
    './train-stations-grouped.json',
    JSON.stringify(output, null, 2)
  );

  console.log(`\n💾 Saved to ./train-stations-grouped.json`);

  // Create a simple UI-friendly version (just station names with first stop ID)
  const uiStations = groupedStations.map(station => ({
    name: station.name,
    // Use the first stop ID as the representative ID for this station
    // The API should handle querying all platforms for a station
    stopIds: station.stopIds
  }));

  await fs.writeFile(
    './train-stations-for-ui.json',
    JSON.stringify(uiStations, null, 2)
  );

  console.log(`💾 Saved UI version to ./train-stations-for-ui.json`);

  console.log('\n🎉 Done!\n');
}

groupStations().catch(console.error);
