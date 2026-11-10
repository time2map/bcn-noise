import type { ExpressionSpecification } from 'mapbox-gl/esm'
import palette from './palette.json'

/** Day = Ld (7–21 h), night = Ln (23–7 h) of the Barcelona Strategic Noise Map 2022. */
export type Period = 'day' | 'night'

/** ColorBrewer RdYlBu, 7 classes, blue = quiet. The same for day and night so the two compare. */
export const PALETTE: { breaks: number[]; colors: string[]; alpha: number } = palette

/** An everyday sound about as loud, from this many dB(A) up. Rough equivalents: the map is a long-term average. */
export const SOUNDS: [number, string][] = [
  [0, 'a quiet forest'],
  [40, 'a library'],
  [45, 'a humming fridge'],
  [50, 'steady rain'],
  [55, 'a dishwasher'],
  [60, 'a conversation'],
  [65, 'a busy restaurant'],
  [70, 'a vacuum cleaner'],
  [75, 'heavy traffic'],
  [80, 'a food blender'],
]

/** Outdoor level at the facade. who: WHO guideline; law: Spain's acoustic quality target for homes (RD 1367/2007). */
export const NORMS: Record<Period, { who: number; law: number }> = {
  day: { who: 55, law: 65 }, // WHO Guidelines for Community Noise 1999 (serious annoyance, daytime)
  night: { who: 45, law: 55 }, // WHO Environmental Noise Guidelines 2018 (road traffic, Lnight)
}

export function soundLike(db: number): string {
  return SOUNDS.findLast(([from]) => db >= from)![1]
}

export function colorExpression(input: ExpressionSpecification): ExpressionSpecification {
  return ['step', input, PALETTE.colors[0], ...PALETTE.breaks.flatMap((b, i) => [b, PALETTE.colors[i + 1]])] as ExpressionSpecification
}

export function soundExpression(input: ExpressionSpecification): ExpressionSpecification {
  return ['step', input, SOUNDS[0][1], ...SOUNDS.slice(1).flat()] as ExpressionSpecification
}
