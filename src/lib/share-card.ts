// Shareable result card: before/after with the measured stats.
//
// Built for the X post and the community gallery: one 1200x630 image that
// shows the cut, says what made it, and carries the numbers the agent
// verified. Composed locally from canvases the studio already has.

export interface ShareCardInput {
  original: HTMLCanvasElement
  cutout: HTMLCanvasElement
  title: string
  stats: string
}

/** Draw an image cover-fitted into a box. */
function cover(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export function composeShareCard(input: ShareCardInput): HTMLCanvasElement {
  const W = 1200
  const H = 630
  const card = document.createElement("canvas")
  card.width = W
  card.height = H
  const ctx = card.getContext("2d")!

  ctx.fillStyle = "#0c0c0e"
  ctx.fillRect(0, 0, W, H)

  const half = W / 2
  const imgH = H - 120

  // Before (left, full photo) and after (right, cutout on checkerboard).
  cover(ctx, input.original, 0, 0, half, imgH)
  ctx.save()
  ctx.beginPath()
  ctx.rect(half, 0, half, imgH)
  ctx.clip()
  ctx.fillStyle = "#18181c"
  ctx.fillRect(half, 0, half, imgH)
  const sq = 24
  ctx.fillStyle = "#222228"
  for (let y = 0; y < imgH / sq; y++) {
    for (let x = 0; x < half / sq; x++) {
      if ((x + y) % 2 === 0) ctx.fillRect(half + x * sq, y * sq, sq, sq)
    }
  }
  cover(ctx, input.cutout, half, 0, half, imgH)
  ctx.restore()

  ctx.fillStyle = "rgba(255,255,255,0.85)"
  ctx.font = "600 22px system-ui, sans-serif"
  ctx.fillText("BEFORE", 24, 40)
  ctx.fillText("AFTER", half + 24, 40)

  // Footer: what made it, and the measured proof.
  ctx.fillStyle = "#ffffff"
  ctx.font = "700 34px system-ui, sans-serif"
  ctx.fillText(input.title, 24, imgH + 52)
  ctx.fillStyle = "rgba(255,255,255,0.65)"
  ctx.font = "400 22px system-ui, sans-serif"
  ctx.fillText(input.stats, 24, imgH + 88)
  ctx.textAlign = "right"
  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.font = "600 20px system-ui, sans-serif"
  ctx.fillText("remove.free", W - 24, imgH + 88)

  return card
}
