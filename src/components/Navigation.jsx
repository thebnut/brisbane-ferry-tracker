import React from 'react';

// BRI-31 redesign: mobile nav is tuned for iPhone 15 Pro Dynamic Island.
// - `pt-[calc(env(safe-area-inset-top)+0.5rem)]` pushes content a little below
//   the OS-reported safe-area so the DI (which in idle state sits inside the
//   status-bar strip) never visually overlaps nav content, even during
//   Live Activities / Face ID indicators that briefly extend the island.
// - Logo + controls shrink on mobile so neither the logo's right edge nor the
//   controls on the right intrude horizontally into the DI's centred footprint.
// - Settings label collapses to an icon-only pill on narrow viewports.
// On the web (env() = 0), the calc still evaluates cleanly (0 + 0.5rem = 8px
// top padding), which is a minor spacing change indistinguishable from before.
const Navigation = ({ onOpenSettings }) => {
  return (
    <nav className="bg-gradient-to-r from-white via-ferry-orange-light to-ferry-light-blue shadow-xl sticky top-0 z-50 border-b-2 border-ferry-orange/50 animate-gradient bg-[length:200%_100%] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between py-1">
          <div className="flex items-start">
            <img
              src="/bf.com_logo.png"
              alt="Brisbane Ferry Tracker"
              className="h-12 md:h-28 w-auto max-w-[150px] md:max-w-none"
            />
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <button
              onClick={onOpenSettings}
              className="flex items-center space-x-2 text-xs md:text-sm font-semibold text-ferry-aqua bg-white/90 backdrop-blur-sm px-2 md:pl-4 md:pr-3 py-1.5 rounded-full shadow-md border border-ferry-orange/20 hover:shadow-lg hover:border-ferry-orange/40 transition-all duration-300 group"
              title="Change stops"
              aria-label="Settings"
            >
              <span className="hidden md:inline">Settings</span>
              <svg className="w-4 md:w-5 h-4 md:h-5 text-ferry-aqua/70 group-hover:text-ferry-orange group-hover:rotate-45 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <span className="text-[10px] md:text-xs text-white font-bold bg-ferry-orange px-2.5 md:px-4 py-1 md:py-1.5 rounded-full animate-pulse shadow-lg animate-glow">
              LIVE
            </span>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
