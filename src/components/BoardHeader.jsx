import React from 'react';
import SearchableSelect from './SearchableSelect';

const BoardHeader = ({ 
  direction,
  originStop,
  destinationStop,
  availableStops,
  validDestinations,
  onOriginChange,
  onDestinationChange,
  loading = false
}) => {
  // Determine which stop is the "from" and which is the "to" based on direction
  const fromStop = direction === 'outbound' ? originStop : destinationStop;
  const toStop = direction === 'outbound' ? destinationStop : originStop;
  
  // Get the appropriate change handler based on direction
  const handleFromChange = (stopId) => {
    if (direction === 'outbound') {
      onOriginChange(stopId);
    } else {
      onDestinationChange(stopId);
    }
  };
  
  const handleToChange = (stopId) => {
    if (direction === 'outbound') {
      onDestinationChange(stopId);
    } else {
      onOriginChange(stopId);
    }
  };

  // Filter valid options for the "to" dropdown based on direction
  const toOptions = direction === 'outbound'
    ? availableStops.filter(stop => validDestinations.includes(stop.id))
    : availableStops; // For inbound, all stops are valid origins

  // Helper function to clean stop names
  const cleanStopName = (name) => {
    if (!name) return '';
    return name.replace(' ferry terminal', '').replace(/ station$/i, '');
  };

  return (
    <div className="flex items-center space-x-2 text-base font-semibold mb-4 text-ferry-aqua bg-gradient-to-r from-white/80 to-ferry-orange-light/50 rounded-xl px-4 py-3 shadow-sm border border-ferry-orange/10 backdrop-blur-sm overflow-visible">
      <SearchableSelect
        value={fromStop.id}
        onChange={handleFromChange}
        options={availableStops}
        getOptionLabel={(stop) => cleanStopName(stop.name)}
        getOptionValue={(stop) => stop.id}
        placeholder="Search origin..."
        disabled={loading}
        className="flex-1"
      />

      <span className="text-ferry-aqua text-xl">→</span>

      <SearchableSelect
        value={toStop.id}
        onChange={handleToChange}
        options={toOptions}
        getOptionLabel={(stop) => cleanStopName(stop.name)}
        getOptionValue={(stop) => stop.id}
        placeholder="Search destination..."
        disabled={loading || toOptions.length === 0}
        className="flex-1"
      />

      {toOptions.length === 0 && !loading && (
        <span className="text-red-500 text-xs ml-2">No valid destinations</span>
      )}
    </div>
  );
};

export default BoardHeader;