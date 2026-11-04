import { defineConfig, type Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serves .models/ during dev only.
 *
 * RobustVideoMatting's weights are 14.3 MiB — an order of magnitude more than
 * the entire rest of the deploy — and it is an opt-in model. Keeping the file
 * out of public/ stops Vite copying it into dist, so the shipped bundle stays
 * ~1.5 MiB and production loads it from VITE_RVM_URL instead.
 */
function devModelFiles(): Plugin {
  return {
    name: 'dev-model-files',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/models/')) return next()
        const rel = req.url.split('?')[0].replace(/^\/models\//, '')
        const file = resolve(process.cwd(), '.models', rel)
        if (!file.startsWith(resolve(process.cwd(), '.models'))) return next()
        try {
          const data = await readFile(file)
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(data.byteLength))
          res.end(data)
        } catch {
          next()
        }
      })
    },
  }
}

// Plain Vite SPA. No SSR, no nitro, no server bundle.
//
// The whole app is client-side WebGPU work, so there was never anything for a
// server to render. Building a static bundle means every page load is a static
// asset request — free and unlimited on the Cloudflare free plan — instead of a
// metered Function invocation with a 10 ms CPU ceiling.
//
// There is no server-side code at all: no SSR, no Pages Functions, no Worker.
// Every request is a static asset, and static asset requests are free and
// unlimited, so traffic volume cannot produce a bill or hit a quota.
export default defineConfig({
  server: {
    // 3000 by default so `pnpm dev` is predictable, but PORT wins. Nothing here
    // is pinned to an origin — there are no OAuth callbacks or webhooks, and the
    // weights are fetched cross-origin from Hugging Face — so a second instance
    // on another port is harmless, and refusing to move just collides with the
    // one already running.
    port: Number(process.env.PORT) || 3000,
  },
  resolve: {
    tsconfigPaths: true,
    // Selects onnxruntime-web's "extern wasm" builds instead of its default
    // "bundle" builds. The bundle variants make Vite statically resolve ORT's
    // internal `new URL('….wasm', import.meta.url)` and copy the 22.5 MiB binary
    // into dist/assets — 90% of Cloudflare's 25 MiB per-file static asset limit,
    // and the largest thing in the deploy.
    //
    // That copy was never used. transformers.js sets env.wasm.wasmPaths to
    // `https://cdn.jsdelivr.net/npm/onnxruntime-web@${versions.web}/dist/` before
    // ORT initialises (see its src/backends/onnx.js), so ORT always loaded the
    // runtime from there. Confirmed by deleting the file from a production build
    // and running a full cutout under `wrangler pages dev`.
    //
    // Letting the CDN default stand also means the version cannot drift — it is
    // interpolated from the installed package at runtime — and it is the only
    // way Safari works, since Safari needs the non-asyncify pair that was never
    // bundled at all.
    //
    // To serve the runtime first-party instead, mirror ORT's dist and set
    // VITE_ORT_WASM_BASE_URL; see ortWasmPaths() in src/lib/weights.ts.
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  build: {
    // Matches pages_build_output_dir in wrangler.jsonc.
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    tailwindcss(),
    devModelFiles(),
    // Generates src/routeTree.gen.ts from src/routes/. This is the file-based
    // routing half of TanStack — the client router, with no server framework.
    tanstackRouter({
      target: 'react',
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
      autoCodeSplitting: true,
    }),
    viteReact(),
  ],
})
