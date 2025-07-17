import React from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { API_CONFIG } from '../utils/constants';

const StatusBar = ({ lastUpdated, isLoading, onRefresh }) => {
  const formatTime = (date) => {
    if (!date) return 'Never';
    const zonedDate = toZonedTime(date, API_CONFIG.timezone);
    return format(zonedDate, 'h:mm a');
  };

  return (
    <div className="bg-gray-100 border-b border-gray-200">
      <div className="container mx-auto px-4 max-w-6xl py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>Last Updated:</span>
            <span className="font-medium">{formatTime(lastUpdated)}</span>
            {isLoading && (
              <span className="ml-2 text-ferry-blue">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </span>
            )}
          </div>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className={clsx(
              'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-all',
              isLoading
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-ferry-blue text-white hover:bg-blue-700 active:scale-95'
            )}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;