import type { Turn } from "@/nui"

// Road-sign arrows: a solid head and a thick square stem, drawn for a left
// turn and mirrored for a right one.
const arrows = {
  turn: "M9.6 4.2 3.4 9.6l6.2 5.4v-3.6h6.2V21h3.6V7.8h-9.8Z",
  sharp: "M4.4 4.6v8.8l2.9-2.9 7.6 7.6V21h3.6v-4.4L9.8 8l3-3Z",
}

const directions = {
  left: { label: "Turn Left", arrow: arrows.turn, mirror: false },
  right: { label: "Turn Right", arrow: arrows.turn, mirror: true },
  "sharp-left": { label: "Sharp Left", arrow: arrows.sharp, mirror: false },
  "sharp-right": { label: "Sharp Right", arrow: arrows.sharp, mirror: true },
}

export function TurnPrompt({ turn, metric }: { turn: Turn; metric: boolean }) {
  const { label, arrow, mirror } = directions[turn.direction]
  const distance = metric ? `${turn.metres} m` : `${Math.round(turn.metres * 3.28084)} ft`

  return (
    <aside className="turn-prompt" aria-label="Next turn">
      <div className="turn-copy">
        <strong>{label}</strong>
        <span>{distance}</span>
      </div>
      <div className="turn-sign" aria-hidden="true">
        <svg viewBox="0 0 24 24" style={mirror ? { transform: "scaleX(-1)" } : undefined}>
          <path fill="currentColor" d={arrow} />
        </svg>
      </div>
    </aside>
  )
}
