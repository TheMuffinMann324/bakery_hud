import { useEffect, useRef } from "react"
import { nui } from "@/nui"

export function Map3DCanvas({ visible }: { visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const map = canvas.current
    if (!map?.parentElement) return
    const panel = map.parentElement
    const script = document.createElement("script")
    script.src = `${import.meta.env.BASE_URL}map3d/renderer.js`

    // Match the renderer's 10% marker gutter on device-pixel boundaries.
    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      const bleed = Math.round(entry.contentRect.height * dpr * 0.1) / dpr
      if (bleed > 0) map.style.setProperty("--map-bleed", `${bleed}px`)
    })
    observer.observe(panel)

    function fallback(why: string) {
      void nui("map3dReady", { ok: false, why }).catch(() => {})
    }
    function lostContext() { fallback("WebGL context lost") }
    function missingScript() { fallback("renderer.js missing") }

    map.addEventListener("webglcontextlost", lostContext)
    script.addEventListener("error", missingScript)
    document.body.append(script)

    return () => {
      observer.disconnect()
      map.removeEventListener("webglcontextlost", lostContext)
      script.removeEventListener("error", missingScript)
      script.remove()
    }
  }, [])

  return <canvas ref={canvas} id="map3d" className="map3d-canvas hidden" role="img"
    aria-label="3D minimap" aria-hidden={!visible} />
}
