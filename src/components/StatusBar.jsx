import React from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { API_CONFIG } from '../utils/constants';

const StatusBar = ({ lastUpdated, isLoading, onRefresh, showMap, onToggleMap, filterMode, onFilterChange, hasExpressServices }) => {
  const formatTime = (date) => {
    if (!date) return 'Never';
    const zonedDate = toZonedTime(date, API_CONFIG.timezone);
    return format(zonedDate, 'h:mm a');
  };

  return (
    <div className="bg-gradient-to-r from-white to-ferry-orange-light/50 border-b border-ferry-orange/20 backdrop-blur-sm">
      <div className="container mx-auto px-4 max-w-6xl py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-charcoal">
            <div className="flex items-center space-x-1">
              <svg className="w-4 h-4 text-ferry-orange" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <span>Last Updated:</span>
            </div>
            <div className="font-semibold flex items-center text-ferry-aqua">
              {formatTime(lastUpdated)}
              <button
                onClick={onRefresh}
                disabled={isLoading}
                className={clsx(
                  'ml-2 p-1 rounded transition-all duration-300',
                  isLoading
                    ? 'text-ferry-orange cursor-not-allowed'
                    : 'text-ferry-aqua hover:text-ferry-orange hover:bg-ferry-orange/10 active:scale-95'
                )}
                title="Refresh"
              >
                {isLoading ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          
          {/* Action Buttons - Right side */}
          <div className="flex items-center space-x-2">
            {/* Service Filter Button - Only show if we have express services or if express filter is active */}
            {(hasExpressServices || filterMode === 'express') && (
              <button
                onClick={() => onFilterChange && onFilterChange(filterMode === 'all' ? 'express' : 'all')}
                className={clsx(
                  'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-300 active:scale-95 shadow-md text-sm sm:text-base',
                  filterMode === 'express'
                    ? 'bg-ferry-aqua text-white hover:bg-ferry-aqua-light hover:shadow-lg'
                    : 'bg-white text-ferry-orange border-2 border-ferry-orange hover:bg-ferry-orange hover:text-white'
                )}
              >
                <span className="text-sm sm:text-base">{filterMode === 'express' ? '🚢' : '🚤'}</span>
                <span>{filterMode === 'express' ? 'All Ferries' : 'Express only'}</span>
              </button>
            )}
            <button
              onClick={onToggleMap}
              className={clsx(
                'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all duration-300 active:scale-95 shadow-md',
                showMap
                  ? 'bg-ferry-orange text-white hover:bg-ferry-orange-dark hover:shadow-lg'
                  : 'bg-white text-ferry-orange border-2 border-ferry-orange hover:bg-ferry-orange hover:text-white'
              )}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>Map</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;