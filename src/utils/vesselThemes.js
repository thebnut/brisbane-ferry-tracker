// Vessel theme configuration for special livery ferries
// Currently tracking Bluey-themed "CityDog" ferries

export const VESSEL_THEMES = {
  // Gootcha is wrapped as Bluey
  'Gootcha': {
    character: 'Bluey',
    emoji: '🔵',
    dogEmoji: '🐕',
    color: '#4A90E2',
    bgColor: 'bg-blue-500',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-500',
    description: 'Bluey CityDog',
    message: "You're riding on the Bluey CityDog!",
    mapColor: '#4A90E2'
  },
  
  // Kuluwin is wrapped as Bingo
  'Kuluwin': {
    character: 'Bingo',
    emoji: '🟠',
    dogEmoji: '🐕',
    color: '#FF8C42',
    bgColor: 'bg-orange-500',
    textColor: 'text-orange-600',
    borderColor: 'border-orange-500',
    description: 'Bingo CityDog',
    message: "You're riding on the Bingo CityDog!",
    mapColor: '#FF8C42'
  }
};

// Helper function to get vessel theme
export const getVesselTheme = (vesselName) => {
  if (!vesselName) return null;
  
  // Check for exact match first
  if (VESSEL_THEMES[vesselName]) {
    return VESSEL_THEMES[vesselName];
  }
  
  // Check for case-insensitive match
  const normalizedName = vesselName.charAt(0).toUpperCase() + vesselName.slice(1).toLowerCase();
  return VESSEL_THEMES[normalizedName] || null;
};

// Helper to format vessel name with theme
export const formatVesselWithTheme = (vesselName) => {
  const theme = getVesselTheme(vesselName);
  if (theme) {
    return {
      name: vesselName,
      displayName: `${vesselName} ${theme.dogEmoji}`,
      theme: theme
    };
  }
  return {
    name: vesselName,
    displayName: vesselName,
    theme: null
  };
};