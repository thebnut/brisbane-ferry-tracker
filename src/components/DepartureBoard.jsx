import React, { useState } from 'react';
import DepartureItem from './DepartureItem';

const DepartureBoard = ({ direction, departures, loading }) => {
  const [showMore, setShowMore] = useState(false);
  const getDirectionEmoji = () => {
    return direction === 'outbound' ? '→' : '←';
  };

  const getTitle = () => {
    return direction === 'outbound' 
      ? 'BULIMBA → RIVERSIDE' 
      : 'RIVERSIDE → BULIMBA';
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
      <h2 className="text-xl font-bold mb-4 text-charcoal bg-gray-100 rounded-lg p-3">
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
            />
          ))}
          {departures.length > 5 && (
            <button
              onClick={() => setShowMore(!showMore)}
              className="w-full mt-3 py-2 text-ferry-blue font-medium hover:text-blue-700 transition-colors"
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