import { NORMS, PALETTE, type Period } from '@/sound'

const ZONES: Record<Period, [string, string, string]> = {
  day: ['OK', 'annoying (WHO)', 'over legal limit'],
  night: ['OK', 'disturbs sleep (WHO)', 'over legal limit'],
}

/** One classed scale for day and night; under it, what the levels mean for that period (the norms sit on class breaks). */
export function Legend({ period }: { period: Period }) {
  const { breaks, colors } = PALETTE
  const edge = (k: number) => (k / colors.length) * 100
  const at = (db: number) => edge(breaks.indexOf(db) + 1)
  const n = NORMS[period]
  const when = period === 'day' ? 'by day, 7–21 h' : 'at night, 23–7 h'
  const zones = [[0, at(n.who)], [at(n.who), at(n.law)], [at(n.law), 100]].map(([from, to], i) => ({ from, to, text: ZONES[period][i] }))

  return (
    <div
      role="img"
      aria-label={`Average noise ${when}, 7 classes from under ${breaks[0]} to over ${breaks[breaks.length - 1]} dB. Under ${n.who} dB ${zones[0].text}, ${n.who} to ${n.law} dB ${zones[1].text}, over ${n.law} dB ${zones[2].text}.`}
    >
      <p className="mb-2 text-xs text-muted-foreground">Average noise {when}</p>
      <div className="flex h-2 gap-0.5">
        {colors.map((c) => (
          <span key={c} className="flex-1 first:rounded-l-full last:rounded-r-full" style={{ background: c }} />
        ))}
      </div>
      <div className="relative mt-1 h-3.5 text-[10px] text-muted-foreground tabular-nums">
        {breaks.map((b, i) => (
          <span key={b} className="absolute -translate-x-1/2" style={{ left: `${edge(i + 1)}%` }}>{b}</span>
        ))}
      </div>
      <div className="relative mt-0.5 h-8 text-[10px] leading-tight">
        {zones.map(({ from, to, text }) => (
          <div key={text} className="absolute top-0 px-px" style={{ left: `${from}%`, width: `${to - from}%` }}>
            <div className="h-1.5 rounded-b-[3px] border-x border-b border-foreground/35" />
            <div className="mt-0.5 text-center">{text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
