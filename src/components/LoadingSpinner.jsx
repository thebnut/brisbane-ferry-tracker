import React from 'react';

const LoadingSpinner = () => {
  // Check if this is the first time loading (no cached schedule)
  const isFirstLoad = !localStorage.getItem('brisbane-ferry-schedule-cache');
  
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative">
        <div className="h-20 w-20 rounded-full bg-gradient-to-r from-ferry-orange to-ferry-sunset p-1 animate-pulse">
          <div className="h-full w-full rounded-full bg-white/90 flex items-center justify-center">
            <span className="text-3xl animate-bounce">⛴️</span>
          </div>
        </div>
        <div className="absolute top-0 left-0 h-20 w-20 rounded-full border-4 border-ferry-orange border-t-transparent animate-spin"></div>
      </div>
      <p className="mt-4 text-ferry-blue font-bold text-lg">Loading ferry times...</p>
      {isFirstLoad && (
        <p className="mt-2 text-sm text-ferry-orange text-center max-w-xs">
          First time loading may take a moment while we download the ferry schedule
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;