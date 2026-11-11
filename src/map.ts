import * as mapboxgl from 'mapbox-gl/esm'
import type { ExpressionSpecification, FilterSpecification, TargetFeature } from 'mapbox-gl/esm'
import 'mapbox-gl/mapbox-gl.css'
import { PMTiles } from 'pmtiles'
import { type Period, PALETTE, classLabel, colorExpression, soundExpression } from './sound'
import { centroid, distanceM, inside } from './geo'

// PMTiles are read natively by Mapbox GL JS, but only from an absolute URL
const DATA = new URL(`${import.meta.env.BASE_URL}data/`, location.href).href
const BUILDINGS = { featuresetId: 'buildings', importId: 'basemap' }
const ACCENT = '#F06965' // time2map pin
// Mapbox and Catastro outlines differ by a metre or two: a part whose centroid is this close to a home belongs to it
const HOME_SNAP_M = Number(import.meta.env.VITE_HOME_SNAP_M ?? 2)
const CELL = 2000 // home index cells per degree, ~40 × 55 m in Barcelona: wider than HOME_SNAP_M
const NOISE_Z = 15 // deepest zoom of the noise tiles
const CLOSE_Z = 16.5 // close enough to pick a home: a click further out zooms in first

// dim: buildings without facade levels, drawn in Standard's highlight colour
const THEME = {
  day: { text: '#0a0a0a', halo: 'rgba(255,255,255,0.92)', stroke: '#ffffff', dim: '#e8e8ea' },
  night: { text: '#fafafa', halo: 'rgba(10,10,14,0.92)', stroke: '#0a0a0a', dim: '#2b2c36' },
}

type Footprint = GeoJSON.Polygon | GeoJSON.MultiPolygon
type Home = { ref: string; footprint: Footprint }
const polygon = (g: GeoJSON.Geometry): g is Footprint => g.type === 'Polygon' || g.type === 'MultiPolygon'

const RGB = PALETTE.colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)))
const noiseTiles = { day: new PMTiles(`${DATA}noise-day.pmtiles`), night: new PMTiles(`${DATA}noise-night.pmtiles`) }
// ponytail: never evicted, 256 KB a tile; LRU if hovering across the whole city matters
const decoded = new Map<string, Promise<ImageData | undefined>>()

function pixels(p: Period, x: number, y: number) {
  const key = `${p}/${x}/${y}`
  if (!decoded.has(key)) {
    decoded.set(key, noiseTiles[p].getZxy(NOISE_Z, x, y).then(async (t) => {
      if (!t) return undefined
      const img = await createImageBitmap(new Blob([t.data]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      const ctx = new OffscreenCanvas(img.width, img.height).getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, img.width, img.height)
    }).catch(() => undefined))
  }
  return decoded.get(key)!
}

/** Colour class of the noise layer at a point (nearest palette colour: the canvas rounds the alpha), or -1 where it has none. */
async function noiseClassAt(p: Period, at: mapboxgl.LngLat): Promise<number> {
  const n = 2 ** NOISE_Z
  const m = mapboxgl.MercatorCoordinate.fromLngLat(at)
  const [x, y] = [m.x * n, m.y * n]
  const img = await pixels(p, Math.floor(x), Math.floor(y))
  if (!img) return -1
  const d = img.data
  const i = (Math.floor((y % 1) * img.height) * img.width + Math.floor((x % 1) * img.width)) * 4
  if (d[i + 3] === 0) return -1
  const dist = (k: number) => (RGB[k][0] - d[i]) ** 2 + (RGB[k][1] - d[i + 1]) ** 2 + (RGB[k][2] - d[i + 2]) ** 2
  return RGB.reduce((best, _, k) => (dist(k) < dist(best) ? k : best), 0)
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
  /** Homes of the loaded facade tiles by index cell, rebuilt after new tiles load. */
  let homes = new Map<string, Home[]>()
  let homesStale = true
  /** Building parts drawn dimmed, and those known to have a home: never dimmed again, so the passes settle. */
  const dimmed = new Map<string | number, TargetFeature>()
  const lit = new Set<string | number>()

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
        colorBuildingHighlight: THEME[state.period].dim,
      },
    },
    center: [2.161154, 41.393798],
    zoom: 18.04,
    hash: true,
    attributionControl: false,
  })
  map.addControl(new mapboxgl.AttributionControl({
    compact: true,
    customAttribution: ['Noise: Ajuntament de Barcelona, 2022', 'Facades: time2map, Catastro'],
  }))
  map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')
  const tip = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, className: 'noise-tip', offset: 14, maxWidth: 'none' })

  const selection = (): FilterSpecification => ['==', ['get', 'b'], ref]
  const ready = () => !!map.getLayer('facades')

  function apply() {
    if (!ready()) return
    const p = state.period
    const t = THEME[p]
    map.setConfigProperty('basemap', 'lightPreset', p)
    map.setConfigProperty('basemap', 'colorBuildingHighlight', t.dim)
    tip.remove()
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

  map.on('sourcedata', (e) => { if (e.sourceId === 'facades' && e.tile) homesStale = true })
  function indexHomes() {
    if (!homesStale) return
    homesStale = false
    homes = new Map()
    for (const h of map.querySourceFeatures('facades', { sourceLayer: 'h' })) {
      if (!polygon(h.geometry)) continue
      const home = { ref: String(h.properties?.b), footprint: h.geometry }
      const ring = h.geometry.type === 'Polygon' ? h.geometry.coordinates[0] : h.geometry.coordinates.flatMap((p) => p[0])
      const xs = ring.map(([x]) => Math.floor(x * CELL))
      const ys = ring.map(([, y]) => Math.floor(y * CELL))
      for (let i = Math.min(...xs); i <= Math.max(...xs); i++) {
        for (let j = Math.min(...ys); j <= Math.max(...ys); j++) {
          const key = `${i}/${j}`
          if (!homes.has(key)) homes.set(key, [])
          homes.get(key)!.push(home)
        }
      }
    }
  }

  /** Mapbox Standard splits a building into parts by height: a part belongs to the home holding its centroid, else to the nearest within HOME_SNAP_M. */
  function homeOf(part: TargetFeature): Home | undefined {
    if (!polygon(part.geometry)) return undefined
    indexHomes()
    const c = centroid(part.geometry)
    const [i, j] = c.map((v) => Math.floor(v * CELL))
    const near = [-1, 0, 1].flatMap((a) => [-1, 0, 1].flatMap((b) => homes.get(`${i + a}/${j + b}`) ?? []))
    const d = (h: Home) => distanceM(c, h.footprint)
    return near.find((h) => inside(c, h.footprint)) ?? near.filter((h) => d(h) < HOME_SNAP_M).sort((a, b) => d(a) - d(b))[0]
  }

  /**
   * Close in, dim the building parts without a home with facade levels; further out, where a click zooms in first, dim none.
   * Feature states repaint and the repaint ends in another idle, so they change only for parts not seen before.
   * ponytail: ~100 ms a pass at z16.5 (queries every rendered part); a tile-level cache if it stutters
   */
  function dimUnknown() {
    if (map.getZoom() < CLOSE_Z) {
      for (const part of dimmed.values()) map.setFeatureState(part, { highlight: false })
      dimmed.clear()
      return
    }
    for (const part of map.queryRenderedFeatures({ target: BUILDINGS })) {
      const id = part.id
      if (id === undefined || lit.has(id)) continue
      if (homeOf(part)) { // a tile-split part has a home if any piece has
        lit.add(id)
        if (dimmed.delete(id)) map.setFeatureState(part, { highlight: false })
      } else if (!dimmed.has(id)) {
        dimmed.set(id, part)
        map.setFeatureState(part, { highlight: true })
      }
    }
  }
  map.on('idle', dimUnknown)

  function select(home?: Home, part?: TargetFeature, at?: mapboxgl.LngLat) {
    for (const f of selected) map.setFeatureState(f, { select: false })
    ref = home?.ref ?? ''
    selected = home
      ? map.queryRenderedFeatures({ target: BUILDINGS })
        .filter((f) => (f.id !== undefined && f.id === part?.id) || (polygon(f.geometry) && inside(centroid(f.geometry), home.footprint)))
      : []
    if (home && at && map.getZoom() < CLOSE_Z) {
      // on phones the panel is a bottom sheet: keep the home above it
      map.easeTo({ center: at, zoom: 17, offset: innerWidth < 1024 ? [0, -innerHeight * 0.15] : [0, 0] })
    }
    for (const f of selected) map.setFeatureState(f, { select: true })
    map.setFilter('facades', selection())
    map.setFilter('facade-labels', selection())
  }

  map.addInteraction('select-building', {
    type: 'click', target: BUILDINGS,
    handler: (e) => {
      const home = e.feature && homeOf(e.feature)
      if (!home) return false // no facade levels: a click on the map
      select(home, e.feature, e.lngLat)
    },
  })
  map.addInteraction('deselect', {
    type: 'click',
    handler: (e) => {
      select()
      // Standard buildings are clickable from z15: zoom in towards the click first
      if (map.getZoom() < 15) map.easeTo({ center: e.lngLat, zoom: 16.5 })
    },
  })
  // a pointer over homes with facade levels, else the noise class under the cursor; a counter drops answers that arrive after a newer move
  let hover = 0
  map.on('mousemove', async (e) => {
    const n = ++hover
    const part = map.queryRenderedFeatures(e.point, { target: BUILDINGS })[0]
    map.getCanvas().style.cursor = part && homeOf(part) ? 'pointer' : ''
    const k = state.noise && !part ? await noiseClassAt(state.period, e.lngLat) : -1
    if (n !== hover) return
    if (k < 0) return void tip.remove()
    const [range, like] = classLabel(k)
    tip.setLngLat(e.lngLat).setHTML(`<b>${range}</b><br>${like}`)
    if (!tip.isOpen()) tip.addTo(map)
  })
  map.on('mouseout', () => { hover++; tip.remove() })

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select() }
  addEventListener('keydown', onKey)

  return {
    setPeriod(p) { state.period = p; apply() },
    setNoise(on) { state.noise = on; apply() },
    remove() { removeEventListener('keydown', onKey); map.remove() },
  }
}
