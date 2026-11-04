#!/usr/bin/env node
// Mirror model weights from Hugging Face into the R2 bucket.
//
// Run once per model version. Weights are immutable, so this is not part of the
// normal build — re-run it only when adding a model or bumping a revision.
//
//   node scripts/sync-weights.mjs --bucket remove-free-weights
//   node scripts/sync-weights.mjs --bucket remove-free-weights --model rmbg-1.4
//   node scripts/sync-weights.mjs --bucket remove-free-weights --dry-run
//
// Resulting layout, which src/lib/weights.ts resolves against:
//   <model-id>/<backend>/config.json
//   <model-id>/<backend>/preprocessor_config.json
//   <model-id>/<backend>/onnx/<file>.onnx
//
// Mirrored per backend, not just per model, because a model may need a
// different export for each: BiRefNet's WebGPU path uses a graph re-exported to
// fit WebGPU's storage-buffer limits, which the stock export exceeds.

import { execFile } from "node:child_process"
import { mkdir, writeFile, stat } from "node:fs/promises"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { join } from "node:path"

const run = promisify(execFile)

// Kept in sync with src/lib/models.ts by hand. Duplicated rather than imported
// because this is a plain node script and models.ts is TypeScript.
const MODELS = [
  {
    id: "modnet",
    backends: {
      webgpu: { repo: "Xenova/modnet", onnx: ["model_fp16.onnx"] },
      wasm: { repo: "Xenova/modnet", onnx: ["model_quantized.onnx"] },
    },
  },
  {
    id: "birefnet-lite",
    backends: {
      // WebGPU-constrained re-export; the stock graph cannot run on WebGPU.
      webgpu: { repo: "jiabins0303/birefnet-lite-1024-webgpu", onnx: ["model_fp16.onnx"] },
      wasm: { repo: "onnx-community/BiRefNet_lite-ONNX", onnx: ["model.onnx"] },
    },
  },
  {
    id: "rmbg-1.4",
    backends: {
      webgpu: { repo: "briaai/RMBG-1.4", onnx: ["model_fp16.onnx"] },
      wasm: { repo: "briaai/RMBG-1.4", onnx: ["model_quantized.onnx"] },
    },
  },
]

const METADATA = ["config.json", "preprocessor_config.json"]

/**
 * Raw ONNX files that are not Hugging Face repos.
 *
 * RobustVideoMatting ships only as a GitHub release asset, and GitHub sends no
 * Access-Control-Allow-Origin on those, so a browser cannot fetch it directly.
 * It has to be mirrored somewhere we control; point VITE_RVM_URL at the result.
 */
const RAW_MODELS = [
  {
    key: "rvm/rvm_mobilenetv3_fp32.onnx",
    url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
  },
]

function parseArgs(argv) {
  const args = { bucket: null, model: null, dryRun: false, revision: "main" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--bucket") args.bucket = argv[++i]
    else if (a === "--model") args.model = argv[++i]
    else if (a === "--revision") args.revision = argv[++i]
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--help" || a === "-h") args.help = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help || (!args.bucket && !args.dryRun)) {
  console.log(
    `Usage: node scripts/sync-weights.mjs --bucket <r2-bucket> [--model <id>] [--revision <rev>] [--dry-run]`
  )
  process.exit(args.help ? 0 : 1)
}

const selected = args.model
  ? MODELS.filter((m) => m.id === args.model)
  : MODELS

if (selected.length === 0) {
  console.error(
    `No model matched "${args.model}". Known: ${MODELS.map((m) => m.id).join(", ")}`
  )
  process.exit(1)
}

const workDir = join(tmpdir(), "remove-free-weights")

async function download(url, dest) {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
  return buf.byteLength
}

async function upload(bucket, key, file) {
  // --remote targets the real bucket rather than the local dev simulation.
  await run("npx", [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    file,
    "--remote",
  ])
}

function mib(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

let totalBytes = 0

const jobs = []
for (const model of selected) {
  for (const [backend, spec] of Object.entries(model.backends)) {
    jobs.push({ modelId: model.id, backend, ...spec })
  }
}

for (const job of jobs) {
  const base = `https://huggingface.co/${job.repo}/resolve/${args.revision}`
  const prefix = `${job.modelId}/${job.backend}`
  const dir = join(workDir, job.modelId, job.backend)
  await mkdir(join(dir, "onnx"), { recursive: true })

  console.log(`\n${prefix}  <-  ${job.repo}@${args.revision}`)

  const files = [
    ...METADATA.map((f) => ({ remote: `${base}/${f}`, key: `${prefix}/${f}`, local: join(dir, f) })),
    ...job.onnx.map((f) => ({
      remote: `${base}/onnx/${f}`,
      key: `${prefix}/onnx/${f}`,
      local: join(dir, "onnx", f),
    })),
  ]

  for (const f of files) {
    let bytes
    try {
      const existing = await stat(f.local).catch(() => null)
      if (existing) {
        bytes = existing.size
        console.log(`  cached   ${f.key.padEnd(44)} ${mib(bytes)}`)
      } else {
        bytes = await download(f.remote, f.local)
        console.log(`  fetched  ${f.key.padEnd(44)} ${mib(bytes)}`)
      }
    } catch (err) {
      console.error(`  FAILED   ${f.key}: ${err.message}`)
      process.exitCode = 1
      continue
    }

    totalBytes += bytes

    if (args.dryRun) {
      console.log(`  would put -> ${args.bucket ?? "<bucket>"}/${f.key}`)
      continue
    }

    try {
      await upload(args.bucket, f.key, f.local)
      console.log(`  uploaded ${f.key}`)
    } catch (err) {
      console.error(`  UPLOAD FAILED ${f.key}: ${err.message}`)
      process.exitCode = 1
    }
  }
}

for (const raw of RAW_MODELS) {
  const local = join(workDir, raw.key.replace(/\//g, "_"))
  console.log(`\n${raw.key}  <-  ${raw.url.split("/").slice(-1)[0]}`)
  try {
    const existing = await stat(local).catch(() => null)
    const bytes = existing ? existing.size : await download(raw.url, local)
    totalBytes += bytes
    console.log(`  ${existing ? "cached  " : "fetched "} ${mib(bytes)}`)
    if (args.dryRun) {
      console.log(`  would put -> ${args.bucket ?? "<bucket>"}/${raw.key}`)
    } else {
      await upload(args.bucket, raw.key, local)
      console.log(`  uploaded ${raw.key}`)
    }
  } catch (err) {
    console.error(`  FAILED ${raw.key}: ${err.message}`)
    process.exitCode = 1
  }
}

console.log(
  `\nTotal ${mib(totalBytes)} across ${jobs.length} model/backend pair(s).` +
    ` R2 free tier includes 10 GB-month of storage.`
)
if (args.dryRun) console.log("Dry run — nothing uploaded.")
