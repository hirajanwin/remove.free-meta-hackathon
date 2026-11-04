import { describe, expect, it } from "vitest"
import { groupTrackedFrames, nearestTrackedFrame, visibleUnion } from "../sam-video"

const part = (objectId: string, frame: number) => ({
  objectId,
  frame,
  raster: new Uint8Array([1, 1, 1, 1]),
  width: 2,
  height: 2,
  left: 0,
  top: 0,
})

describe("groupTrackedFrames", () => {
  it("groups masks by frame and unions objects", () => {
    const result = groupTrackedFrames([part("0", 0), part("1", 0), part("0", 2)], 2, 2)
    expect(result.frames.map((f) => f.frame)).toEqual([0, 2])
    expect(result.frames[0].objects.length).toBe(2)
    expect(result.frames[0].union.every((v) => v === 255)).toBe(true)
    expect(result.objectIds).toEqual(["0", "1"])
  })

  it("handles no masks", () => {
    const result = groupTrackedFrames([], 4, 4)
    expect(result.frames).toEqual([])
    expect(result.objectIds).toEqual([])
  })
})

describe("visibleUnion", () => {
  it("excludes hidden objects", () => {
    const result = groupTrackedFrames([part("0", 0), part("1", 0)], 2, 2)
    const frame = result.frames[0]
    // Hiding everything yields an empty matte; hiding nothing returns the union itself.
    expect(visibleUnion(frame, new Set(["0", "1"])).every((v) => v === 0)).toBe(true)
    expect(visibleUnion(frame, new Set())).toBe(frame.union)
  })
})

describe("nearestTrackedFrame", () => {
  it("maps time proportionally to the tracked range", () => {
    const result = groupTrackedFrames([part("0", 0), part("0", 10), part("0", 20)], 2, 2)
    expect(nearestTrackedFrame(result, 0, 4)?.frame).toBe(0)
    expect(nearestTrackedFrame(result, 2, 4)?.frame).toBe(10)
    expect(nearestTrackedFrame(result, 3.9, 4)?.frame).toBe(20)
    expect(nearestTrackedFrame(groupTrackedFrames([], 2, 2), 1, 4)).toBeNull()
  })
})
