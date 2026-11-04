import * as React from "react"

import { detectBackend, probeBackend, type Backend } from "@/lib/models"

/**
 * The execution provider, resolved by asking for a GPU adapter.
 *
 * Every screen that displays a backend used to call `detectBackend()` on mount,
 * which is a guess from the presence of `navigator.gpu`. On iOS Safari that
 * object exists and `requestAdapter()` fails, so the UI would have said
 * "WebGPU" and quoted WebGPU download sizes on a device running everything on
 * the CPU.
 *
 * Starts from the synchronous guess so nothing flashes empty, then corrects
 * itself when the probe resolves — which is nearly instant when an adapter is
 * really there.
 */
export function useBackend(): Backend {
  const [backend, setBackend] = React.useState<Backend>(() => detectBackend())

  React.useEffect(() => {
    let live = true
    void probeBackend().then((resolved) => {
      if (live) setBackend(resolved)
    })
    return () => {
      live = false
    }
  }, [])

  return backend
}
