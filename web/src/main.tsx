import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createRoot } from "react-dom/client"
import {
  BankBadge, BoltIcon, CashBadge, DropIcon, FoodIcon, HeartIcon, LungsIcon, PulseIcon, ShieldIcon,
} from "@/components/icons"
import { Map3DCanvas } from "@/components/map3d-canvas"
import { HudSettings, type SettingsTab } from "@/components/hud-settings"
import { TurnPrompt } from "@/components/turn-prompt"
import { VehicleCard } from "@/components/vehicle-card"
import { nui, STATUS_LABELS, type ElementLayout, type Frame, type HudConfig, type HudLayout, type NuiMessage, type Objective, type Radar, type StatusBar } from "@/nui"
import "./hud.css"

const statusIcons = {
  health: HeartIcon, stamina: BoltIcon, armor: ShieldIcon, hunger: FoodIcon,
  thirst: DropIcon, oxygen: LungsIcon, stress: PulseIcon,
}

// A HUD element moved, sized or hidden in the settings. `origin` is the
// corner it grows from while it is still in its default place.
function placement(layout: ElementLayout | undefined, origin: string, editing: boolean) {
  const style: CSSProperties = {}
  if (layout?.x != null && layout.y != null) {
    Object.assign(style, { left: `${layout.x * 100}%`, top: `${layout.y * 100}%`, right: "auto", bottom: "auto" })
    origin = "top left"
  }
  if (layout?.scale != null && layout.scale !== 1) style.transform = `scale(${layout.scale})`
  style.transformOrigin = origin
  const off = layout?.visible === false
  return { style, hidden: off && !editing, className: off && editing ? " hud-dimmed" : "" }
}

// How long a bar's icon stays ringed after its value moves.
const ACTIVE_MS = 1600

const moneyFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

function Vital({ name, value, scale, active, dimmed }: {
  name: StatusBar; value: number; scale: number; active: boolean; dimmed: boolean
}) {
  const Icon = statusIcons[name]
  return (
    <div data-status-bar={name} style={{ zoom: scale }}
      className={`vital vital-${name}${active ? " vital-active" : ""}${dimmed ? " hud-dimmed" : ""}`}>
      <span className="vital-icon" aria-hidden="true"><Icon /></span>
      <div className="vital-track" role="meter" aria-label={STATUS_LABELS[name]} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={value} style={{ "--charge": `${value}%` } as CSSProperties}>
        <div className="vital-fill" />
      </div>
    </div>
  )
}

function Balance({ kind, amount, currency }: { kind: "Bank" | "Cash"; amount: number; currency: string }) {
  const Badge = kind === "Bank" ? BankBadge : CashBadge
  return (
    <div className={`balance balance-${kind.toLowerCase()}`}>
      <span className="sr-only">{kind} </span>
      <span className="balance-value">{amount < 0 ? "−" : ""}{currency}{moneyFormat.format(Math.abs(amount))}</span>
      <Badge className="balance-icon" />
    </div>
  )
}

// Bars whose value changed within ACTIVE_MS, so their icon can show a ring.
function useActiveBars(values: (number | false)[]) {
  const previous = useRef<(number | false)[]>([])
  const changedAt = useRef<number[]>([])
  const [, wake] = useState(0)
  const now = performance.now()
  values.forEach((value, index) => {
    const before = previous.current[index]
    if (typeof value === "number" && typeof before === "number" && value !== before) changedAt.current[index] = now
  })
  previous.current = values
  const active = changedAt.current.map((at) => at != null && now - at < ACTIVE_MS)
  const pending = active.some(Boolean)
  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => wake((n) => n + 1), ACTIVE_MS)
    return () => clearTimeout(timer)
  })
  return active
}

// The map box in whole CSS pixels, so the WebGL canvas and its frame never land
// between pixels and get resampled.
function useViewport() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])
  return size
}

function ObjectiveText({ objective }: { objective: Objective }) {
  const { text, highlight } = objective
  const index = highlight ? text.indexOf(highlight) : -1
  return (
    <p className="objective" role="status">
      {index < 0 || !highlight ? text : <>
        {text.slice(0, index)}<strong>{highlight}</strong>{text.slice(index + highlight.length)}
      </>}
    </p>
  )
}

function App() {
  const [config, setConfig] = useState<HudConfig>({
    type: "config",
    statusBars: [],
    currency: "$",
    navigationUnits: "imperial",
    navigationEnabled: false,
    waypointChoices: [],
    moneyEnabled: false,
    vehicleEnabled: false,
    map3dEnabled: false,
  })
  const [frame, setFrame] = useState<Frame | null>(null)
  const [radar, setRadar] = useState<Radar | null>(null)
  const [editing, setEditing] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("layout")
  const [map3dSelected, setMap3dSelected] = useState<boolean>()
  const [hudLayout, setHudLayout] = useState<HudLayout>({})
  const viewport = useViewport()
  const activeBars = useActiveBars(config.statusBars.map(({ name }) => frame?.bars?.[name] ?? false))

  useEffect(() => {
    function receive(event: MessageEvent<NuiMessage>) {
      const data = event.data
      switch (data?.type) {
        case "frame": setFrame(data); break
        case "radar": setRadar(data); break
        case "editor":
          setEditing(data.open)
          if (!data.open) setSettingsTab("layout")
          break
        case "mapMode": setMap3dSelected(data.enabled); break
        case "config": setConfig(data); break
        // An empty Lua table arrives as [].
        case "hudLayout": setHudLayout(Array.isArray(data.layout) ? {} : data.layout); break
      }
    }
    window.addEventListener("message", receive)
    let active = true
    let timer: ReturnType<typeof setTimeout>
    function announce() {
      void nui("ready").catch(() => {
        if (active) timer = setTimeout(announce, 500)
      })
    }
    announce()
    return () => {
      active = false
      clearTimeout(timer)
      window.removeEventListener("message", receive)
    }
  }, [])

  const safe = {
    "--safe-x": `${(radar?.safe.x ?? 0) * 100}vw`,
    "--safe-y": `${(radar?.safe.y ?? 0) * 100}vh`,
  } as CSSProperties
  const metric = config.navigationUnits === "metric"
  const mapVisible = radar && (frame?.showMap || editing)
  const { height } = viewport
  const vehicleClearance = frame?.vehicle ? Math.max(38 / height, 0.054) + Math.max(18 / height, 0.026) + 0.013 : 0
  const turnClearance = frame?.turn ? Math.max(34 / height, 0.054) + 0.005 : 0
  const mapBox = radar && {
    left: Math.round(radar.rect.x * viewport.width),
    top: Math.round(radar.rect.y * viewport.height),
    width: Math.round(radar.rect.width * viewport.width),
    height: Math.round(radar.rect.height * viewport.height),
  }

  const vitals = placement(hudLayout.vitals, "top left", editing)
  const previewStatus = editing && settingsTab === "status"
  const stacked = []
  const detached = []
  for (const [index, bar] of config.statusBars.entries()) {
    const { name, enabled } = bar
    const layout = hudLayout.status?.[name]
    const visible = layout?.visible ?? enabled
    const value = frame?.bars?.[name]
    if (!previewStatus && (!visible || value == null)) continue

    const { x, y } = layout ?? {}
    const hasPosition = x != null && y != null
    const scale = (layout?.scale ?? 1) * (hasPosition ? hudLayout.vitals?.scale ?? 1 : 1)
    const vital = <Vital key={name} name={name} value={value ?? 75} scale={scale}
      active={activeBars[index] === true} dimmed={!visible || value == null} />
    if (hasPosition) {
      detached.push(<div key={name} className={`vital-detached${vitals.className}`}
        hidden={vitals.hidden} style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>{vital}</div>)
    } else stacked.push(vital)
  }
  const moneyLayout = editing && hudLayout.moneyMode && hudLayout.moneyMode !== "always"
    ? { ...hudLayout.money, visible: false as const } : hudLayout.money
  const money = placement(moneyLayout, "top right", editing)
  const clockOn = hudLayout.clock ?? radar?.showClock

  return (
    <main className="hud" style={safe} hidden={!frame?.visible && !editing}>
      <section className={`vitals${vitals.className}`} style={vitals.style} hidden={vitals.hidden} aria-label="Player status">
        {stacked}
      </section>
      {detached}
      {(frame?.cash != null || frame?.bank != null) && (
        <section className={`balances${money.className}`} style={money.style} hidden={money.hidden} aria-label="Balances">
          {frame.bank != null && <Balance kind="Bank" amount={frame.bank} currency={config.currency} />}
          {frame.cash != null && <Balance kind="Cash" amount={frame.cash} currency={config.currency} />}
        </section>
      )}
      {radar && mapBox && (
        <div
          className={`map-anchor${radar.rect.y < vehicleClearance + turnClearance + 0.01 ? " map-anchor-top" : ""}`}
          hidden={!mapVisible}
          role="group"
          aria-label="Minimap"
          style={{
            left: `${mapBox.left}px`,
            top: `${mapBox.top}px`,
            width: `${mapBox.width}px`,
            height: `${mapBox.height}px`,
            "--map-unit": `${mapBox.height / 115}px`,
          } as CSSProperties}
        >
          {config.map3dEnabled && <Map3DCanvas visible={frame?.map3d === true} />}
          {frame?.map3d !== true && <span className="native-map-frame" aria-hidden="true" />}
          <span className="map-badge" aria-hidden="true" />
          {clockOn && frame?.clock && <span className="map-clock">{frame.clock}</span>}
          {mapVisible && (frame?.turn || frame?.vehicle) && (
            <div className="radar-stack">
              {frame.turn && <TurnPrompt turn={frame.turn} metric={metric} />}
              {frame.vehicle && <VehicleCard condition={frame.vehicle} />}
            </div>
          )}
        </div>
      )}
      {!mapVisible && frame?.vehicle && (
        <div className="vehicle-anchor" style={mapBox ? {
          left: `${mapBox.left}px`, width: `${mapBox.width}px`,
        } : undefined}>
          <VehicleCard condition={frame.vehicle} />
        </div>
      )}
      {frame?.objective && <ObjectiveText objective={frame.objective} />}
      {editing && radar && (
        <HudSettings radar={radar} layout={hudLayout} config={config} map3d={config.map3dEnabled ? map3dSelected : undefined}
          tab={settingsTab} setTab={setSettingsTab} />
      )}
    </main>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
