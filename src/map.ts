import * as mapboxgl from 'mapbox-gl/esm'
import type { ExpressionSpecification, FilterSpecification, TargetFeature } from 'mapbox-gl/esm'
import 'mapbox-gl/mapbox-gl.css'
import { type Period, colorExpression, soundExpression } from './sound'
import { centroid, distanceM, inside } from './geo'

// PMTiles are read natively by Mapbox GL JS, but only from an absolute URL
const DATA = new URL(`${import.meta.env.BASE_URL}data/`, location.href).href
const BUILDINGS = { featuresetId: 'buildings', importId: 'basemap' }
const ACCENT = '#F06965' // time2map pin
// Mapbox and Catastro outlines differ by a metre or two: a part whose centroid is this close to a home belongs to it
const HOME_SNAP_M = Number(import.meta.env.VITE_HOME_SNAP_M ?? 2)

const THEME = {
  day: { text: '#0a0a0a', halo: 'rgba(255,255,255,0.92)', stroke: '#ffffff' },
  night: { text: '#fafafa', halo: 'rgba(10,10,14,0.92)', stroke: '#0a0a0a' },
}

const level = (p: Period): ExpressionSpecification => ['get', p === 'day' ? 'ld' : 'ln']

function textField(p: Period): ExpressionSpecification {
  return ['format',
    ['concat', ['to-string', level(p)], ' dB'], { 'font-scale': 0.8, 'text-font': ['literal', ['DIN Pro Bold', 'Arial Unicode MS Bold']] },
    '\n', {},
    ['concat', 'like ', soundExpression(level(p))], { 'font-scale': 1 }]
}

export interface NoiseMap {
  setPeriod(p: Period): void
  setNoise(on: boolean): void
  remove(): void
}

export function createMap(container: HTMLElement, accessToken: string, initial: { period: Period; noise: boolean }): NoiseMap {
  const state = { ...initial }
  /** Catastro ref of the selected home, and the Mapbox building parts drawn for it. */
  let ref = ''
  let selected: TargetFeature[] = []

  const map = new mapboxgl.Map({
    container,
    accessToken,
    style: 'mapbox://styles/mapbox/standard',
    config: {
      basemap: {
        lightPreset: state.period,
        showPointOfInterestLabels: false,
        showTransitLabels: false,
        showRoadLabels: false,
        showLandmarkIcons: false,
        showLandmarkIconLabels: false,
        colorBuildingSelect: ACCENT,
      },
    },
    center: [2.1665, 41.3925],
    zoom: 15.5,
    pitch: 55,
    bearing: -44,
    hash: true,
    attributionControl: false,
  })
  map.addControl(new mapboxgl.AttributionControl({
    compact: true,
    customAttribution: ['Noise: Ajuntament de Barcelona, 2022', 'Facades: time2map, Catastro'],
  }))
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')

  const selection = (): FilterSpecification => ['==', ['get', 'b'], ref]
  const ready = () => !!map.getLayer('facades')

  function apply() {
    if (!ready()) return
    const p = state.period
    const t = THEME[p]
    map.setConfigProperty('basemap', 'lightPreset', p)
    for (const q of ['day', 'night'] as const) map.setLayoutProperty(`noise-${q}`, 'visibility', state.noise && q === p ? 'visible' : 'none')
    map.setPaintProperty('facades', 'circle-color', colorExpression(level(p)))
    map.setPaintProperty('facades', 'circle-stroke-color', t.stroke)
    map.setLayoutProperty('facade-labels', 'text-field', textField(p))
    map.setPaintProperty('facade-labels', 'text-color', t.text)
    map.setPaintProperty('facade-labels', 'text-halo-color', t.halo)
  }

  map.on('style.load', () => {
    for (const p of ['day', 'night'] as const) {
      map.addSource(`noise-${p}`, { type: 'raster', url: `${DATA}noise-${p}.pmtiles`, tileSize: 256 })
      map.addLayer({
        id: `noise-${p}`, type: 'raster', source: `noise-${p}`, slot: 'middle',
        layout: { visibility: 'none' },
        paint: { 'raster-emissive-strength': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
      })
    }
    map.addSource('facades', { type: 'vector', url: `${DATA}facades.pmtiles` })
    map.addLayer({
      id: 'facades', type: 'circle', source: 'facades', 'source-layer': 'f', slot: 'top', filter: selection(),
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 4, 18, 9],
        'circle-stroke-width': 2,
        'circle-emissive-strength': 1,
      },
    })
    map.addLayer({
      id: 'facade-labels', type: 'symbol', source: 'facades', 'source-layer': 'f', slot: 'top', filter: selection(),
      layout: {
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 14,
        'text-max-width': 16,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 1,
        'text-justify': 'auto',
      },
      paint: { 'text-halo-width': 1.6 },
    })
    apply()
  })

  const polygon = (g: GeoJSON.Geometry): g is GeoJSON.Polygon | GeoJSON.MultiPolygon => g.type === 'Polygon' || g.type === 'MultiPolygon'

  /** Mapbox Standard splits a building into parts by height: a part belongs to the Catastro home holding its centroid. */
  function select(feature: TargetFeature | null, at?: mapboxgl.LngLat) {
    for (const f of selected) map.setFeatureState(f, { select: false })
    selected = feature ? [feature] : []
    ref = ''
    if (feature && polygon(feature.geometry)) {
      const c = centroid(feature.geometry)
      const homes = map.querySourceFeatures('facades', { sourceLayer: 'h' }).filter((h) => polygon(h.geometry))
      const near = (h: (typeof homes)[number]) => distanceM(c, h.geometry as GeoJSON.Polygon)
      const home = homes.find((h) => inside(c, h.geometry as GeoJSON.Polygon))
        ?? homes.filter((h) => near(h) < HOME_SNAP_M).sort((a, b) => near(a) - near(b))[0]
      if (home && polygon(home.geometry)) {
        const footprint = home.geometry
        ref = String(home.properties?.b)
        selected = map.queryRenderedFeatures({ target: BUILDINGS })
          .filter((f) => (f.id !== undefined && f.id === feature.id) || (polygon(f.geometry) && inside(centroid(f.geometry), footprint)))
      }
      if (at && map.getZoom() < 16.5) {
        // on phones the panel is a bottom sheet: keep the home above it
        map.easeTo({ center: at, zoom: 17, offset: innerWidth < 1024 ? [0, -innerHeight * 0.15] : [0, 0] })
      }
    }
    for (const f of selected) map.setFeatureState(f, { select: true })
    map.setFilter('facades', selection())
    map.setFilter('facade-labels', selection())
  }

  map.addInteraction('select-building', {
    type: 'click', target: BUILDINGS,
    handler: (e) => { select(e.feature ?? null, e.lngLat) },
  })
  map.addInteraction('deselect', {
    type: 'click',
    handler: (e) => {
      select(null)
      // Standard buildings are clickable from z15: zoom in towards the click first
      if (map.getZoom() < 15) map.easeTo({ center: e.lngLat, zoom: 16.5 })
    },
  })
  map.addInteraction('building-cursor-on', { type: 'mouseenter', target: BUILDINGS, handler: () => { map.getCanvas().style.cursor = 'pointer' } })
  map.addInteraction('building-cursor-off', { type: 'mouseleave', target: BUILDINGS, handler: () => { map.getCanvas().style.cursor = '' } })
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null) }
  addEventListener('keydown', onKey)

  return {
    setPeriod(p) { state.period = p; apply() },
    setNoise(on) { state.noise = on; apply() },
    remove() { removeEventListener('keydown', onKey); map.remove() },
  }
}
