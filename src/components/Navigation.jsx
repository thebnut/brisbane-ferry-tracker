import React from 'react';

const Navigation = () => {
  return (
    <nav className="bg-ferry-blue text-white shadow-lg sticky top-0 z-50">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">⛴️</span>
            <div>
              <h1 className="text-xl font-bold">Brisbane Ferry Tracker</h1>
              <p className="text-sm text-blue-100">Bulimba ⟷ Riverside</p>
            </div>
          </div>
          <div className="text-sm text-blue-100">
            Live Departures
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;