import React, { useState, useEffect } from 'react';
import staticGtfsService from '../services/staticGtfsService';
import { DEFAULT_STOPS, STORAGE_KEYS } from '../utils/constants';
import { FERRY_STOPS, TEMPORARY_CONNECTIVITY } from '../utils/ferryStops';

const StopSelectorModal = ({ isOpen, onClose, currentStops, onSave }) => {
  const [selectedOrigin, setSelectedOrigin] = useState(currentStops?.outbound?.id || DEFAULT_STOPS.outbound.id);
  const [selectedDestination, setSelectedDestination] = useState(currentStops?.inbound?.id || DEFAULT_STOPS.inbound.id);
  const [availableStops, setAvailableStops] = useState([]);
  const [validDestinations, setValidDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rememberSelection, setRememberSelection] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION) === 'true';
  });
  
  // Helper function to remove 'ferry terminal' from stop names
  const cleanStopName = (name) => name ? name.replace(' ferry terminal', '') : '';

  // Load stops when modal opens
  useEffect(() => {
    if (isOpen) {
      loadStops();
    }
  }, [isOpen]);

  // Load available stops
  const loadStops = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Try to load from static GTFS service first
      let stops = [];
      let useTemporaryData = true;
      
      if (!staticGtfsService.hasStopsData()) {
        try {
          await staticGtfsService.getScheduledDepartures();
        } catch (e) {
          console.warn('Could not load schedule data, using temporary stops');
        }
      }
      
      stops = staticGtfsService.getAvailableStops();
      if (stops.length > 0) {
        useTemporaryData = false;
      } else {
        // Use temporary ferry stops data as fallback
        stops = Object.entries(FERRY_STOPS).map(([id, stop]) => ({
          id,
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng
        })).sort((a, b) => a.name.localeCompare(b.name));
      }
      
      // Sort stops alphabetically by name
      const sortedStops = [...stops].sort((a, b) => a.name.localeCompare(b.name));
      setAvailableStops(sortedStops);
      
      // Get valid destinations
      let destinations = [];
      if (useTemporaryData) {
        destinations = TEMPORARY_CONNECTIVITY[selectedOrigin] || [];
      } else {
        destinations = staticGtfsService.getValidDestinations(selectedOrigin);
      }
      
      setValidDestinations(destinations);
      
      // Check if current destination is still valid
      if (!destinations.includes(selectedDestination) && destinations.length > 0) {
        setSelectedDestination(destinations[0]);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error loading stops:', err);
      setError('Failed to load ferry stop data. Please try again.');
      setLoading(false);
    }
  };

  // Update valid destinations when origin changes
  useEffect(() => {
    if (selectedOrigin && availableStops.length > 0) {
      // Check if we're using temporary data
      const hasRealData = staticGtfsService.hasStopsData();
      let destinations = [];
      
      if (hasRealData) {
        destinations = staticGtfsService.getValidDestinations(selectedOrigin);
      } else {
        destinations = TEMPORARY_CONNECTIVITY[selectedOrigin] || [];
      }
      
      setValidDestinations(destinations);
      
      // Reset destination if not valid for new origin
      if (!destinations.includes(selectedDestination) && destinations.length > 0) {
        setSelectedDestination(destinations[0]);
      }
    }
  }, [selectedOrigin, availableStops]);

  // Handle save
  const handleSave = () => {
    const originStop = availableStops.find(s => s.id === selectedOrigin);
    const destinationStop = availableStops.find(s => s.id === selectedDestination);
    
    if (originStop && destinationStop) {
      // Save the remember preference itself
      if (rememberSelection) {
        localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true');
      } else {
        localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION);
      }
      
      onSave({
        outbound: {
          id: selectedOrigin,
          name: originStop.name
        },
        inbound: {
          id: selectedDestination,
          name: destinationStop.name
        }
      }, rememberSelection);
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b bg-gradient-to-r from-ferry-orange-light to-white">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-charcoal flex items-center gap-2">
              <span className="text-3xl">🛥️</span>
              Select Ferry Stops
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ferry-orange"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Origin Stop */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  From (Origin Stop)
                </label>
                <select
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-ferry-orange focus:border-ferry-orange transition-colors"
                >
                  {availableStops.map(stop => (
                    <option key={stop.id} value={stop.id}>
                      {cleanStopName(stop.name)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Destination Stop */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  To (Destination Stop)
                </label>
                <select
                  value={selectedDestination}
                  onChange={(e) => setSelectedDestination(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-ferry-orange focus:border-ferry-orange transition-colors"
                  disabled={validDestinations.length === 0}
                >
                  {validDestinations.length > 0 ? (
                    validDestinations
                      .map(stopId => availableStops.find(s => s.id === stopId))
                      .filter(stop => stop !== undefined)
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(stop => (
                        <option key={stop.id} value={stop.id}>
                          {cleanStopName(stop.name)}
                        </option>
                      ))
                  ) : (
                    <option value="">No direct connections available</option>
                  )}
                </select>
                {validDestinations.length === 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    No ferries run directly from the selected origin stop
                  </p>
                )}
              </div>

              {/* Route Preview */}
              {selectedOrigin && selectedDestination && (
                <div className="bg-ferry-orange-light rounded-lg p-4 border border-ferry-orange/20">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">Selected Route:</span>
                  </p>
                  <p className="text-lg font-semibold text-ferry-orange mt-1">
                    {cleanStopName(availableStops.find(s => s.id === selectedOrigin)?.name)} → {cleanStopName(availableStops.find(s => s.id === selectedDestination)?.name)}
                  </p>
                </div>
              )}

              {/* Regular Commuter Settings */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Regular Commuter Settings</h3>
                <div className="space-y-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700">Remember selection</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rememberSelection}
                      onClick={() => {
                        const newValue = !rememberSelection;
                        setRememberSelection(newValue);
                        
                        // Save the preference immediately
                        if (newValue) {
                          localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true');
                        } else {
                          localStorage.removeItem(STORAGE_KEYS.REMEMBER_SELECTION);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ferry-orange focus:ring-offset-2 ${
                        rememberSelection ? 'bg-ferry-orange' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          rememberSelection ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </label>
                  <p className="text-xs text-gray-500">
                    Your stop selection will be saved for next time. You can always change it later using the settings icon.
                  </p>
                </div>
              </div>
              
              {/* Temporary data notice */}
              {!staticGtfsService.hasStopsData() && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800">
                    Note: Using temporary stop data. Full connectivity information will be available after the next schedule update.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className="p-6 border-t bg-gray-50 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all hover:scale-105"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!selectedOrigin || !selectedDestination}
              className="px-4 py-2 bg-ferry-orange text-white rounded-lg hover:bg-ferry-orange-dark transition-all hover:scale-105 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StopSelectorModal;