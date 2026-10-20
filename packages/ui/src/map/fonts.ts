/**
 * Font stack for our own map labels: one the basemap's `glyphs` endpoint serves (the positron style uses Noto Sans).
 * A symbol layer without `text-font` asks for MapLibre's default "Open Sans Regular,Arial Unicode MS Regular", which
 * openfreemap answers 404 (R14-M1: a console 404 on every ferry map picker, from the cluster counts).
 */
export const MAP_TEXT_FONT = ['Noto Sans Regular']
