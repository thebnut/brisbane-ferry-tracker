import React from 'react';
import { format, differenceInMinutes, isTomorrow, isAfter, startOfDay, addDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { SERVICE_TYPES, API_CONFIG, getOccupancyInfo } from '../utils/constants';

const DepartureItem = ({ departure, onClick }) => {
  // Get service info based on route ID prefix (remove suffix like -4055)
  const routePrefix = departure.routeId.split('-')[0];
  const serviceInfo = SERVICE_TYPES[routePrefix] || SERVICE_TYPES.F1;
  
  // Force initial render to complete before animations
  const [isInitialRender, setIsInitialRender] = React.useState(true);
  React.useEffect(() => {
    const timer = requestAnimationFrame(() => {
      setIsInitialRender(false);
    });
    return () => cancelAnimationFrame(timer);
  }, []);
  
  // Pre-calculate status text to avoid rendering issues
  const statusText = React.useMemo(() => {
    if (!departure.isRealtime) return null;
    if (!departure.scheduledTime) return "On time";
    
    const actualTime = departure.departureTime.getTime();
    const scheduledTime = new Date(departure.scheduledTime).getTime();
    const timeDiff = Math.abs(actualTime - scheduledTime);
    
    if (timeDiff >= 60000) {
      return `Scheduled: ${format(toZonedTime(departure.scheduledTime, API_CONFIG.timezone), 'h:mm a')}`;
    }
    
    return "On time";
  }, [departure.isRealtime, departure.scheduledTime, departure.departureTime, departure.tripId]);
  
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
        'ferry-card flex items-center justify-between p-5 mb-3 min-h-[6rem] cursor-pointer hover:scale-[1.02] group',
        // Disable transitions on initial render to prevent text overlap
        isInitialRender ? '' : 'transition-all duration-300',
        serviceInfo.isExpress 
          ? 'border-2 border-ferry-orange bg-gradient-to-r from-ferry-orange-light to-white shadow-lg hover:shadow-xl hover:shadow-ferry-orange/30 animate-glow' 
          : 'hover:border-ferry-orange/50'
      )}>
      <div className="flex items-center space-x-4">
        <span className={clsx(
          'text-4xl transition-transform duration-300 group-hover:scale-110',
          serviceInfo.isExpress ? 'animate-float' : 'group-hover:rotate-6'
        )}>{serviceInfo.icon}</span>
        <div style={{ 
          // Ensure proper layout calculation on mobile
          isolation: 'isolate',
          willChange: 'auto'
        }}>
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
          {statusText && (
            <p 
              className="text-xs mt-0.5 text-gray-500"
              key={`status-${departure.tripId}-${departure.departureTime.getTime()}`}
              style={{ 
                // Force proper text rendering on mobile
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                // Ensure text doesn't overlap
                position: 'relative',
                zIndex: 1,
                // Force layout calculation
                contain: 'layout style'
              }}
            >
              {statusText}
            </p>
          )}
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