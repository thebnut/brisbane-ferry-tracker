import React from 'react';
import StopDropdown from './StopDropdown';

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
  return (
    <div className="flex items-center space-x-2 mb-6 rounded-xl overflow-hidden border-2 border-ferry-orange/30 shadow-lg bg-white/90 backdrop-blur-sm px-3 py-2">
      <StopDropdown
        value={originStop.id}
        onChange={onOriginChange}
        options={availableStops}
        disabled={loading}
        className="flex-1"
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
      
      <StopDropdown
        value={destinationStop.id}
        onChange={onDestinationChange}
        options={availableStops.filter(stop => validDestinations.includes(stop.id))}
        disabled={loading || validDestinations.length === 0}
        className="flex-1"
        compact={true}
      />
    </div>
  );
};

export default MobileBoardHeader;