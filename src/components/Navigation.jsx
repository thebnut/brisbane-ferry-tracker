import React from 'react';
import { useModeConfig } from '../config';

const Navigation = ({ onOpenSettings }) => {
  const config = useModeConfig();
  const fallbackLogo = {
    src: '/bf.com_logo_text.png',
    alt: 'Brisbane Ferry Tracker',
    height: 'h-16 md:h-28'
  };
  const branding = config?.branding || {};
  const logo = branding.logo || fallbackLogo;
  const title = config?.mode?.name || 'Brisbane Ferry Tracker';
  return (
    <nav className="bg-gradient-to-r from-white via-ferry-orange-light to-ferry-light-blue shadow-xl sticky top-0 z-50 border-b-2 border-ferry-orange/50 animate-gradient bg-[length:200%_100%]">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between py-1">
          <div className="flex items-start">
            {logo?.src ? (
              <img
                src={logo.src}
                alt={logo.alt || title}
                className={`${logo.height || 'h-16 md:h-28'} w-auto max-w-[280px] md:max-w-none`}
              />
            ) : (
              <h1 className="text-2xl md:text-4xl font-bold text-ferry-aqua">
                {title}
              </h1>
            )}
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <button
              onClick={onOpenSettings}
              className="flex items-center space-x-2 text-xs md:text-sm font-semibold text-ferry-aqua bg-white/90 backdrop-blur-sm pl-3 pr-2 md:pl-4 md:pr-3 py-1.5 rounded-full shadow-md border border-ferry-orange/20 hover:shadow-lg hover:border-ferry-orange/40 transition-all duration-300 group"
              title="Change stops"
            >
              <span>Settings</span>
              <svg className="w-4 md:w-5 h-4 md:h-5 text-ferry-aqua/70 group-hover:text-ferry-orange group-hover:rotate-45 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
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
