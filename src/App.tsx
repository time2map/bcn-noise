import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Moon, Sun } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Legend } from '@/components/Legend'
import { createMap, type NoiseMap } from '@/map'
import type { Period } from '@/sound'
import logo from '@/assets/time2map-logo.svg?raw'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export default function App() {
  const [period, setPeriod] = useState<Period>('night')
  const [noise, setNoise] = useState(true)
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<NoiseMap>(null)

  useEffect(() => {
    if (!TOKEN || !container.current) return
    map.current = createMap(container.current, TOKEN, { period, noise })
    return () => map.current?.remove()
    // the map is created once; later changes go through setPeriod / setNoise
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', period === 'night')
    map.current?.setPeriod(period)
  }, [period])

  useEffect(() => map.current?.setNoise(noise), [noise])

  return (
    <>
      {/* inline: mapbox-gl.css (unlayered) sets .mapboxgl-map { position: relative } over Tailwind utilities */}
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />

      {!TOKEN && (
        <p className="glass absolute top-1/2 left-1/2 -translate-1/2 rounded-2xl px-5 py-4 text-sm">
          Set VITE_MAPBOX_TOKEN in .env.local
        </p>
      )}

      <ToggleGroup
        type="single"
        value={period}
        onValueChange={(v) => v && setPeriod(v as Period)}
        aria-label="Time of day"
        spacing={1}
        className="glass absolute top-4 left-1/2 -translate-x-1/2 rounded-full p-1 max-lg:top-3 max-sm:left-3 max-sm:translate-x-0"
      >
        {([['day', Sun, 'Day'], ['night', Moon, 'Night']] as const).map(([value, Icon, text]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="rounded-full px-3.5 data-[state=on]:bg-background/80 data-[state=on]:shadow-sm dark:data-[state=on]:bg-white/15"
          >
            <Icon /> {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <a
        href="https://time2map.com/contact-us"
        target="_blank"
        rel="noopener"
        className="glass absolute top-4 right-4 flex h-10.5 items-center gap-1 rounded-full px-4 text-sm font-medium whitespace-nowrap max-lg:top-3 max-lg:right-3 [&>svg]:size-4 [&>svg]:transition-transform hover:[&>svg]:translate-x-0.5 hover:[&>svg]:-translate-y-0.5"
      >
        Contact us <ArrowUpRight />
      </a>

      <aside className="glass absolute top-4 left-4 grid w-max gap-4 rounded-[20px] p-[18px] lg:[zoom:1.4] max-lg:top-auto max-lg:right-3 max-lg:bottom-12 max-lg:left-3 max-lg:w-auto max-lg:gap-3 max-lg:p-4">
        <header className="flex items-center gap-2">
          <a href="https://time2map.com" target="_blank" rel="noopener" title="Visit time2map.com" aria-label="time2map">
            <span className="block [&>svg]:block [&>svg]:h-[22px] [&>svg]:w-auto" dangerouslySetInnerHTML={{ __html: logo }} />
          </a>
          <h1 className="text-[15px] leading-none font-semibold tracking-tight whitespace-nowrap">
            Noise in Barcelona<span className="sr-only"> by day and at night</span>
          </h1>
        </header>
        <div className="flex items-center justify-between">
          <Label htmlFor="noise-layer">Noise layer</Label>
          <Switch id="noise-layer" checked={noise} onCheckedChange={setNoise} />
        </div>
        <Legend period={period} />
      </aside>
    </>
  )
}
