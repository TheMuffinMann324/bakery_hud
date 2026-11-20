import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { nui, STATUS_LABELS, type ElementLayout, type HudConfig, type HudLayout, type HudOptions, type Radar, type StatusBar } from "@/nui"

type LayoutElement = "minimap" | "vitals" | "money"
type ElementName = LayoutElement | StatusBar
export type SettingsTab = "layout" | "status" | "minimap" | "display"
type KeyOption = "moneyKey" | "vehicleKey"

const ELEMENTS: { name: LayoutElement; label: string; selector: string }[] = [
  { name: "minimap", label: "Minimap", selector: ".map-anchor" },
  { name: "vitals", label: "Status Bars", selector: ".vitals" },
  { name: "money", label: "Money", selector: ".balances" },
]
const STATUS_TARGETS = (Object.keys(STATUS_LABELS) as StatusBar[]).map(name => ({
  name, label: STATUS_LABELS[name], selector: `[data-status-bar="${name}"]`,
}))
const TARGETS = [...ELEMENTS, ...STATUS_TARGETS]
const TABS: { name: SettingsTab; label: string }[] = [
  { name: "layout", label: "Layout" },
  { name: "status", label: "Status Bars" },
  { name: "minimap", label: "Minimap" },
  { name: "display", label: "Display" },
]
const MIN_SCALE = { minimap: 0.7, vitals: 0.6, money: 0.6 }
const MAX_SCALE = { minimap: 1.65, vitals: 1.6, money: 1.6 }
const STEP = 0.05

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const ALIGNMENTS = [0, 0.5, 1]

type Snap = { position: number; guide?: number }
type SnapGuides = { x?: number; y?: number }

function snapAxis(position: number, limit: number, radius: number, candidates: Required<Snap>[]): Snap {
  let best: Snap = { position }
  let distance = radius
  for (const candidate of candidates) {
    const delta = Math.abs(candidate.position - position)
    if (delta >= distance || candidate.position < 0 || candidate.position > limit) continue
    best = candidate
    distance = delta
  }
  return best
}

function snapStatusBar(x: number, y: number, box: DOMRect, peers: DOMRect[], gap: number, vw: number, vh: number) {
  const radius = clamp(vh * 0.012, 6, 12)
  const left = snapAxis(x, Math.max(0, vw * 0.99 - box.width), radius, peers.flatMap(peer =>
    ALIGNMENTS.map(fraction => {
      const guide = peer.left + peer.width * fraction
      return { position: guide - box.width * fraction, guide }
    })
  ))
  const top = snapAxis(y, Math.max(0, vh * 0.99 - box.height), radius, peers.flatMap(peer => {
    // An overlapping column stacks at the normal gap. Side-by-side bars align within the row.
    if (left.position < peer.right && left.position + box.width > peer.left) {
      return [
        { position: peer.top - gap - box.height, guide: peer.top - gap },
        { position: peer.bottom + gap, guide: peer.bottom + gap },
      ]
    }
    return ALIGNMENTS.map(fraction => {
      const guide = peer.top + peer.height * fraction
      return { position: guide - box.height * fraction, guide }
    })
  }))
  return { x: left.position, y: top.position, guides: { x: left.guide, y: top.guide } }
}

type SettingRow = { label: string; value: string; swatch?: string }
type Row = SettingRow & ({ prev: () => void; next: () => void } | { binding: KeyOption })
type StatusChange = { field: "position"; x?: number; y?: number }
  | { field: "scale"; value: number } | { field: "visible"; value: boolean }

function isStatusBar(name: ElementName): name is StatusBar {
  return Object.hasOwn(STATUS_LABELS, name)
}

const MONEY_MODES: HudOptions["moneyMode"][] = ["always", "hold", "off"]
const MONEY_LABELS = { always: "Always", hold: "Hold Key", off: "Off" }

function toggleRow(label: string, enabled: boolean, change: () => void): Row {
  return { label, value: enabled ? "On" : "Off", prev: change, next: change }
}

function stepRow(label: string, value: string, step: (direction: number) => void, swatch?: string): Row {
  return { label, value, swatch, prev: () => step(-1), next: () => step(1) }
}

function cycle<T>(values: T[], index: number, step: number) {
  return values[(index + step + values.length) % values.length]
}

function readBinding(event: KeyboardEvent) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const key = event.key.toUpperCase()
  if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0)
  if (/^F(?:[1-79]|1[0-2])$/.test(key)) return 0x6F + Number(key.slice(1))
}

function keyLabel(key: number) {
  return key >= 0x70 ? `F${key - 0x6F}` : String.fromCharCode(key)
}

// Sends each kind of preview in order, keeping only the newest of each while
// one is on its way, so a drag never queues up stale positions.
function usePreviewQueue(onError: () => void) {
  const latest = useRef(new Map<string, () => Promise<void>>())
  const running = useRef<Promise<void> | null>(null)

  async function drain() {
    for (const [key, send] of latest.current) {
      latest.current.delete(key)
      await send()
    }
  }

  function flush() {
    if (!running.current && latest.current.size) {
      running.current = drain().finally(() => { running.current = null })
    }
    return running.current
  }

  function push(key: string, send: () => Promise<void>) {
    latest.current.set(key, send)
    void flush()?.catch(onError)
  }

  return { push, flush, idle: () => running.current?.catch(() => {}) }
}

// The on-screen boxes of the HUD elements, followed every frame while open.
function useElementBoxes() {
  const [boxes, setBoxes] = useState<Partial<Record<ElementName, DOMRect>>>({})
  useEffect(() => {
    let frame = 0
    let last = ""
    const read = () => {
      const next: Partial<Record<ElementName, DOMRect>> = {}
      for (const element of TARGETS) {
        const node = document.querySelector(element.selector)
        const box = node?.getBoundingClientRect()
        if (box?.width && box.height) next[element.name] = box
      }
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setBoxes(next) }
      frame = requestAnimationFrame(read)
    }
    read()
    return () => cancelAnimationFrame(frame)
  }, [])
  return boxes
}

export function HudSettings({ radar, layout, config, map3d, tab, setTab }: {
  radar: Radar; layout: HudLayout; config: HudConfig; map3d?: boolean
  tab: SettingsTab; setTab: (tab: SettingsTab) => void
}) {
  const [selected, setSelected] = useState<LayoutElement>("minimap")
  const [selectedStatus, setSelectedStatus] = useState<StatusBar>("health")
  const [focus, setFocus] = useState(0)
  const [busy, setBusy] = useState(false)
  // The panel steps aside while an element is dragged, or when hidden with H.
  const [dragging, setDragging] = useState(false)
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({})
  const [panelHidden, setPanelHidden] = useState(false)
  const [capturingKey, setCapturingKey] = useState<KeyOption | null>(null)
  const [error, setError] = useState("")
  const finishing = useRef(false)
  const drag = useRef<{ name: ElementName; x: number; y: number; box: DOMRect; gap: number } | null>(null)
  const queue = usePreviewQueue(() => setError("The preview could not update. Try again."))
  const boxes = useElementBoxes()

  const scaleOf = (name: LayoutElement) => name === "minimap" ? radar.rect.scale : layout[name]?.scale ?? 1

  function previewMinimap(x: number, y: number, scale: number) {
    const width = (radar.rect.width / radar.rect.scale) * scale
    const height = (radar.rect.height / radar.rect.scale) * scale
    const next = { x: clamp(x, 0.002, 0.998 - width), y: clamp(y, 0.002, 0.998 - height), scale }
    queue.push("minimap", () => nui("radarPreview", next))
  }

  function previewElement(name: "vitals" | "money", change: ElementLayout) {
    const next = { ...layout[name], ...change }
    queue.push(name, () => nui("hudPreview", { element: name, layout: next }))
  }

  function setScale(name: LayoutElement, scale: number) {
    const value = Math.round(clamp(scale, MIN_SCALE[name], MAX_SCALE[name]) * 100) / 100
    if (name === "minimap") previewMinimap(radar.rect.x, radar.rect.y, value)
    else previewElement(name, { scale: value })
  }

  function previewStatus(name: StatusBar, change: StatusChange) {
    queue.push(`${name}:${change.field}`, () => nui("statusPreview", { name, ...change }))
  }

  function moveStatus(name: StatusBar, x: number, y: number, box: DOMRect) {
    previewStatus(name, {
      field: "position",
      x: clamp(x, 0, Math.max(0, 0.99 - box.width / window.innerWidth)),
      y: clamp(y, 0, Math.max(0, 0.99 - box.height / window.innerHeight)),
    })
  }

  function setOption<K extends keyof HudOptions>(element: K, value: HudOptions[K]) {
    queue.push(element, () => nui("hudPreview", { element, value }))
  }

  function setMap3d(enabled: boolean) {
    queue.push("map3d", () => nui("radarMode", { enabled }))
  }

  async function complete(action: "save" | "reset" | "cancel") {
    if (finishing.current) return
    finishing.current = true
    setBusy(true)
    try {
      if (action === "save") await queue.flush()
      else await queue.idle()
      if (action === "reset") await nui("radarReset")
      else await nui("radarDone", { save: action === "save" })
      setError("")
    } catch {
      setError("The settings could not be updated. Try again.")
    } finally {
      finishing.current = false
      setBusy(false)
    }
  }

  const clockOn = layout.clock ?? radar.showClock
  const mapOnFoot = layout.mapOnFoot ?? true
  const turnPrompts = layout.turnPrompts ?? true
  const waypointChoices = config.waypointChoices ?? []
  const waypointIndex = Math.max(0, waypointChoices.findIndex(choice => choice.id === layout.waypointColor))
  const waypoint = waypointChoices[waypointIndex]
  const cinematic = layout.cinematic ?? false
  const vehicleCard = layout.vehicleCard ?? true
  const moneyMode = layout.moneyMode ?? "always"
  const moneyModeIndex = MONEY_MODES.indexOf(moneyMode)
  const selectedScale = scaleOf(selected)
  const vitalsVisible = layout.vitals?.visible !== false
  const statusBars = config.statusBars
  const statusIndex = Math.max(0, statusBars.findIndex(bar => bar.name === selectedStatus))
  const status = statusBars[statusIndex]
  const barLayout = status && layout.status?.[status.name]
  const barVisible = barLayout?.visible ?? status?.enabled ?? false
  const barScale = barLayout?.scale ?? 1
  const barPosition = barLayout?.x != null && barLayout.y != null ? { x: barLayout.x, y: barLayout.y } : null
  const chooseStatus = (step: number) => setSelectedStatus(cycle(statusBars, statusIndex, step).name)
  const sizeStatus = (step: number) => previewStatus(status.name, {
    field: "scale", value: Math.round(clamp(barScale + step * STEP, 0.6, 1.6) * 100) / 100,
  })
  function toggleStatusPosition() {
    const box = boxes[status.name]
    if (barPosition) previewStatus(status.name, { field: "position" })
    else if (box) moveStatus(status.name, box.left / window.innerWidth, box.top / window.innerHeight, box)
  }

  function nudgeStatus(axis: "x" | "y", step: number) {
    const box = boxes[status.name]
    if (!barPosition || !box) return
    const { x, y } = barPosition
    moveStatus(status.name, x + (axis === "x" ? step * 0.01 : 0), y + (axis === "y" ? step * 0.01 : 0), box)
  }
  const rows: Row[] = tab === "layout"
    ? [
        stepRow("Size", `${Math.round(selectedScale * 100)}%`, step => setScale(selected, selectedScale + step * STEP)),
        ...(selected === "vitals" ? [toggleRow("Show", vitalsVisible, () =>
          previewElement("vitals", { visible: vitalsVisible ? false : undefined }))] : []),
      ]
    : tab === "status" ? (status ? [
        stepRow("Bar", STATUS_LABELS[status.name], chooseStatus),
        toggleRow("Show", barVisible, () => previewStatus(status.name, { field: "visible", value: !barVisible })),
        stepRow("Size", `${Math.round(barScale * 100)}%`, sizeStatus),
        { label: "Position", value: barPosition ? "Custom" : "Stacked", prev: toggleStatusPosition, next: toggleStatusPosition },
        ...(barPosition ? [
          stepRow("Horizontal", `${Math.round(barPosition.x * 100)}%`, step => nudgeStatus("x", step)),
          stepRow("Vertical", `${Math.round(barPosition.y * 100)}%`, step => nudgeStatus("y", step)),
        ] : []),
      ] : [])
    : tab === "minimap" ? [
        ...(map3d == null ? [] : [toggleRow("3D Minimap", map3d, () => setMap3d(!map3d))]),
        toggleRow("Show Map on Foot", mapOnFoot, () => setOption("mapOnFoot", !mapOnFoot)),
        toggleRow("Clock", clockOn, () => setOption("clock", !clockOn)),
        ...(config.navigationEnabled ? [toggleRow("Turn Prompts", turnPrompts, () => setOption("turnPrompts", !turnPrompts))] : []),
        ...(waypoint ? [stepRow("Waypoint Colour", waypoint.label,
          step => setOption("waypointColor", cycle(waypointChoices, waypointIndex, step).id),
          waypoint.rgba && `rgb(${waypoint.rgba.slice(0, 3).join(" ")})`,
        )] : []),
      ] : [
        toggleRow("Cinematic Mode", cinematic, () => setOption("cinematic", !cinematic)),
        ...(config.moneyEnabled ? [stepRow("Cash & Bank", MONEY_LABELS[moneyMode],
          step => setOption("moneyMode", cycle(MONEY_MODES, moneyModeIndex, step)),
        )] : []),
        ...(config.moneyEnabled && moneyMode === "hold" ? [{
          label: "Balance Key", value: keyLabel(layout.moneyKey ?? 0x79), binding: "moneyKey" as const,
        }] : []),
        ...(config.vehicleEnabled ? [
          toggleRow("Vehicle Card", vehicleCard, () => setOption("vehicleCard", !vehicleCard)),
          ...(vehicleCard ? [{ label: "Vehicle Card Key", value: keyLabel(layout.vehicleKey ?? 0x76), binding: "vehicleKey" as const }] : []),
        ] : []),
      ]
  const picks = tab === "layout" ? ELEMENTS : []
  const itemCount = picks.length + rows.length
  const focused = Math.max(0, Math.min(focus, itemCount - 1))
  const focusedRow = rows[focused - picks.length]

  // Moving onto an element picks it, as the game's preview lists do.
  function focusItem(i: number) {
    setFocus(i)
    const pick = picks[i]
    if (pick) setSelected(pick.name)
  }

  const latest = useRef({ itemCount, focused, focusedRow, tab, focusItem, capturingKey, setOption })
  latest.current = { itemCount, focused, focusedRow, tab, focusItem, capturingKey, setOption }

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (finishing.current) return
      const { itemCount: count, focused: at, focusedRow: row, tab: open, focusItem: moveTo,
        capturingKey: capturing, setOption: update } = latest.current
      if (capturing) {
        event.preventDefault()
        if (event.key === "Escape") setCapturingKey(null)
        else {
          const binding = readBinding(event)
          if (binding != null) {
            update(capturing, binding)
            setCapturingKey(null)
          }
        }
        return
      }
      const adjust = (direction: "prev" | "next") => {
        if (!row) return
        if ("binding" in row) setCapturingKey(row.binding)
        else row[direction]()
      }
      const switchTab = (step: number) => {
        const i = TABS.findIndex((t) => t.name === open)
        setTab(TABS[(i + step + TABS.length) % TABS.length].name)
        setFocus(0)
      }
      const actions: Record<string, () => void> = {
        Escape: () => void complete("cancel"),
        Enter: () => void complete("save"),
        r: () => void complete("reset"),
        h: () => setPanelHidden((hidden) => !hidden),
        q: () => switchTab(-1),
        e: () => switchTab(1),
        ArrowUp: () => { if (count) moveTo((at - 1 + count) % count) },
        ArrowDown: () => { if (count) moveTo((at + 1) % count) },
        ArrowLeft: () => adjust("prev"),
        ArrowRight: () => adjust("next"),
      }
      const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  function startDrag(name: ElementName, event: ReactPointerEvent<HTMLDivElement>) {
    const box = boxes[name]
    if (event.button !== 0 || !box || finishing.current) return
    setCapturingKey(null)
    let gap = 0
    if (isStatusBar(name)) {
      const stack = document.querySelector(".vitals")
      if (stack) gap = (parseFloat(getComputedStyle(stack).rowGap) || 0) * (layout.vitals?.scale ?? 1)
      setSelectedStatus(name)
      setTab("status")
      setFocus(0)
    } else {
      setSelected(name)
      setTab("layout")
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { name, x: event.clientX, y: event.clientY, box, gap }
    setDragging(true)
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    const vw = window.innerWidth, vh = window.innerHeight
    const x = start.box.left + event.clientX - start.x
    const y = start.box.top + event.clientY - start.y
    if (start.name === "minimap") previewMinimap(x / vw, y / vh, radar.rect.scale)
    else if (isStatusBar(start.name)) {
      const peers = STATUS_TARGETS.flatMap(({ name }) => name !== start.name && boxes[name] ? [boxes[name]] : [])
      const result = event.shiftKey ? { x, y, guides: {} } : snapStatusBar(x, y, start.box, peers, start.gap, vw, vh)
      setSnapGuides(result.guides)
      moveStatus(start.name, result.x / vw, result.y / vh, start.box)
    } else previewElement(start.name, {
      x: clamp(x / vw, 0, 0.99 - start.box.width / vw),
      y: clamp(y / vh, 0, 0.99 - start.box.height / vh),
    })
  }

  function endDrag() {
    drag.current = null
    setDragging(false)
    setSnapGuides({})
  }

  const targets = tab === "status" ? STATUS_TARGETS : ELEMENTS
  const selectedTarget = tab === "status" ? status?.name : selected

  return (
    <div className={`settings-layer${dragging || panelHidden ? " settings-clear" : ""}`}>
      <div className="settings-shade" aria-hidden="true" />
      {snapGuides.x != null && <div className="settings-snap-x" style={{ left: snapGuides.x }} aria-hidden="true" />}
      {snapGuides.y != null && <div className="settings-snap-y" style={{ top: snapGuides.y }} aria-hidden="true" />}
      {targets.map(({ name, label }) => {
        const box = boxes[name]
        // While one is dragged, the others keep out of the way.
        if (!box || (dragging && name !== selectedTarget)) return null
        return (
          <div
            key={name}
            role="button"
            tabIndex={-1}
            aria-label={`Move ${label}`}
            className={`settings-target${name === selectedTarget ? " settings-target-on" : ""}${box.top < window.innerHeight * 0.15 ? " settings-target-below" : ""}`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            onPointerDown={(event) => startDrag(name, event)}
            onPointerMove={moveDrag}
            onLostPointerCapture={endDrag}
          >
            {name === selectedTarget && !dragging && <span className="settings-target-label">{label}</span>}
          </div>
        )
      })}

      {panelHidden && (
        <button type="button" className="settings-peek" onClick={() => setPanelHidden(false)}>
          <kbd>H</kbd>Show settings
        </button>
      )}

      <section className="settings" aria-labelledby="settings-title" aria-hidden={panelHidden}>
        <h1 id="settings-title">HUD Settings</h1>
        <nav className="settings-tabs" aria-label="Settings sections">
          <kbd>Q</kbd>
          {TABS.map((t) => (
            <button key={t.name} type="button" className={t.name === tab ? "settings-tab-on" : undefined}
              aria-pressed={t.name === tab} onClick={() => { setCapturingKey(null); setTab(t.name); setFocus(0) }}>
              {t.label}
            </button>
          ))}
          <kbd>E</kbd>
        </nav>

        {picks.length > 0 && (
          <>
            <h2>Element</h2>
            <ul className="settings-list">
              {picks.map(({ name, label }, i) => (
                <li key={name}>
                  <button type="button" className={i === focused ? "settings-row-on" : undefined}
                    onClick={() => focusItem(i)} aria-pressed={name === selected}>
                    <span>{label}</span>
                    <span className={`settings-radio${name === selected ? " settings-radio-on" : ""}`} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>{tab === "layout" ? "Options" : tab === "status" ? "Individual Bars" : tab === "minimap" ? "Map and GPS" : "Visibility"}</h2>
        <ul className="settings-rows">
          {rows.map((row, index) => {
            const at = picks.length + index
            return (
              <li key={row.label} className={at === focused ? "settings-row-on" : undefined}
                onPointerEnter={() => setFocus(at)}>
                <span className="settings-row-label">
                  {row.label}
                  {row.swatch && <span className="settings-swatch" style={{ backgroundColor: row.swatch }} aria-hidden="true" />}
                </span>
                <span className="settings-value">
                  {"binding" in row ? (
                    <button type="button" className="settings-bind" disabled={busy} onClick={() => setCapturingKey(row.binding)}
                      aria-label={`Change ${row.label}: ${row.value}`} aria-pressed={capturingKey === row.binding}>
                      {capturingKey === row.binding ? "Press a key" : <kbd>{row.value}</kbd>}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="settings-step" aria-label={`Previous ${row.label}`} disabled={busy || capturingKey !== null} onClick={row.prev}>‹</button>
                      <output>{row.value}</output>
                      <button type="button" className="settings-step" aria-label={`Next ${row.label}`} disabled={busy || capturingKey !== null} onClick={row.next}>›</button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>

        {tab === "layout" && <p className="settings-hint">Drag an element to move it. Press H to hide this panel.</p>}
        {tab === "status" && <p className="settings-hint">Drag near another bar to snap. Hold Shift for free placement. Choose Stacked to return the bar to the group.</p>}
        {tab === "display" && (capturingKey
          ? <p className="settings-hint" role="status">Press a letter, number, or F-key. Esc cancels.</p>
          : <p className="settings-hint">Cinematic mode takes effect when you save.</p>)}
        {error && <p className="settings-error" role="status">{error}</p>}

        <footer className="settings-footer">
          {itemCount > 0 && <span className="settings-page">{focused + 1} <i>/</i> {itemCount}</span>}
          <button type="button" disabled={busy || capturingKey !== null} onClick={() => void complete("reset")}><kbd>R</kbd>Reset</button>
          <button type="button" disabled={busy} onClick={() => capturingKey ? setCapturingKey(null) : void complete("cancel")}><kbd>Esc</kbd>Cancel</button>
          <button type="button" disabled={busy || capturingKey !== null} onClick={() => void complete("save")}><kbd>Enter</kbd>Save</button>
        </footer>
      </section>
    </div>
  )
}
