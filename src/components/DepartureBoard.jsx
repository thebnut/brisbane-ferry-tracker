import React, { useState } from 'react';
import DepartureItem from './DepartureItem';

const DepartureBoard = ({ direction, departures, loading, selectedStops, onDepartureClick }) => {
  const [showMore, setShowMore] = useState(false);
  const getDirectionEmoji = () => {
    return direction === 'outbound' ? '→' : '←';
  };

  const getTitle = () => {
    if (!selectedStops) {
      return direction === 'outbound' 
        ? 'Bulimba → Riverside' 
        : 'Riverside → Bulimba';
    }
    
    // Remove "ferry terminal" from stop names for cleaner display
    const cleanStopName = (name) => name.replace(' ferry terminal', '');
    
    return direction === 'outbound' 
      ? `${cleanStopName(selectedStops.outbound.name)} → ${cleanStopName(selectedStops.inbound.name)}` 
      : `${cleanStopName(selectedStops.inbound.name)} → ${cleanStopName(selectedStops.outbound.name)}`;
  };

  if (loading && departures.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="text-xl font-bold mb-4">
          {getTitle()}
        </h2>
        <div className="ferry-card animate-pulse">
          <div className="h-20 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold mb-4 text-ferry-aqua bg-gradient-to-r from-white/80 to-ferry-orange-light/50 rounded-xl px-4 py-3 shadow-sm border border-ferry-orange/10 backdrop-blur-sm">
        {getTitle()}
      </h2>
      
      {departures.length === 0 ? (
        <div className="ferry-card text-center py-8 text-gray-500">
          <p>No upcoming departures found</p>
          <p className="text-sm mt-2">Services may have finished for today</p>
        </div>
      ) : (
        <div>
          {departures.slice(0, showMore ? 13 : 5).map((departure) => (
            <DepartureItem 
              key={`${departure.tripId}-${departure.stopId}-${departure.departureTime.getTime()}`} 
              departure={departure}
              onClick={onDepartureClick}
            />
          ))}
          {departures.length > 5 && (
            <button
              onClick={() => setShowMore(!showMore)}
              className="w-full mt-4 py-3 bg-gradient-to-r from-white to-ferry-orange-light text-ferry-orange font-bold hover:from-ferry-orange-light hover:to-ferry-orange hover:text-white rounded-lg transition-all duration-300 border-2 border-ferry-orange/30"
            >
              {showMore ? 'Show Less' : `More... (${Math.min(departures.length - 5, 8)} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DepartureBoard;