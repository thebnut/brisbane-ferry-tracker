import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import { MaplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 looks for its worker next to its own module URL, which does not
// survive bundling (and is not http(s) inside the Capacitor app). Ship the
// prebuilt, self-contained worker as a same-origin asset and point MapLibre
// at it explicitly.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(maplibreWorkerUrl);

/**
 * Light basemap for every Leaflet map in the app.
 *
 * CARTO stopped serving keyless raster tiles in September 2026 (keyless
 * requests now get an "API KEY REQUIRED" watermark tile). We now render the
 * OpenFreeMap "Positron" vector style (the same light look as CARTO light_all)
 * through MapLibre GL inside Leaflet. OpenFreeMap's public instance needs no
 * key, account or cookies and allows commercial use: https://openfreemap.org
 *
 * If the device has no WebGL2 (MapLibre 6 needs it), or the vector map fails
 * to start, fall back to standard OpenStreetMap raster tiles so the map still
 * has a background.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/**
 * maplibre-gl-leaflet 0.1.4 assumes MapLibre always initialised and the layer
 * is still attached when its deferred callbacks run. Harden both so a failed
 * WebGL start can be cleaned up and closing a modal mid-animation is safe.
 */
const SafeMaplibreGL = MaplibreGL.extend({
  onRemove(map) {
    if (this._pendingFrame) {
      L.Util.cancelAnimFrame(this._pendingFrame);
      this._pendingFrame = null;
    }
    if (map._proxy && map.options.zoomAnimation) {
      L.DomEvent.off(map._proxy, L.DomUtil.TRANSITION_END, this._transitionEnd, this);
    }
    if (this._container?.parentNode) this._container.parentNode.removeChild(this._container);
    if (this._glMap) this._glMap.remove();
    this._glMap = null;
  },

  _zoomEnd() {
    if (!this._map || !this._glMap) return;
    MaplibreGL.prototype._zoomEnd.call(this);
  },

  _transitionEnd() {
    if (this._pendingFrame) L.Util.cancelAnimFrame(this._pendingFrame);
    this._pendingFrame = L.Util.requestAnimFrame(() => {
      this._pendingFrame = null;
      if (!this._map || !this._glMap) return;
      const zoom = this._map.getZoom();
      const center = this._map.getCenter();
      const offset = this._map.latLngToContainerPoint(this._map.getBounds().getNorthWest());
      this._resizeContainer();
      L.DomUtil.setTransform(this._glMap._actualCanvas, offset, 1);
      this._glMap.once('moveend', () => this._zoomEnd());
      this._glMap.jumpTo({ center, zoom: zoom - 1 });
    });
  },
});

let webgl2Support;
function hasWebGL2() {
  if (webgl2Support !== undefined) return webgl2Support;
  try {
    webgl2Support = Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    webgl2Support = false;
  }
  return webgl2Support;
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
    let disposed = false;

    const switchToRaster = (reason, error) => {
      if (disposed) return;
      if (reason) console.warn(`Vector basemap ${reason}, using raster fallback`, error);
      if (layer && map.hasLayer(layer)) {
        try {
          map.removeLayer(layer);
        } catch (removeError) {
          console.warn('Failed to remove vector basemap', removeError);
        }
      }
      layer = createRasterFallback().addTo(map);
    };

    if (!hasWebGL2()) {
      switchToRaster();
    } else {
      layer = new SafeMaplibreGL({
        style: BASEMAP_STYLE_URL,
        attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
      });
      try {
        layer.addTo(map);
        // Style/worker failures surface asynchronously as 'error' events.
        // Before the first 'load' they mean a blank map, so switch to raster.
        const glMap = layer.getMaplibreMap();
        let loaded = false;
        glMap.once('load', () => { loaded = true; });
        glMap.on('error', (event) => {
          if (!loaded) switchToRaster('failed to load', event?.error);
        });
      } catch (error) {
        // MapLibre throws while creating its WebGL context if the context is
        // lost or blocked.
        switchToRaster('failed to start', error);
      }
    }

    return () => {
      disposed = true;
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [map]);

  return null;
}

export default BaseMapLayer;
