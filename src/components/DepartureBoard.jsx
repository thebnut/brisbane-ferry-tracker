import React, { useState } from 'react';
import DepartureItem from './DepartureItem';
import BoardHeader from './BoardHeader';
import DepartureTimeDropdown from './DepartureTimeDropdown';

const DepartureBoard = ({ 
  direction, 
  departures, 
  loading, 
  selectedStops, 
  onDepartureClick,
  availableStops = [],
  validDestinations = [],
  onOriginChange,
  onDestinationChange,
  stopsLoading = false,
  isMobile = false,
  selectedDepartureTime,
  onDepartureTimeChange
}) => {
  const [showMore, setShowMore] = useState(false);

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
        {!isMobile && availableStops.length > 0 && onOriginChange && onDestinationChange ? (
          <BoardHeader
            direction={direction}
            originStop={selectedStops.outbound}
            destinationStop={selectedStops.inbound}
            availableStops={availableStops}
            validDestinations={validDestinations}
            onOriginChange={onOriginChange}
            onDestinationChange={onDestinationChange}
            loading={stopsLoading}
          />
        ) : (
          <div className="flex items-center justify-between gap-2 text-base font-semibold mb-4 text-ferry-aqua bg-gradient-to-r from-white/80 to-ferry-orange-light/50 rounded-xl px-4 py-3 shadow-sm border border-ferry-orange/10 backdrop-blur-sm">
            <span className="flex-shrink">{getTitle()}</span>
            {isMobile && onDepartureTimeChange && (
              <DepartureTimeDropdown
                value={selectedDepartureTime}
                onChange={onDepartureTimeChange}
                disabled={loading}
                compact={true}
              />
            )}
          </div>
        )}
        <div className="ferry-card">
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-ferry-orange mx-auto mb-4"></div>
              <p className="text-gray-500">Loading departures...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      {!isMobile && availableStops.length > 0 && onOriginChange && onDestinationChange ? (
        <BoardHeader
          direction={direction}
          originStop={selectedStops.outbound}
          destinationStop={selectedStops.inbound}
          availableStops={availableStops}
          validDestinations={validDestinations}
          onOriginChange={onOriginChange}
          onDestinationChange={onDestinationChange}
          loading={stopsLoading}
        />
      ) : (
        <div className="flex items-center justify-between gap-2 text-base font-semibold mb-4 text-ferry-aqua bg-gradient-to-r from-white/80 to-ferry-orange-light/50 rounded-xl px-4 py-3 shadow-sm border border-ferry-orange/10 backdrop-blur-sm">
          <span className="flex-shrink">{getTitle()}</span>
          {isMobile && onDepartureTimeChange && (
            <DepartureTimeDropdown
              value={selectedDepartureTime}
              onChange={onDepartureTimeChange}
              disabled={loading}
              compact={true}
            />
          )}
        </div>
      )}
      
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