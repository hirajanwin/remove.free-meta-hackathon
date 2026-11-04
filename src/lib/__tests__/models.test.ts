// The registry is small enough to look correct while being wrong in ways that
// only show up as a 214 MiB download or a silently degraded matte.

import { describe, it, expect } from "vitest"
import { MODELS, DEFAULT_MODEL_ID, defaultModelFor, getModel, variantFor } from "../models"

describe("defaultModelFor", () => {
  it("never sends a device without WebGPU the 214 MiB build", () => {
    // The actual bug: DEFAULT_MODEL_ID was a constant, so CPU visitors got
    // BiRefNet's fp32 export — thirty times the CPU default's download.
    const cpu = getModel(defaultModelFor("wasm"))
    const cpuBytes = variantFor(cpu, "wasm").bytes
    const birefnetOnCpu = variantFor(getModel("birefnet-lite"), "wasm").bytes

    expect(cpuBytes).toBeLessThan(birefnetOnCpu / 2)
    expect(cpuBytes).toBeLessThan(16 * 1024 * 1024)
  })

  it("does not default a CPU device onto a non-commercial model", () => {
    // Not a licence gate on the app — every model stays selectable — but the
    // DEFAULT should not quietly put a whole class of device on CC BY-NC.
    expect(getModel(defaultModelFor("wasm")).license.allowsCommercialUse).toBe(true)
    expect(getModel(defaultModelFor("webgpu")).license.allowsCommercialUse).toBe(true)
  })

  it("keeps the quality model where the GPU can run it", () => {
    expect(defaultModelFor("webgpu")).toBe(DEFAULT_MODEL_ID)
  })

  it("only ever names a model that exists", () => {
    for (const backend of ["webgpu", "wasm"] as const) {
      expect(() => getModel(defaultModelFor(backend))).not.toThrow()
    }
  })
})

describe("model registry", () => {
  it("has a variant with a size for every backend", () => {
    for (const model of MODELS) {
      for (const backend of ["webgpu", "wasm"] as const) {
        const v = variantFor(model, backend)
        expect(v, `${model.id}/${backend}`).toBeDefined()
        expect(v.bytes, `${model.id}/${backend} size`).toBeGreaterThan(0)
      }
    }
  })

  it("declares the real precision wherever dtype is a workaround", () => {
    // BiRefNet's WebGPU file is fp16 but must be REQUESTED as fp32, because the
    // filename already carries the suffix and transformers.js would otherwise
    // look for model_fp16_fp16.onnx. Reporting the argument as the precision
    // told users the download was twice the width it is.
    for (const model of MODELS) {
      for (const backend of ["webgpu", "wasm"] as const) {
        const v = variantFor(model, backend)
        if (v.modelFileName?.includes("fp16")) {
          expect(v.precision, `${model.id}/${backend}`).toBe("fp16")
        }
      }
    }
  })

  it("gives every model an activation and normalisation", () => {
    // BiRefNet emits logits; reading those straight as 0-255 saturated the
    // cutout to fully opaque. RMBG uses unit std where BiRefNet uses ImageNet
    // statistics, and swapping them silently degrades the matte.
    for (const model of MODELS) {
      expect(["sigmoid", "none"]).toContain(model.outputActivation)
      expect(model.processor.image_mean).toHaveLength(3)
      expect(model.processor.image_std).toHaveLength(3)
    }
  })

  it("attributes every model and marks the non-commercial one", () => {
    // RMBG's licence is attribution-bearing, so this is a licence condition
    // rather than a nicety.
    for (const model of MODELS) {
      expect(model.attribution.length).toBeGreaterThan(20)
      expect(model.license.id).toBeTruthy()
    }
    expect(getModel("rmbg-1.4").license.allowsCommercialUse).toBe(false)
  })
})
