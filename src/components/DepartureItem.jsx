import React from 'react';
import { format, differenceInMinutes, isTomorrow, isAfter, startOfDay, addDays } from 'date-fns';
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
  
  // Check if departure is tomorrow or later
  const tomorrowStart = startOfDay(addDays(currentTimeZoned, 1));
  const isNotToday = isAfter(departureTimeZoned, tomorrowStart) || isTomorrow(departureTimeZoned);
  
  const getCountdownColor = () => {
    if (minutesUntil < 1) return 'bg-gradient-to-r from-red-500 to-ferry-orange text-white border-0 animate-pulse';
    if (minutesUntil <= 5) return 'bg-ferry-orange text-white border-ferry-orange animate-pulse';
    if (minutesUntil <= 15) return 'bg-ferry-sunset text-white border-ferry-sunset';
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
        'ferry-card flex items-center justify-between p-5 mb-3 transition-all duration-300 cursor-pointer hover:scale-[1.02] group',
        serviceInfo.isExpress 
          ? 'border-2 border-ferry-orange bg-gradient-to-r from-ferry-orange-light to-white shadow-lg hover:shadow-xl hover:shadow-ferry-orange/30 animate-glow' 
          : 'hover:border-ferry-orange/50'
      )}>
      <div className="flex items-center space-x-4">
        <span className={clsx(
          'text-4xl transition-transform duration-300 group-hover:scale-110',
          serviceInfo.isExpress ? 'animate-float' : 'group-hover:rotate-6'
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
              <span className="px-2.5 py-1 bg-ferry-orange text-white rounded-full text-xs font-bold animate-pulse shadow-md">
                LIVE
              </span>
            ) : departure.isScheduled ? (
              <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                Scheduled
              </span>
            ) : null}
            {serviceInfo.isExpress && (
              <span className="text-ferry-orange">
                <svg className="w-5 h-5 inline-block animate-pulse" fill="currentColor" viewBox="0 0 20 20">
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
            {isNotToday && (
              <span className="text-sm text-ferry-orange font-medium ml-1">
                ({format(departureTimeZoned, 'dd/MM')})
              </span>
            )}
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
          'countdown-badge border-2 shadow-md',
          getCountdownColor(),
          serviceInfo.isExpress && minutesUntil <= 15 && 'font-bold text-base scale-110',
          'transition-all duration-300'
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