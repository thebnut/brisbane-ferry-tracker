import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Light basemap for every Leaflet map in the app.
 *
 * CARTO stopped serving keyless raster tiles in September 2026 (keyless
 * requests now get an "API KEY REQUIRED" watermark tile). We now render the
 * OpenFreeMap "Positron" vector style (the same light look as CARTO light_all)
 * through MapLibre GL inside Leaflet. OpenFreeMap's public instance needs no
 * key, account or cookies and allows commercial use: https://openfreemap.org
 *
 * If the device has no WebGL (MapLibre needs it), fall back to standard
 * OpenStreetMap raster tiles so the map still has a background.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

let webglSupport;
function hasWebGL() {
  if (webglSupport !== undefined) return webglSupport;
  try {
    const canvas = document.createElement('canvas');
    webglSupport = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

function createRasterFallback() {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: OSM_ATTRIBUTION,
    maxZoom: 19,
  });
}

function BaseMapLayer() {
  const map = useMap();

  useEffect(() => {
    let layer;
    if (hasWebGL()) {
      try {
        layer = maplibreGL({
          style: BASEMAP_STYLE_URL,
          attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
        });
      } catch (error) {
        console.warn('Vector basemap unavailable, using raster fallback', error);
        layer = undefined;
      }
    }
    if (!layer) layer = createRasterFallback();

    try {
      layer.addTo(map);
    } catch (error) {
      // MapLibre throws while creating its WebGL context if the context is
      // lost or blocked; fall back to raster tiles instead of a blank map.
      console.warn('Vector basemap failed to start, using raster fallback', error);
      if (map.hasLayer(layer)) map.removeLayer(layer);
      layer = createRasterFallback().addTo(map);
    }

    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

export default BaseMapLayer;
