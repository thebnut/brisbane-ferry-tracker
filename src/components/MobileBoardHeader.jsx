import React from 'react';
import SearchableSelect from './SearchableSelect';

const MobileBoardHeader = ({
  originStop,
  destinationStop,
  availableStops,
  validDestinations,
  onOriginChange,
  onDestinationChange,
  onSwitchDirection,
  loading = false
}) => {
  // Helper function to clean stop names
  const cleanStopName = (name) => {
    if (!name) return '';
    return name.replace(' ferry terminal', '').replace(/ station$/i, '');
  };

  return (
    <div className="flex items-center justify-center space-x-2 mb-6 rounded-xl overflow-visible border-2 border-ferry-orange/30 shadow-lg bg-white/90 backdrop-blur-sm px-3 py-2">
      <SearchableSelect
        value={originStop.id}
        onChange={onOriginChange}
        options={availableStops}
        getOptionLabel={(stop) => cleanStopName(stop.name)}
        getOptionValue={(stop) => stop.id}
        placeholder="Origin..."
        disabled={loading}
        className="min-w-0 max-w-[140px]"
        compact={true}
      />

      <button
        onClick={onSwitchDirection}
        className="p-1.5 text-ferry-orange hover:bg-ferry-orange-light rounded-lg transition-all active:scale-95 flex-shrink-0"
        aria-label="Switch direction"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      </button>

      <SearchableSelect
        value={destinationStop.id}
        onChange={onDestinationChange}
        options={availableStops.filter(stop => validDestinations.includes(stop.id))}
        getOptionLabel={(stop) => cleanStopName(stop.name)}
        getOptionValue={(stop) => stop.id}
        placeholder="Destination..."
        disabled={loading || validDestinations.length === 0}
        className="min-w-0 max-w-[140px]"
        compact={true}
      />
    </div>
  );
};

export default MobileBoardHeader;