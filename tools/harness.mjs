// Shared plumbing for the browser harnesses.
//
// Anything that needs a real GPU, real pointer events, or a page that is
// actually being painted belongs here rather than in a vitest file. That line
// is Paperlab's and it is the right one: a unit test that mocks WebGL proves
// the mock works.
//
// There is a second reason these exist, specific to how this project has been
// built. Every visual claim so far has been verified by driving the in-app
// browser by hand, which means the evidence lives in a transcript nobody else
// can re-run — and that pane suspends its rendering pipeline whenever it is
// hidden, which has repeatedly produced results that looked like product bugs
// and were not. A headless Chromium is never hidden, never throttled, and can
// be run by anyone with `pnpm test:<name>`.

import { spawn } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"

/**
 * Start the Vite dev server and wait for it to answer.
 *
 * The dev server rather than a preview of `dist`, because these harnesses are
 * meant to be run against working-tree code during development. `pnpm build`
 * is its own gate.
 */
export async function startServer(port = 5599) {
  const child = spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  })

  let log = ""
  child.stdout.on("data", (d) => {
    log += d
  })
  child.stderr.on("data", (d) => {
    log += d
  })

  const base = `http://localhost:${port}`
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1500) })
      if (res.ok) {
        return {
          base,
          stop: () => child.kill("SIGTERM"),
          log: () => log,
        }
      }
    } catch {
      // Not up yet.
    }
    await sleep(400)
  }

  child.kill("SIGKILL")
  throw new Error(`dev server did not start on ${port} within 60s:\n${log}`)
}

/**
 * Launch Chromium.
 *
 * Software WebGL under CI, where there is no GPU. SwiftShader is slow but
 * deterministic, which for a parity gate is the better trade anyway — the
 * point is that two implementations agree, not that they are fast.
 */
export async function launch(playwright) {
  const { chromium } = playwright
  return chromium.launch({
    args: process.env.CI
      ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
      : [],
  })
}

/** Console errors from the page, so a harness can fail on one it did not expect. */
export function collectErrors(page) {
  const errors = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => errors.push(String(err)))
  return errors
}

let failures = 0

export function check(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗"
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
  return ok
}

export function report(name) {
  if (failures > 0) {
    console.error(`\n${failures} ${name} check(s) FAILED`)
    process.exitCode = 1
  } else {
    console.log(`\nall ${name} checks pass`)
  }
  return failures
}
