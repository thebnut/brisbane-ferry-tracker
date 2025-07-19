import React, { useEffect, useMemo } from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { SERVICE_TYPES, API_CONFIG, STOPS, getOccupancyInfo, getVehicleStatusInfo } from '../utils/constants';
import FerryDetailMap from './FerryDetailMap';

const FerryDetailsModal = ({ departure, vehiclePositions, tripUpdates, selectedStops, onClose }) => {
  if (!departure) return null;

  // Get service info
  const routePrefix = departure.routeId.split('-')[0];
  const serviceInfo = SERVICE_TYPES[routePrefix] || SERVICE_TYPES.F1;
  
  // Find matching vehicle position
  const vehiclePosition = useMemo(() => {
    return vehiclePositions.find(vp => vp.vehicle?.trip?.tripId === departure.tripId);
  }, [vehiclePositions, departure.tripId]);
  
  // Find matching trip update
  const tripUpdate = useMemo(() => {
    return tripUpdates.find(tu => tu.tripUpdate?.trip?.tripId === departure.tripId);
  }, [tripUpdates, departure.tripId]);
  
  // Get live position data
  const position = vehiclePosition?.vehicle?.position;
  const hasLiveData = !!position;
  
  // Format times
  const departureTimeZoned = toZonedTime(departure.departureTime, API_CONFIG.timezone);
  const currentTimeZoned = toZonedTime(new Date(), API_CONFIG.timezone);
  const minutesUntil = differenceInMinutes(departureTimeZoned, currentTimeZoned);
  
  // Get destination info
  const destinationStop = departure.direction === 'outbound' 
    ? (selectedStops?.inbound?.name || 'Riverside') 
    : (selectedStops?.outbound?.name || 'Bulimba');
  const destinationStopId = departure.direction === 'outbound' 
    ? (selectedStops?.inbound?.id || STOPS.riverside) 
    : (selectedStops?.outbound?.id || STOPS.bulimba);
  
  // Find destination arrival time from trip update
  const destinationArrival = useMemo(() => {
    if (!tripUpdate?.tripUpdate?.stopTimeUpdate) return null;
    
    const stopUpdates = tripUpdate.tripUpdate.stopTimeUpdate;
    
    // Sort by stop sequence
    const sortedStops = [...stopUpdates].sort((a, b) => 
      (parseInt(a.stopSequence) || 0) - (parseInt(b.stopSequence) || 0)
    );
    
    // Find the departure stop index
    const departureIndex = sortedStops.findIndex(stu => stu.stopId === departure.stopId);
    if (departureIndex === -1) return null;
    
    // Find destination stop AFTER the departure
    const remainingStops = sortedStops.slice(departureIndex + 1);
    const destStop = remainingStops.find(stu => stu.stopId === destinationStopId);
    
    if (!destStop?.arrival?.time) return null;
    return new Date(destStop.arrival.time * 1000);
  }, [tripUpdate, destinationStopId, departure.stopId]);
  
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);
  
  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={clsx(
          'p-6 border-b',
          serviceInfo.isExpress ? 'bg-gradient-to-r from-yellow-50 to-white' : 'bg-gray-50'
        )}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-3">
                <span className="text-4xl">{serviceInfo.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-charcoal">
                      {serviceInfo.name} Ferry
                    </h2>
                    {hasLiveData ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5 animate-pulse"></span>
                        LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                        SCHEDULED
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-1">
                    {departure.direction === 'outbound' 
                      ? `${selectedStops?.outbound?.name || 'Bulimba'} → ${selectedStops?.inbound?.name || 'Riverside'}` 
                      : `${selectedStops?.inbound?.name || 'Riverside'} → ${selectedStops?.outbound?.name || 'Bulimba'}`}
                  </p>
                  <p className="text-xs text-gray-500">
                    Trip #{departure.tripId} • {vehiclePosition?.vehicle?.vehicle?.id ? `Vehicle ${vehiclePosition.vehicle.vehicle.id}` : 'No vehicle ID'}
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* Schedule Information */}
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold mb-4">Schedule Information</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Departure from {departure.direction === 'outbound' ? (selectedStops?.outbound?.name || 'Bulimba') : (selectedStops?.inbound?.name || 'Riverside')}</p>
              <p className="text-2xl font-bold">
                {format(departureTimeZoned, 'h:mm a')}
              </p>
              {departure.isRealtime && departure.scheduledTime && (
                <p className="text-sm text-gray-500 mt-1">
                  Scheduled: {format(toZonedTime(departure.scheduledTime, API_CONFIG.timezone), 'h:mm a')}
                </p>
              )}
              {departure.delay > 0 && (
                <p className="text-sm text-red-600 mt-1">
                  {Math.round(departure.delay / 60)} minutes late
                </p>
              )}
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Arrival at {destinationStop}</p>
              {(departure.destinationArrivalTime || destinationArrival) ? (
                <>
                  <p className="text-2xl font-bold">
                    {format(toZonedTime(departure.destinationArrivalTime || destinationArrival, API_CONFIG.timezone), 'h:mm a')}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Journey time: {differenceInMinutes(
                      departure.destinationArrivalTime || destinationArrival, 
                      departure.departureTime
                    )} mins
                  </p>
                </>
              ) : (
                <p className="text-lg text-gray-500">Estimated ~7-10 mins</p>
              )}
            </div>
          </div>
        </div>
        
        {/* Live Data */}
        {hasLiveData && (
          <div className="p-6 border-b">
            <h3 className="text-lg font-semibold mb-4">Live Information</h3>
            <div className="grid md:grid-cols-3 gap-4">
              {position.speed !== undefined && (
                <div className="text-center">
                  <p className="text-sm text-gray-600">Current Speed</p>
                  <p className="text-2xl font-bold">{Math.round(position.speed * 3.6)} km/h</p>
                </div>
              )}
              
              {vehiclePosition.vehicle?.occupancyStatus !== null && vehiclePosition.vehicle?.occupancyStatus !== undefined && (() => {
                const occupancyInfo = getOccupancyInfo(vehiclePosition.vehicle.occupancyStatus);
                return occupancyInfo ? (
                  <div className="text-center">
                    <p className="text-sm text-gray-600">Occupancy</p>
                    <p className="text-lg font-semibold">
                      {occupancyInfo.icon} {occupancyInfo.text}
                    </p>
                  </div>
                ) : null;
              })()}
              
              {vehiclePosition.vehicle?.currentStatus !== null && vehiclePosition.vehicle?.currentStatus !== undefined && (
                <div className="text-center">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="text-lg font-semibold">
                    {getVehicleStatusInfo(vehiclePosition.vehicle.currentStatus)}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Map */}
        {hasLiveData && (
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Live Position</h3>
            <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '300px' }}>
              <FerryDetailMap 
                departure={departure}
                vehiclePosition={vehiclePosition}
                hasLiveData={hasLiveData}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FerryDetailsModal;