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
    // Don't show countdown for trips more than 1 hour away
    if (minutesUntil > 60) return null;
    
    if (minutesUntil < 1) return 'Departing';
    if (minutesUntil === 1) return 'in 1 min';
    
    return `in ${minutesUntil} mins`;
  };

  return (
    <div 
      onClick={() => onClick(departure)}
      className={clsx(
        'ferry-card flex items-center justify-between p-5 mb-3 min-h-[6rem] transition-all duration-300 cursor-pointer hover:scale-[1.02] group',
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
          </p>
          <p className={clsx(
            "text-xs mt-0.5",
            departure.isRealtime ? "text-gray-500" : "invisible"
          )}>
            {!departure.isRealtime 
              ? "Placeholder"
              : departure.scheduledTime && format(departureTimeZoned, 'h:mm a') !== format(toZonedTime(departure.scheduledTime, API_CONFIG.timezone), 'h:mm a')
                ? `Scheduled: ${format(toZonedTime(departure.scheduledTime, API_CONFIG.timezone), 'h:mm a')}`
                : "On time"}
          </p>
        </div>
      </div>
      
      <div className="text-right">
        {(() => {
          const countdownText = getCountdownText();
          return countdownText ? (
            <div className={clsx(
              'countdown-badge border-2 shadow-md',
              getCountdownColor(),
              serviceInfo.isExpress && minutesUntil <= 15 && 'font-bold text-base scale-110',
              'transition-all duration-300'
            )}>
              {countdownText}
            </div>
          ) : null;
        })()}
        {departure.delay > 0 && (
          <p className="text-xs text-red-600 mt-1">
            {Math.round(departure.delay / 60)} min late
          </p>
        )}
      </div>
    </div>
  );
};

export default DepartureItem;