import React from 'react';

const LoadingSpinner = () => {
  // Check if this is the first time loading (no cached schedule)
  const isFirstLoad = !localStorage.getItem('brisbane-ferry-schedule-cache');
  
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative">
        <div className="h-16 w-16 rounded-full border-4 border-ferry-blue border-opacity-25"></div>
        <div className="absolute top-0 left-0 h-16 w-16 rounded-full border-4 border-ferry-blue border-t-transparent animate-spin"></div>
      </div>
      <p className="mt-4 text-gray-600 font-medium">Loading ferry times...</p>
      {isFirstLoad && (
        <p className="mt-2 text-sm text-gray-500 text-center max-w-xs">
          First time loading may take a moment while we download the ferry schedule
        </p>
      )}
    </div>
  );
};

export default LoadingSpinner;