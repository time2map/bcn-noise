import { describe, expect, it } from 'vitest'
import { classLabel, colorExpression, soundLike } from './sound'
import { centroid, distanceM, inside } from './geo'

describe('soundLike', () => {
  it('compares a level with an everyday sound', () => {
    expect(soundLike(32)).toBe('a quiet forest')
    expect(soundLike(40)).toBe('a library')
    expect(soundLike(72)).toBe('a vacuum cleaner')
    expect(soundLike(95)).toBe('a food blender')
  })
})

describe('classLabel', () => {
  it('names the dB range of a colour class and a sound as loud', () => {
    expect(classLabel(0)).toEqual(['under 45 dB', 'like a library'])
    expect(classLabel(3)).toEqual(['55–60 dB', 'like a dishwasher'])
    expect(classLabel(6)).toEqual(['over 70 dB', 'like a vacuum cleaner'])
  })
})

describe('inside', () => {
  const square: GeoJSON.Polygon = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  }
  it('finds points in a polygon with a hole', () => {
    expect(inside([1, 1], square)).toBe(true)
    expect(inside([5, 5], square)).toBe(false)
    expect(inside([11, 5], square)).toBe(false)
    expect(inside([1, 1], { type: 'MultiPolygon', coordinates: [[[[20, 20], [21, 20], [21, 21], [20, 20]]], square.coordinates] })).toBe(true)
  })
})

describe('centroid', () => {
  it('finds the area centroid of a polygon', () => {
    expect(centroid({ type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] })).toEqual([2, 1])
    // an L shape: the centroid is pulled towards the long arm
    const [x, y] = centroid({ type: 'Polygon', coordinates: [[[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6], [0, 0]]] })
    expect(x).toBeCloseTo(2.2)
    expect(y).toBeCloseTo(2.2)
  })
})

describe('colorExpression', () => {
  it('steps through the 7 RdYlBu classes, blue for quiet', () => {
    expect(colorExpression(['get', 'ln'])).toEqual(['step', ['get', 'ln'],
      '#4575b4', 45, '#91bfdb', 50, '#e0f3f8', 55, '#ffffbf', 60, '#fee090', 65, '#fc8d59', 70, '#d73027'])
  })
})

describe('distanceM', () => {
  it('measures metres to the nearest edge', () => {
    // a 0.001° square at the equator: ~111 m a side; a point 0.0001° east of it is ~11 m away
    const sq: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] }
    expect(distanceM([0.0011, 0.0005], sq)).toBeCloseTo(11.13, 1)
    expect(distanceM([0.0005, 0.0005], sq)).toBeCloseTo(55.66, 1)
  })
})
