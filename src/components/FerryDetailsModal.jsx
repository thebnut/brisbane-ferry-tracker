import React, { useEffect, useMemo } from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { SERVICE_TYPES, API_CONFIG, STOPS } from '../utils/constants';
import FerryDetailMap from './FerryDetailMap';

const FerryDetailsModal = ({ departure, vehiclePositions, tripUpdates, onClose }) => {
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
  const destinationStop = departure.direction === 'outbound' ? 'Riverside' : 'Bulimba';
  const destinationStopId = departure.direction === 'outbound' ? STOPS.riverside : STOPS.bulimba;
  
  // Find destination arrival time from trip update
  const destinationArrival = useMemo(() => {
    if (!tripUpdate?.tripUpdate?.stopTimeUpdate) return null;
    
    const destStop = tripUpdate.tripUpdate.stopTimeUpdate.find(
      stu => stu.stopId === destinationStopId
    );
    
    if (!destStop?.arrival?.time) return null;
    return new Date(destStop.arrival.time * 1000);
  }, [tripUpdate, destinationStopId]);
  
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
              <div className="flex items-center space-x-3 mb-2">
                <span className="text-4xl">{serviceInfo.icon}</span>
                <div>
                  <h2 className="text-2xl font-bold text-charcoal">
                    {serviceInfo.name} Ferry
                  </h2>
                  <p className="text-sm text-gray-600">
                    {departure.direction === 'outbound' ? 'Bulimba → Riverside' : 'Riverside → Bulimba'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 mt-2">
                {hasLiveData ? (
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                    LIVE TRACKING
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
                    SCHEDULED
                  </span>
                )}
                <span className="text-sm text-gray-500">Trip #{departure.tripId}</span>
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
              <p className="text-sm text-gray-600 mb-1">Departure from {departure.direction === 'outbound' ? 'Bulimba' : 'Riverside'}</p>
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
              {destinationArrival ? (
                <>
                  <p className="text-2xl font-bold">
                    {format(toZonedTime(destinationArrival, API_CONFIG.timezone), 'h:mm a')}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Journey time: {differenceInMinutes(destinationArrival, departure.departureTime)} mins
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
              
              {vehiclePosition.vehicle?.occupancyStatus && (
                <div className="text-center">
                  <p className="text-sm text-gray-600">Occupancy</p>
                  <p className="text-lg font-semibold">
                    {vehiclePosition.vehicle.occupancyStatus === 'MANY_SEATS_AVAILABLE' && '🟢 Many seats'}
                    {vehiclePosition.vehicle.occupancyStatus === 'FEW_SEATS_AVAILABLE' && '🟡 Few seats'}
                    {vehiclePosition.vehicle.occupancyStatus === 'STANDING_ROOM_ONLY' && '🟠 Standing room'}
                    {vehiclePosition.vehicle.occupancyStatus === 'CRUSHED_STANDING_ROOM_ONLY' && '🔴 Very full'}
                    {vehiclePosition.vehicle.occupancyStatus === 'FULL' && '🔴 Full'}
                  </p>
                </div>
              )}
              
              {vehiclePosition.vehicle?.currentStatus && (
                <div className="text-center">
                  <p className="text-sm text-gray-600">Status</p>
                  <p className="text-lg font-semibold">
                    {vehiclePosition.vehicle.currentStatus.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Map */}
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {hasLiveData ? 'Live Position' : 'Route Map'}
          </h3>
          <div className="rounded-lg overflow-hidden border border-gray-200" style={{ height: '300px' }}>
            <FerryDetailMap 
              departure={departure}
              vehiclePosition={vehiclePosition}
              hasLiveData={hasLiveData}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FerryDetailsModal;