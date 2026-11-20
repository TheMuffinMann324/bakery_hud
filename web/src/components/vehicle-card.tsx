import { useState, type ReactNode } from "react"
import type { VehicleCondition } from "@/nui"

// The gauge's track: 280 degrees of a circle, open at the bottom.
const RADIUS = 9.6
const ARC = (280 / 360) * 2 * Math.PI * RADIUS
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const glyphs = {
  engine: "M7 8h2.2V6.6h5.6V8H17l1.6 2H20v5h-1.4l-1.6 2H9.4L7 14.6H5.6v1.6H4V9.8h1.6v1.6H7Z",
  fuel: "M6 5.4A1.4 1.4 0 0 1 7.4 4h5.2A1.4 1.4 0 0 1 14 5.4V19H6Zm1.8 1.4v3.6h4.4V6.8ZM14 9h1.2a1.6 1.6 0 0 1 1.6 1.6v4.6a.7.7 0 0 0 1.4 0V9.3l-1.9-1.9 1-1 2.3 2.3v6.5a2.1 2.1 0 0 1-4.2 0v-4.6H14Z",
}

function Glyph({ d }: { d: string }) {
  return <path fill="currentColor" d={d} transform="translate(5.4 5.4) scale(.55)" />
}

function Gauge({ label, amount, tone, children }: {
  label: string
  amount?: number
  tone: string
  children: ReactNode
}) {
  const filled = amount == null ? ARC : (ARC * Math.max(0, Math.min(100, amount))) / 100
  return (
    <svg
      className={`vehicle-gauge ${tone}`}
      viewBox="0 0 24 24"
      role={amount == null ? "img" : "meter"}
      aria-label={label}
      aria-valuemin={amount == null ? undefined : 0}
      aria-valuemax={amount == null ? undefined : 100}
      aria-valuenow={amount}
    >
      <circle cx="12" cy="12" r="11.4" fill="#17151f" />
      <g transform="rotate(130 12 12)" fill="none" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="12" cy="12" r={RADIUS} stroke="#ffffff26" strokeDasharray={`${ARC} ${CIRCUMFERENCE}`} />
        {filled > 0 && (
          <circle cx="12" cy="12" r={RADIUS} stroke="currentColor" strokeDasharray={`${filled} ${CIRCUMFERENCE}`} />
        )}
      </g>
      {children}
    </svg>
  )
}

function ManufacturerMark({ make, emblem }: { make: string; emblem?: string }) {
  const [loaded, setLoaded] = useState(false)
  const monogram = make.trim().split(/\s+/).map(word => word[0]).slice(0, 3).join("")
  return (
    <div className="vehicle-mark" aria-hidden="true">
      {!loaded && <span>{monogram}</span>}
      {emblem && (
        <img alt="" src={`https://nui-img/mpcarhud/${emblem}`} hidden={!loaded} onLoad={() => setLoaded(true)} />
      )}
    </div>
  )
}

export function VehicleCard({ condition }: { condition: VehicleCondition }) {
  const { make, emblem, name, engine, lowEngine, fuel, lowFuel, buckled } = condition
  const beltLabel = buckled == null ? "Seatbelt status unavailable"
    : buckled ? "Seatbelt fastened" : "Seatbelt unfastened"
  const beltTone = buckled == null ? "vehicle-neutral" : buckled ? "vehicle-engine" : "vehicle-alert"
  return (
    <section className="vehicle-card" aria-label="Vehicle condition">
      <header className="vehicle-header">
        {make && <ManufacturerMark key={emblem ?? make} make={make} emblem={emblem} />}
        <div className="vehicle-title">
          {make && <span>{make}</span>}
          <strong>{name}</strong>
        </div>
      </header>
      <div className="vehicle-indicators">
        <Gauge label="Engine condition" amount={engine} tone={lowEngine ? "vehicle-alert" : "vehicle-engine"}>
          <Glyph d={glyphs.engine} />
        </Gauge>
        <Gauge label="Fuel" amount={fuel} tone={lowFuel ? "vehicle-warn" : "vehicle-fuel"}>
          <Glyph d={glyphs.fuel} />
        </Gauge>
        <Gauge label={beltLabel} tone={beltTone}>
          <circle cx="11.5" cy="7.9" r="1.35" fill="currentColor" />
          <path d="M8.6 15.9v-3a2.9 2.9 0 0 1 4.5-2.4m1.3 2.4v3m-5.8 0h5.8m-5.8 0 6.6-5.6"
            fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        </Gauge>
      </div>
    </section>
  )
}
