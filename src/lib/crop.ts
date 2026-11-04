// Subject-aware cropping.
//
// The crop is centred on the subject's alpha bounds, not the image centre:
// a product shot cropped to 1:1 for a marketplace should frame the product,
// wherever it sits in the frame. Pure rectangle math; tested.

export type CropAspect = "none" | "1:1" | "4:5" | "3:2" | "16:9"

export const CROP_ASPECTS: Array<{ id: CropAspect; label: string; ratio: number | null }> = [
  { id: "none", label: "Off", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "3:2", label: "3:2", ratio: 3 / 2 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Largest rectangle of `aspect` (w/h) centred on `focus` (the subject
 * bounds when known, else the frame centre), clamped inside the frame.
 */
export function cropRect(
  frameW: number,
  frameH: number,
  aspect: number,
  focus: Rect | null,
  margin = 1.08
): Rect {
  const cx = focus ? focus.x + focus.w / 2 : frameW / 2
  const cy = focus ? focus.y + focus.h / 2 : frameH / 2

  // Start from the focus size (with a little air), then fit the aspect.
  let w = focus ? focus.w * margin : frameW
  let h = focus ? focus.h * margin : frameH
  if (w / h > aspect) h = w / aspect
  else w = h * aspect

  // Never larger than the frame: shrink preserving aspect.
  if (w > frameW) {
    w = frameW
    h = w / aspect
  }
  if (h > frameH) {
    h = frameH
    w = h * aspect
  }

  const x = Math.min(Math.max(0, cx - w / 2), frameW - w)
  const y = Math.min(Math.max(0, cy - h / 2), frameH - h)
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  }
}
