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

function App() {
  // Load saved stops or use defaults
  const [selectedStops, setSelectedStops] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
    return saved ? JSON.parse(saved) : DEFAULT_STOPS;
  });
  
  // Show stop selector on first visit
  const [showStopSelector, setShowStopSelector] = useState(() => {
    return !localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
  });

  const { departures, vehiclePositions, tripUpdates, loading, scheduleLoading, error, lastUpdated, refresh } = useFerryData(selectedStops);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'express'
  const [showMap, setShowMap] = useState(false);
  // Determine default tab based on time of day
  const getDefaultTab = () => {
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
  const handleStopChange = (newStops) => {
    setSelectedStops(newStops);
    localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, JSON.stringify(newStops));
    setShowStopSelector(false);
    // Force data refresh with new stops
    refresh();
  };
  
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
            {/* Service Filter */}
            <div className="mb-6">
              {/* Service Filter */}
              <div className="flex flex-wrap gap-3 justify-center text-sm mb-4">
                {/* All filter */}
                <button
                  onClick={() => setFilterMode('all')}
                  className={clsx(
                    'flex items-center space-x-2 rounded-full px-5 py-2.5 transition-all transform hover:scale-105',
                    filterMode === 'all'
                      ? 'bg-ferry-blue text-white shadow-lg ring-2 ring-ferry-blue ring-opacity-50'
                      : 'bg-white border border-gray-300 text-gray-700 hover:border-ferry-blue opacity-70'
                  )}
                >
                  <span className="text-lg">🚢</span>
                  <span className="font-semibold">All Services</span>
                </button>
                
                {/* Express filter */}
                <button
                  onClick={() => setFilterMode('express')}
                  className={clsx(
                    'flex items-center space-x-2 rounded-full px-5 py-2.5 transition-all transform hover:scale-105',
                    filterMode === 'express'
                      ? 'bg-gradient-to-r from-golden to-yellow-500 text-white shadow-lg ring-2 ring-golden ring-opacity-50'
                      : 'bg-gradient-to-r from-yellow-50 to-white border-2 border-golden text-charcoal hover:from-yellow-100 opacity-70'
                  )}
                >
                  <span className="text-xl">🚤</span>
                  <span className="font-bold">EXPRESS</span>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-xs opacity-80">Only</span>
                </button>
                
              </div>
              
              {/* Status indicator */}
              {(() => {
                const hasScheduled = departures.outbound.some(d => d.isScheduled) || departures.inbound.some(d => d.isScheduled);
                const hasRealtime = departures.outbound.some(d => d.isRealtime) || departures.inbound.some(d => d.isRealtime);
                const isGitHubPages = window.location.hostname.includes('github.io');
                
                if (hasScheduled || hasRealtime || scheduleLoading || isGitHubPages) {
                  return (
                    <div className="text-center text-sm text-gray-600 bg-blue-50 rounded-lg p-2">
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
            <div className="md:hidden mb-4">
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                <button
                  onClick={() => setActiveTab('outbound')}
                  className={clsx(
                    'flex-1 py-3 px-4 text-sm font-semibold transition-colors',
                    activeTab === 'outbound'
                      ? 'bg-ferry-blue text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  )}
                >
                  To {selectedStops.inbound.name}
                </button>
                <button
                  onClick={() => setActiveTab('inbound')}
                  className={clsx(
                    'flex-1 py-3 px-4 text-sm font-semibold transition-colors',
                    activeTab === 'inbound'
                      ? 'bg-ferry-blue text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  )}
                >
                  To {selectedStops.outbound.name}
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
    </div>
  );
}

export default App;