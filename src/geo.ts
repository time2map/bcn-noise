/** Point in polygon (even–odd over all rings, so holes count). */
export function inside([x, y]: number[], g: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polygons.some((rings) => {
    let c = false
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
      }
    }
    return c
  })
}

/** Area centroid of the (first) outer ring. */
export function centroid(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
  let a = 0
  let x = 0
  let y = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += f
    x += (ring[j][0] + ring[i][0]) * f
    y += (ring[j][1] + ring[i][1]) * f
  }
  return a ? [x / (3 * a), y / (3 * a)] : [ring[0][0], ring[0][1]]
}

/** Distance in metres from a point to the nearest polygon edge (equirectangular, fine at building scale). */
export function distanceM([x, y]: number[], g: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const ky = 111320
  const kx = ky * Math.cos((y * Math.PI) / 180)
  let d = Infinity
  for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - x) * kx
        const ay = (ring[i - 1][1] - y) * ky
        const dx = (ring[i][0] - x) * kx - ax
        const dy = (ring[i][1] - y) * ky - ay
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)))
        d = Math.min(d, Math.hypot(ax + t * dx, ay + t * dy))
      }
    }
  }
  return d
}
