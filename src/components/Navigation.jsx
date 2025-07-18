import React from 'react';

const Navigation = ({ selectedStops, onOpenSettings }) => {
  return (
    <nav className="bg-ferry-blue text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">⛴️</span>
            <div>
              <h1 className="text-xl font-bold">Brisbane Ferry Tracker</h1>
              <p className="text-sm text-blue-100">
                {selectedStops?.outbound?.name || 'Bulimba'} ⟷ {selectedStops?.inbound?.name || 'Riverside'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={onOpenSettings}
              className="p-2 hover:bg-blue-700 rounded-lg transition-colors"
              title="Change stops"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <span className="text-sm text-blue-100">
              Live Departures
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;