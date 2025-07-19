import React from 'react';

const Navigation = ({ selectedStops, onOpenSettings }) => {
  return (
    <nav className="bg-gradient-to-r from-white via-ferry-orange-light to-ferry-light-blue shadow-xl sticky top-0 z-50 border-b-2 border-ferry-orange/50 animate-gradient bg-[length:200%_100%]">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center space-x-3 md:space-x-4">
            <img 
              src="/brisbaneferry_logo.png" 
              alt="Brisbane Ferry Logo" 
              className="h-14 md:h-16 w-auto"
            />
            <div className="flex-1">
              <h1 className="text-lg md:text-xl font-bold text-ferry-blue">Brisbane Ferry Tracker</h1>
              <p className="text-xs text-charcoal italic hidden sm:block">The quickest way to get live City Cat info!</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <div className="flex items-center space-x-1 md:space-x-2">
              <span className="text-xs md:text-sm font-semibold text-ferry-blue bg-white/90 backdrop-blur-sm px-3 md:px-4 py-1.5 rounded-full shadow-md border border-ferry-orange/20">
                {selectedStops?.outbound?.name || 'Bulimba'} ⟷ {selectedStops?.inbound?.name || 'Riverside'}
              </span>
              <button
                onClick={onOpenSettings}
                className="p-1.5 md:p-2 hover:bg-ferry-orange hover:text-white text-ferry-blue rounded-lg transition-all duration-300 hover:rotate-45 hover:shadow-lg"
                title="Change stops"
              >
                <svg className="w-4 md:w-5 h-4 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            <span className="text-xs text-white font-bold bg-ferry-orange px-3 md:px-4 py-1.5 rounded-full animate-pulse shadow-lg animate-glow">
              LIVE
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;