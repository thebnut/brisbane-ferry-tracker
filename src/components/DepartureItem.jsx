import React from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { SERVICE_TYPES, API_CONFIG, getOccupancyInfo } from '../utils/constants';

const DepartureItem = ({ departure, onClick }) => {
  // Get service info based on route ID prefix (remove suffix like -4055)
  const routePrefix = departure.routeId.split('-')[0];
  const serviceInfo = SERVICE_TYPES[routePrefix] || SERVICE_TYPES.F1;
  
  const departureTimeZoned = toZonedTime(departure.departureTime, API_CONFIG.timezone);
  const currentTimeZoned = toZonedTime(new Date(), API_CONFIG.timezone);
  const minutesUntil = differenceInMinutes(departureTimeZoned, currentTimeZoned);
  
  const getCountdownColor = () => {
    if (minutesUntil <= 5) return 'bg-red-100 text-red-800 border-red-300';
    if (minutesUntil <= 15) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-green-100 text-green-800 border-green-300';
  };

  const getCountdownText = () => {
    if (minutesUntil < 1) return 'Departing';
    if (minutesUntil === 1) return 'in 1 min';
    return `in ${minutesUntil} mins`;
  };

  return (
    <div 
      onClick={() => onClick(departure)}
      className={clsx(
        'ferry-card flex items-center justify-between p-5 mb-3 transition-all cursor-pointer hover:shadow-md',
        serviceInfo.isExpress && 'border-2 border-golden bg-gradient-to-r from-yellow-50 to-white shadow-lg hover:shadow-xl transform hover:scale-[1.02]'
      )}>
      <div className="flex items-center space-x-4">
        <span className={clsx(
          'text-4xl',
          serviceInfo.isExpress && 'animate-pulse'
        )}>{serviceInfo.icon}</span>
        <div>
          <div className="flex items-center space-x-2">
            <span className={clsx(
              'px-3 py-1 rounded-full text-xs font-bold text-white shadow-sm',
              serviceInfo.color,
              serviceInfo.isExpress && 'text-sm animate-pulse'
            )}>
              {serviceInfo.name}
            </span>
            {departure.isRealtime ? (
              <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                LIVE
              </span>
            ) : departure.isScheduled ? (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                Scheduled
              </span>
            ) : null}
            {serviceInfo.isExpress && (
              <span className="text-golden">
                <svg className="w-5 h-5 inline-block" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              </span>
            )}
          </div>
          <p className={clsx(
            'font-semibold mt-1',
            serviceInfo.isExpress ? 'text-xl text-charcoal' : 'text-lg'
          )}>
            {format(departureTimeZoned, 'h:mm a')}
            {departure.isRealtime && departure.scheduledTime && (
              <span className="text-xs text-gray-500 font-normal ml-2">
                (Sched {format(toZonedTime(departure.scheduledTime, API_CONFIG.timezone), 'h:mm a')})
              </span>
            )}
          </p>
          {departure.delay > 0 && (
            <p className="text-sm text-red-600">
              {Math.round(departure.delay / 60)} min late
            </p>
          )}
        </div>
      </div>
      
      <div className="text-right">
        <div className={clsx(
          'countdown-badge border',
          getCountdownColor(),
          serviceInfo.isExpress && minutesUntil <= 15 && 'font-bold text-base'
        )}>
          {getCountdownText()}
        </div>
        {(() => {
          const occupancyInfo = getOccupancyInfo(departure.occupancy);
          return occupancyInfo ? (
            <p className="text-xs text-gray-500 mt-2">
              {occupancyInfo.icon} {occupancyInfo.text}
            </p>
          ) : null;
        })()}
      </div>
    </div>
  );
};

export default DepartureItem;