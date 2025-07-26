import React, { useState, useMemo, useEffect } from 'react';
import Navigation from './components/Navigation';
import StatusBar from './components/StatusBar';
import DepartureBoard from './components/DepartureBoard';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import FerryMapModal from './components/FerryMapModal';
import FerryDetailsModal from './components/FerryDetailsModal';
import StopSelectorModal from './components/StopSelectorModal';
import MobileBoardHeader from './components/MobileBoardHeader';
import DepartureTimeDropdown from './components/DepartureTimeDropdown';
import useFerryData from './hooks/useFerryData';
import staticGtfsService from './services/staticGtfsService';
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
  
  // Show stop selector if no permanently saved stops OR remember preference is false
  const [showStopSelector, setShowStopSelector] = useState(() => {
    // Show modal if:
    // 1. User hasn't saved stops permanently OR
    // 2. User has turned off "Remember selection" preference
    const hasRememberPreference = localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION) === 'true';
    const hasSavedStops = localStorage.getItem(STORAGE_KEYS.SELECTED_STOPS);
    
    return !hasSavedStops || !hasRememberPreference;
  });

  // Temporary stops for dropdown selections (session-based)
  const [temporaryStops, setTemporaryStops] = useState(selectedStops);
  
  // Available stops for dropdowns
  const [availableStops, setAvailableStops] = useState([]);
  const [validDestinations, setValidDestinations] = useState([]);
  const [stopsLoading, setStopsLoading] = useState(true);
  
  // Use temporary stops if set, otherwise use saved stops
  const currentStops = temporaryStops || selectedStops;
  
  // Departure time filter state (session-based)
  const [selectedDepartureTime, setSelectedDepartureTime] = useState(() => {
    const saved = sessionStorage.getItem(STORAGE_KEYS.DEPARTURE_TIME);
    return saved ? new Date(saved) : null;
  });
  
  // Save departure time to session storage
  useEffect(() => {
    if (selectedDepartureTime) {
      sessionStorage.setItem(STORAGE_KEYS.DEPARTURE_TIME, selectedDepartureTime.toISOString());
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.DEPARTURE_TIME);
    }
  }, [selectedDepartureTime]);
  
  const { departures, vehiclePositions, tripUpdates, loading, scheduleLoading, error, lastUpdated, refresh } = useFerryData(currentStops, selectedDepartureTime);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'express'
  const [showMap, setShowMap] = useState(false);
  // Determine default tab
  const getDefaultTab = () => {
    return 'outbound';
  };
  
  const [activeTab, setActiveTab] = useState(getDefaultTab()); // 'outbound' | 'inbound' - for mobile tabs
  const [selectedDeparture, setSelectedDeparture] = useState(null);
  
  // Handle stop selection change
  const handleStopChange = (newStops, rememberSelection = true) => {
    setSelectedStops(newStops);
    
    if (rememberSelection) {
      // Save permanently to localStorage
      localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, JSON.stringify(newStops));
      // Clear sessionStorage since we're saving permanently
      sessionStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS_SESSION);
    } else {
      // Save only to sessionStorage (cleared when browser closes)
      sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, JSON.stringify(newStops));
      // Make sure localStorage is cleared
      localStorage.removeItem(STORAGE_KEYS.SELECTED_STOPS);
    }
    
    setShowStopSelector(false);
    // Update temporary stops to match the new selection
    setTemporaryStops(newStops);
    // Clear departure time when changing stops
    setSelectedDepartureTime(null);
    // Force data refresh with new stops
    refresh();
  };
  
  // Load available stops on mount
  useEffect(() => {
    const loadStops = async () => {
      try {
        setStopsLoading(true);
        
        // Try to get stops from static GTFS service
        if (!staticGtfsService.hasStopsData()) {
          await staticGtfsService.getScheduledDepartures();
        }
        
        const stops = staticGtfsService.getAvailableStops();
        setAvailableStops(stops);
        
        // Get valid destinations for current origin
        const destinations = staticGtfsService.getValidDestinations(currentStops.outbound.id);
        setValidDestinations(destinations);
        
        setStopsLoading(false);
      } catch (error) {
        console.error('Error loading stops:', error);
        setStopsLoading(false);
      }
    };
    
    loadStops();
  }, [currentStops.outbound.id]);
  
  // Update valid destinations when origin changes
  useEffect(() => {
    if (availableStops.length > 0 && currentStops) {
      const destinations = staticGtfsService.getValidDestinations(currentStops.outbound.id);
      setValidDestinations(destinations);
    }
  }, [currentStops?.outbound?.id, availableStops]);
  
  // Handlers for dropdown changes
  const handleTemporaryOriginChange = (originId) => {
    const originStop = availableStops.find(s => s.id === originId);
    if (!originStop) return;
    
    // Get valid destinations for new origin
    const destinations = staticGtfsService.getValidDestinations(originId);
    
    // Check if current destination is still valid
    let destinationId = currentStops.inbound.id;
    let destinationStop = currentStops.inbound;
    
    if (!destinations.includes(destinationId) && destinations.length > 0) {
      // Current destination not valid, pick the first valid one
      destinationId = destinations[0];
      destinationStop = availableStops.find(s => s.id === destinationId);
    }
    
    setTemporaryStops({
      outbound: { id: originId, name: originStop.name },
      inbound: destinationStop
    });
  };
  
  const handleTemporaryDestinationChange = (destinationId) => {
    const destinationStop = availableStops.find(s => s.id === destinationId);
    if (!destinationStop) return;
    
    setTemporaryStops({
      outbound: currentStops.outbound,
      inbound: { id: destinationId, name: destinationStop.name }
    });
  };
  
  const handleSwitchDirection = () => {
    setTemporaryStops({
      outbound: currentStops.inbound,
      inbound: currentStops.outbound
    });
    // Don't switch active tab - mobile always shows outbound
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
        onOpenSettings={() => {
          setShowMap(false); // Close map modal first
          setShowStopSelector(true);
        }}
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
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between text-sm text-gray-600 bg-ferry-aqua/10 rounded-lg p-3 gap-3">
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
                      
                      {/* Desktop departure time dropdown */}
                      <div className="hidden md:block">
                        <DepartureTimeDropdown
                          value={selectedDepartureTime}
                          onChange={setSelectedDepartureTime}
                          disabled={loading}
                        />
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            
            
            {/* Mobile Board Header - visible on small screens */}
            <div className="md:hidden">
              <MobileBoardHeader
                originStop={currentStops.outbound}
                destinationStop={currentStops.inbound}
                availableStops={availableStops}
                validDestinations={validDestinations}
                onOriginChange={handleTemporaryOriginChange}
                onDestinationChange={handleTemporaryDestinationChange}
                onSwitchDirection={handleSwitchDirection}
                loading={stopsLoading}
              />
            </div>
            
            {/* Desktop Grid - hidden on small screens */}
            <div className="hidden md:grid md:grid-cols-2 gap-8">
              <DepartureBoard 
                direction="outbound"
                departures={filteredDepartures.outbound}
                loading={loading}
                selectedStops={currentStops}
                onDepartureClick={setSelectedDeparture}
                availableStops={availableStops}
                validDestinations={validDestinations}
                onOriginChange={handleTemporaryOriginChange}
                onDestinationChange={handleTemporaryDestinationChange}
                stopsLoading={stopsLoading}
              />
              <DepartureBoard 
                direction="inbound"
                departures={filteredDepartures.inbound}
                loading={loading}
                selectedStops={currentStops}
                onDepartureClick={setSelectedDeparture}
                availableStops={availableStops}
                validDestinations={validDestinations}
                onOriginChange={handleTemporaryOriginChange}
                onDestinationChange={handleTemporaryDestinationChange}
                stopsLoading={stopsLoading}
              />
            </div>
            
            {/* Mobile Single Board - visible on small screens */}
            <div className="md:hidden">
              <DepartureBoard 
                direction={activeTab}
                departures={activeTab === 'outbound' ? filteredDepartures.outbound : filteredDepartures.inbound}
                loading={loading}
                selectedStops={currentStops}
                onDepartureClick={setSelectedDeparture}
                availableStops={availableStops}
                validDestinations={validDestinations}
                onOriginChange={handleTemporaryOriginChange}
                onDestinationChange={handleTemporaryDestinationChange}
                stopsLoading={stopsLoading}
                isMobile={true}
                selectedDepartureTime={selectedDepartureTime}
                onDepartureTimeChange={setSelectedDepartureTime}
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
          selectedStops={currentStops}
          onClose={() => setSelectedDeparture(null)}
        />
      )}
      
      {/* Ferry Map Modal */}
      <FerryMapModal
        isOpen={showMap && vehiclePositions.length > 0}
        onClose={() => setShowMap(false)}
        vehiclePositions={vehiclePositions}
        tripUpdates={tripUpdates}
        departures={filteredDepartures}
        selectedStops={currentStops}
      />
      
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