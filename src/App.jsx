import React, { useState, useMemo } from 'react';
import Navigation from './components/Navigation';
import StatusBar from './components/StatusBar';
import DepartureBoard from './components/DepartureBoard';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import FerryMap from './components/FerryMap';
import FerryDetailsModal from './components/FerryDetailsModal';
import StopSelectorModal from './components/StopSelectorModal';
import useFerryData from './hooks/useFerryData';
import { toZonedTime } from 'date-fns-tz';
import clsx from 'clsx';
import { STORAGE_KEYS, DEFAULT_STOPS } from './utils/constants';
import { SpeedInsights } from '@vercel/speed-insights/react';

function App() {
  // v1.2.0 - Modern orange-themed redesign with animations (2025-07-19)
  // Load saved stops or use defaults
  const [selectedStops, setSelectedStops] = useState(() => {
    // Check localStorage first (permanent storage)
    const savedPermanent = localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
    if (savedPermanent) {
      return JSON.parse(savedPermanent);
    }
    
    // Check sessionStorage (temporary storage)
    const savedSession = sessionStorage.getItem(STORAGE_KEYS.SELECTED_STOPS_SESSION);
    if (savedSession) {
      return JSON.parse(savedSession);
    }
    
    // Use defaults if nothing saved
    return DEFAULT_STOPS;
  });
  
  // Show stop selector if no permanently saved stops
  const [showStopSelector, setShowStopSelector] = useState(() => {
    // Always show modal if user hasn't saved permanently
    return !localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
  });

  const { departures, vehiclePositions, tripUpdates, loading, scheduleLoading, error, lastUpdated, refresh } = useFerryData(selectedStops);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'express'
  const [showMap, setShowMap] = useState(false);
  // Determine default tab
  const getDefaultTab = () => {
    // Check if reverse after lunch is enabled
    const reverseAfterLunch = localStorage.getItem(STORAGE_KEYS.REVERSE_AFTER_LUNCH) === 'true';
    
    if (!reverseAfterLunch) {
      return 'outbound';
    }
    
    // Original time-based logic
    const now = new Date();
    const brisbanTime = toZonedTime(now, 'Australia/Brisbane');
    const hours = brisbanTime.getHours();
    const minutes = brisbanTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    // After 12:30 PM (750 minutes) until midnight, default to inbound
    return totalMinutes >= 750 ? 'inbound' : 'outbound';
  };
  
  const [activeTab, setActiveTab] = useState(getDefaultTab()); // 'outbound' | 'inbound' - for mobile tabs
  const [selectedDeparture, setSelectedDeparture] = useState(null);
  
  // Handle stop selection change
  const handleStopChange = (newStops, rememberSelection = true, reverseAfterLunch = false) => {
    setSelectedStops(newStops);
    
    if (rememberSelection) {
      // Save permanently to localStorage
      localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, JSON.stringify(newStops));
      // Save reverse after lunch preference
      localStorage.setItem(STORAGE_KEYS.REVERSE_AFTER_LUNCH, reverseAfterLunch.toString());
      // Clear sessionStorage since we're saving permanently
      sessionStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS_SESSION);
    } else {
      // Save only to sessionStorage (cleared when browser closes)
      sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, JSON.stringify(newStops));
      // Make sure localStorage is cleared
      localStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS);
      localStorage.removeItem(STORAGE_KEYS.REVERSE_AFTER_LUNCH);
    }
    
    setShowStopSelector(false);
    // Force data refresh with new stops
    refresh();
  };
  
  // Check if there are any express services in the next 13 departures
  const hasExpressServices = useMemo(() => {
    const allDepartures = [...departures.outbound.slice(0, 13), ...departures.inbound.slice(0, 13)];
    return allDepartures.some(dep => {
      const routePrefix = dep.routeId.split('-')[0];
      return routePrefix === 'F11';
    });
  }, [departures]);
  
  // Filter departures based on selected mode
  const filteredDepartures = useMemo(() => {
    if (filterMode === 'all') {
      return departures;
    }
    
    const filterFunc = (dep) => {
      const routePrefix = dep.routeId.split('-')[0];
      if (filterMode === 'express') {
        return routePrefix === 'F11';
      }
      return true;
    };
    
    return {
      outbound: departures.outbound.filter(filterFunc),
      inbound: departures.inbound.filter(filterFunc)
    };
  }, [departures, filterMode]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation 
        selectedStops={selectedStops}
        onOpenSettings={() => setShowStopSelector(true)}
      />
      
      <StatusBar 
        lastUpdated={lastUpdated}
        isLoading={loading}
        onRefresh={refresh}
        showMap={showMap}
        onToggleMap={() => setShowMap(!showMap)}
        filterMode={filterMode}
        onFilterChange={setFilterMode}
        hasExpressServices={hasExpressServices}
      />
      
      {/* Schedule loading indicator */}
      {scheduleLoading && !loading && (
        <div className="bg-amber-50 border-b border-amber-200">
          <div className="container mx-auto px-4 max-w-6xl py-2">
            <div className="flex items-center justify-center space-x-2 text-sm text-amber-800">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading schedule data... (showing live departures only)</span>
            </div>
          </div>
        </div>
      )}
      
      <main className="container mx-auto px-4 max-w-6xl py-8">
        {error && !loading && (
          <ErrorMessage message={error} onRetry={refresh} />
        )}
        
        {loading && departures.outbound.length === 0 && departures.inbound.length === 0 ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Status indicator */}
            <div className="mb-6">
              {(() => {
                const hasScheduled = departures.outbound.some(d => d.isScheduled) || departures.inbound.some(d => d.isScheduled);
                const hasRealtime = departures.outbound.some(d => d.isRealtime) || departures.inbound.some(d => d.isRealtime);
                const isGitHubPages = window.location.hostname.includes('github.io');
                
                if (hasScheduled || hasRealtime || scheduleLoading || isGitHubPages) {
                  return (
                    <div className="text-center text-sm text-gray-600 bg-ferry-aqua/10 rounded-lg p-2">
                      <span className="inline-flex items-center space-x-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                          {isGitHubPages 
                            ? "Showing scheduled times only • Live tracking requires Vercel deployment"
                            : scheduleLoading && hasRealtime 
                            ? "Showing live departures only • Schedule data loading..."
                            : hasRealtime && hasScheduled 
                            ? "Showing live departures and scheduled times"
                            : hasRealtime 
                            ? "Showing live departures"
                            : "Showing scheduled times • Real-time updates will appear when ferries are running"
                          }
                        </span>
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            
            {/* Ferry Map */}
            {showMap && vehiclePositions.length > 0 && (
              <FerryMap 
                vehiclePositions={vehiclePositions}
                tripUpdates={tripUpdates}
                departures={filteredDepartures}
                selectedStops={selectedStops}
                onHide={() => setShowMap(false)}
              />
            )}
            
            {/* Mobile Tabs - visible on small screens */}
            <div className="md:hidden mb-6">
              <div className="flex rounded-xl overflow-hidden border-2 border-ferry-orange/30 shadow-lg bg-white/90 backdrop-blur-sm p-1">
                <button
                  onClick={() => setActiveTab('outbound')}
                  className={clsx(
                    'flex-1 py-4 px-4 text-sm font-bold transition-all duration-300 rounded-lg',
                    activeTab === 'outbound'
                      ? 'bg-ferry-orange text-white shadow-md scale-[1.02]'
                      : 'text-ferry-aqua hover:bg-ferry-orange-light active:scale-95'
                  )}
                >
                  <span className="block text-xs opacity-75 mb-1">To</span>
                  {selectedStops.inbound.name.replace(' ferry terminal', '')}
                </button>
                <button
                  onClick={() => setActiveTab('inbound')}
                  className={clsx(
                    'flex-1 py-4 px-4 text-sm font-bold transition-all duration-300 rounded-lg',
                    activeTab === 'inbound'
                      ? 'bg-ferry-orange text-white shadow-md scale-[1.02]'
                      : 'text-ferry-aqua hover:bg-ferry-orange-light active:scale-95'
                  )}
                >
                  <span className="block text-xs opacity-75 mb-1">To</span>
                  {selectedStops.outbound.name.replace(' ferry terminal', '')}
                </button>
              </div>
            </div>
            
            {/* Desktop Grid - hidden on small screens */}
            <div className="hidden md:grid md:grid-cols-2 gap-8">
              <DepartureBoard 
                direction="outbound"
                departures={filteredDepartures.outbound}
                loading={loading}
                selectedStops={selectedStops}
                onDepartureClick={setSelectedDeparture}
              />
              <DepartureBoard 
                direction="inbound"
                departures={filteredDepartures.inbound}
                loading={loading}
                selectedStops={selectedStops}
                onDepartureClick={setSelectedDeparture}
              />
            </div>
            
            {/* Mobile Single Board - visible on small screens */}
            <div className="md:hidden">
              <DepartureBoard 
                direction={activeTab}
                departures={activeTab === 'outbound' ? filteredDepartures.outbound : filteredDepartures.inbound}
                loading={loading}
                selectedStops={selectedStops}
                onDepartureClick={setSelectedDeparture}
              />
            </div>
          </>
        )}
      </main>
      
      <footer className="mt-16 py-8 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-6xl text-center text-sm text-gray-600">
          <p>Data provided by TransLink Queensland</p>
          <p className="mt-2">Updates every 5 minutes • Shows next 24 hours • All times in Brisbane time</p>
        </div>
      </footer>
      
      {/* Ferry Details Modal */}
      {selectedDeparture && (
        <FerryDetailsModal
          departure={selectedDeparture}
          vehiclePositions={vehiclePositions}
          tripUpdates={tripUpdates}
          selectedStops={selectedStops}
          onClose={() => setSelectedDeparture(null)}
        />
      )}
      
      {/* Stop Selector Modal */}
      <StopSelectorModal
        isOpen={showStopSelector}
        onClose={() => setShowStopSelector(false)}
        currentStops={selectedStops}
        onSave={handleStopChange}
      />
      
      {/* Vercel Speed Insights */}
      <SpeedInsights />
    </div>
  );
}

export default App;