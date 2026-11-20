export type Layout = { x: number; y: number; scale: number }
export type RadarRect = Layout & { width: number; height: number }
// A HUD element's place as a fraction of the screen (its top left), its size,
// and whether it shows. Missing values are the default.
export type ElementLayout = { x?: number; y?: number; scale?: number; visible?: false }
export const STATUS_LABELS = {
  health: "Health", stamina: "Stamina", armor: "Armor", hunger: "Hunger",
  thirst: "Thirst", stress: "Stress", oxygen: "Oxygen",
}
export type StatusBar = keyof typeof STATUS_LABELS
export type StatusBarLayout = Omit<ElementLayout, "visible"> & { visible?: boolean }
export type HudOptions = {
  clock: boolean
  mapOnFoot: boolean
  cinematic: boolean
  moneyMode: "always" | "hold" | "off"
  moneyKey: number
  turnPrompts: boolean
  waypointColor: string
  vehicleCard: boolean
  vehicleKey: number
}
export type HudLayout = Partial<HudOptions> & {
  vitals?: ElementLayout
  money?: ElementLayout
  status?: Partial<Record<StatusBar, StatusBarLayout>>
}

export type HudConfig = {
  type: "config"
  statusBars: { name: StatusBar; enabled: boolean }[]
  currency: string
  navigationUnits: "metric" | "imperial"
  navigationEnabled: boolean
  waypointChoices: { id: string; label: string; rgba?: [number, number, number, number] }[]
  moneyEnabled: boolean
  vehicleEnabled: boolean
  map3dEnabled: boolean
}

export type Objective = { text: string; highlight?: string }
export type VehicleCondition = {
  make?: string
  emblem?: string
  name: string
  engine: number
  lowEngine: boolean
  fuel: number
  lowFuel: boolean
  buckled?: boolean
}
export type Turn = {
  direction: "left" | "right" | "sharp-left" | "sharp-right"
  metres: number
}

export type Frame = {
  type: "frame"
  visible: boolean
  showMap: boolean
  map3d?: boolean
  bars?: Partial<Record<StatusBar, number>>
  cash?: number
  bank?: number
  clock?: string
  objective?: Objective
  turn?: Turn
  vehicle?: VehicleCondition
}

export type Radar = {
  type: "radar"
  rect: RadarRect
  safe: { x: number; y: number }
  showClock: boolean
}

export type NuiMessage =
  | Frame
  | Radar
  | { type: "editor"; open: boolean }
  | { type: "mapMode"; enabled: boolean }
  | { type: "hudLayout"; layout: HudLayout | unknown[] }
  | HudConfig

declare global {
  function GetParentResourceName(): string
}

export async function nui(action: string, payload: object = {}) {
  if (typeof GetParentResourceName !== "function") return
  const response = await fetch(`https://${GetParentResourceName()}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok || !(await response.json()).ok) throw new Error("HUD callback failed")
}
