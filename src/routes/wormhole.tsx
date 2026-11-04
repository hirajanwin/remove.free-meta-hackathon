import { createFileRoute } from "@tanstack/react-router"
import { WormholeView } from "@/components/wormhole/wormhole-view"

// The Wormhole now lives primarily as a tab inside Vault History (it plays
// with the vault's cutouts, so that is where it belongs). This route stays
// as a deep link to the same view.
export const Route = createFileRoute("/wormhole")({
  component: WormholeView,
})
