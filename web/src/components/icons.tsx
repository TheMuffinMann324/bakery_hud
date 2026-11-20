// Filled glyphs drawn on a 24-unit grid so they stay sharp at any HUD scale.

type IconProps = { className?: string }

const svg = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const

export function HeartIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M12 20.3 4.6 13.2a4.7 4.7 0 0 1 0-6.8 4.9 4.9 0 0 1 6.9 0l.5.5.5-.5a4.9 4.9 0 0 1 6.9 0 4.7 4.7 0 0 1 0 6.8Z" />
    </svg>
  )
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M13.6 2.5 5.2 13.4h5.6l-1.4 8.1 8.4-10.9h-5.6Z" />
    </svg>
  )
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M12 2.6 4.4 5.4v5.9c0 4.7 3.1 8.6 7.6 10.1 4.5-1.5 7.6-5.4 7.6-10.1V5.4Z" />
    </svg>
  )
}

export function FoodIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M3.5 11.2C3.9 7 7.5 4.2 12 4.2s8.1 2.8 8.5 7Zm-.3 2.3h17.6v1.9H3.2Zm.8 3.8h16l-.6 1.3a2.4 2.4 0 0 1-2.2 1.4H6.8a2.4 2.4 0 0 1-2.2-1.4Z" />
    </svg>
  )
}

export function DropIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M12 2.8s-6.3 7-6.3 11.4a6.3 6.3 0 0 0 12.6 0C18.3 9.8 12 2.8 12 2.8Z" />
    </svg>
  )
}

export function LungsIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="currentColor" d="M11 4h2v5.4l1.7 1.8V7.7c0-1.1 1.1-1.7 2-.9 2.8 2.5 4.6 6 4.6 9.7 0 1.7-1.3 2.8-3 2.5l-2.2-.5c-.9-.2-1.4-.9-1.4-1.8v-2.8L12 11.2l-2.7 2.7v2.8c0 .9-.5 1.6-1.4 1.8l-2.2.5c-1.7.3-3-1-3-2.5 0-3.7 1.8-7.2 4.6-9.7.9-.8 2-.2 2 .9v3.5L11 9.4Z" />
    </svg>
  )
}

export function PulseIcon({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
        d="M2.8 12.5h4l2.4-6 4.6 12 2.6-6h4.8" />
    </svg>
  )
}

// Balance badges: a dark disc ringed in the account colour with its mark inside.
export function BankBadge({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <circle cx="12" cy="12" r="11" fill="#1b1820" />
      <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        d="M10.2 6.6 9.6 16.8M9.8 13.4a3 3 0 1 1 .6 3.1" />
    </svg>
  )
}

export function CashBadge({ className }: IconProps) {
  return (
    <svg {...svg} className={className}>
      <circle cx="12" cy="12" r="11" fill="#1b1820" />
      <circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path fill="currentColor" d="M8.4 8.3h7.2v1.3H8.4Z" />
      <rect x="7.2" y="10.4" width="9.6" height="5.6" rx="1" fill="currentColor" />
      <circle cx="14.2" cy="13.2" r="1.05" fill="#1b1820" />
    </svg>
  )
}
