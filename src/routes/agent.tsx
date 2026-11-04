import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  Bot,
  Terminal,
  Zap,
  Globe,
  ArrowRight,
  ShieldCheck,
  Check,
  ClipboardCopy,
  Code2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { InputCopy } from "@/components/ui/input-copy"
import { agentBrief } from "@/lib/recipe/agent-brief"
import { recipeFromControls } from "@/lib/recipe/studio-bridge"
import { useStudio } from "@/components/studio/studio-context"
import { getActiveModelId } from "@/lib/bg-removal"
import { CardGroup, Card } from "@/components/ui/card"

export const Route = createFileRoute("/agent")({
  component: AgentPage,
})

function AgentPage() {
  const { controls } = useStudio()
  const [briefCopied, setBriefCopied] = React.useState(false)
  const [testUrl, setTestUrl] = React.useState(
    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800"
  )
  const [testBg, setTestBg] = React.useState("transparent")

  const origin = typeof window !== "undefined" ? window.location.origin : "https://remove.free"

  const generatedUrl = `${origin}/?src=${encodeURIComponent(testUrl)}${
    testBg !== "transparent" ? `&bg=${encodeURIComponent(testBg)}` : ""
  }`

  // There is no server-side endpoint to curl — matting runs on-device, so local
  // automation is the CLI. (`/api/cutout` was documented here but never existed,
  // which sent people to a 404.) Flags match agent.mjs: positional inputs, --bg,
  // and --out as a directory.
  const cliCommand = `node agent.mjs "${testUrl}"${
    testBg !== "transparent" ? ` --bg ${testBg}` : ""
  } --out ./cutouts`

  const puppeteerCode = `// Drop-in background removal with remove.free (Headless Chrome / Puppeteer)
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

// Load target image via URL protocol
await page.goto('${generatedUrl}', { waitUntil: 'networkidle0' });

// Wait for neural matting to finish
await page.waitForFunction(() => {
  const status = document.querySelector('#status')?.textContent;
  return status && !status.startsWith('loading') && !status.startsWith('failed');
}, { timeout: 30000 });

// Extract full-resolution PNG data URL
const dataUrl = await page.evaluate(() => {
  const canvas = document.querySelector('canvas#cv');
  return canvas ? canvas.toDataURL('image/png') : null;
});

console.log('Cutout generated successfully!');
await browser.close();`

  const pythonPlaywrightCode = `# Autonomous agent background removal using Playwright (Python)
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('${generatedUrl}')

    # Wait for neural completion
    page.wait_for_function(
        "() => document.querySelector('#status')?.textContent.includes('·')"
    )

    data_url = page.evaluate("document.querySelector('#cv').toDataURL('image/png')")
    print("PNG Cutout generated!")
    browser.close()`

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full p-4 md:p-6 select-none">
      {/* Top Banner */}
      <div className="p-5 md:p-6 rounded-2xl bg-surface-2 shadow-surface-1 space-y-2">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-foreground" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Automation & Agent Protocol
          </h1>
          <Badge variant="secondary" dot={true} className="text-[10px]">
            Zero API Keys Required
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-3xl">
          The fastest on-device automation pipeline for AI agents, crawlers, and headless workflows.
          Zero rate limits, zero cloud server costs, and 100% private.
        </p>
      </div>

      {/* URL Protocol */}
      <div className="rounded-2xl bg-surface-2 p-5 md:p-6 space-y-5 shadow-surface-1">
        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-xl bg-surface-3 flex items-center justify-center text-foreground shadow-surface-1">
              <Globe className="size-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-semibold text-foreground">
                Universal URL Protocol
              </h2>
              <p className="text-xs text-muted-foreground">
                Pass any public image URL and background style directly via query parameters.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[11px]">
            Instant Execution
          </Badge>
        </div>

        {/* Live URL Builder */}
        <div className="space-y-3 p-4 rounded-xl bg-surface-1 shadow-surface-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Live URL Builder
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] text-muted-foreground font-medium">Source Image URL (?src=)</label>
              <input
                type="text"
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg bg-surface-2 text-xs font-mono outline-none shadow-surface-1 focus:ring-1 focus:ring-[color:var(--focus-ring,#6B97FF)]"
                placeholder="https://example.com/photo.jpg"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground font-medium">Background Color (&bg=)</label>
              <select
                aria-label="Test background"
                value={testBg}
                onChange={(e) => setTestBg(e.target.value)}
                className="w-full h-8 px-2 rounded-lg bg-surface-2 text-xs font-mono outline-none shadow-surface-1 focus:ring-1 focus:ring-[color:var(--focus-ring,#6B97FF)]"
              >
                <option value="transparent">transparent (default)</option>
                <option value="white">white (#ffffff)</option>
                <option value="black">black (#000000)</option>
                <option value="#3b82f6">#3b82f6 (blue)</option>
                <option value="#10b981">#10b981 (green)</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <InputCopy value={generatedUrl} size="compact" />
            </div>
            <Button
              size="compact"
              variant="secondary"
              onClick={() => window.open(generatedUrl, "_blank")}
              className="gap-1.5 shrink-0"
            >
              Test in Browser <ArrowRight className="size-3" />
            </Button>
          </div>
        </div>

        {/* Deterministic DOM Contract Cards with CardGroup */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Deterministic DOM Contract
          </h3>
          <CardGroup axis="xy" className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <Card index={0} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">canvas#cv</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Output HTMLCanvasElement containing the composited high-resolution cutout PNG.
              </p>
            </Card>
            <Card index={1} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">#status</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Status indicator. Reads <span className="font-mono text-foreground font-semibold">"WxH · Ns"</span> when complete, or <span className="font-mono text-destructive">"failed"</span>.
              </p>
            </Card>
            <Card index={2} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">button#dl</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Clickable DOM trigger for instant client-side file download.
              </p>
            </Card>
          </CardGroup>
        </div>

        {/* Meta Model API (BYOK) */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
            Meta Model API · Bring Your Own Key
          </h3>
          <CardGroup axis="xy" className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <Card index={0} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">SAM 3.1</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Type a noun phrase in Studio Controls to segment every match as
                a layer. A 1024px copy is sent; the full-resolution matte is
                computed locally and gated by the result.
              </p>
            </Card>
            <Card index={1} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">Muse Agent</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Muse Spark or Wonder turns a sentence into a validated plan,
                local tools execute it, and measured coverage verifies it —
                with a visible retry when SAM confidence is low.
              </p>
            </Card>
            <Card index={2} className="p-3.5 space-y-1 bg-surface-1 shadow-surface-1">
              <div className="font-mono font-semibold text-foreground">Muse Image</div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Generates backdrop scenes from text alone ($0.01). Your photo
                is never sent; the cutout is composited locally over the scene.
              </p>
            </Card>
          </CardGroup>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your key is stored only in your browser (session by default) and
            sent only to <span className="font-mono text-foreground">api.meta.ai</span>.
            No key? Everything local still works: BiRefNet/MODNet matting,
            SlimSAM click-select, and DINOv2 shift-click select-similar.
          </p>
        </div>

        {/* Copy for AI — a brief with a self-check in it */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-foreground">Copy for AI</div>
            <Button
              size="compact"
              variant="primary"
              onClick={() => {
                const brief = agentBrief({
                  recipe: recipeFromControls(controls, getActiveModelId()),
                  origin: window.location.origin,
                })
                void navigator.clipboard.writeText(brief).then(
                  () => setBriefCopied(true),
                  () => setBriefCopied(false)
                )
                window.setTimeout(() => setBriefCopied(false), 2000)
              }}
              className="gap-1.5"
            >
              {briefCopied ? <Check className="size-3.5 text-ok" /> : <ClipboardCopy className="size-3.5" />}
              {briefCopied ? "Copied" : "Copy brief"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            The current treatment as a self-contained brief: what it does, the
            recipe as JSON, the contract around it, and a verification step the
            agent runs to check its own work. A snippet tells an agent what to
            type; this tells it what finished looks like.
          </p>
        </div>

        {/* cURL CLI Snippet */}
        <div className="space-y-1.5">
          <InputCopy
            label="Local CLI (Node 20+, runs on-device):"
            value={cliCommand}
            size="default"
          />
        </div>

        {/* Puppeteer / Node.js Snippet */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">
            Node.js (Puppeteer):
          </div>
          <pre tabIndex={0} role="region" aria-label="Node.js Puppeteer snippet" className="p-4 rounded-xl bg-surface-1 text-[11px] font-mono text-foreground overflow-x-auto select-all shadow-surface-1">
            <code>{puppeteerCode}</code>
          </pre>
        </div>

        {/* Python Snippet */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-foreground">
            Python (Playwright):
          </div>
          <pre tabIndex={0} role="region" aria-label="Python Playwright snippet" className="p-4 rounded-xl bg-surface-1 text-[11px] font-mono text-foreground overflow-x-auto select-all shadow-surface-1">
            <code>{pythonPlaywrightCode}</code>
          </pre>
        </div>
      </div>

      {/* Cloudflare Edge Architecture */}
      <div className="p-5 rounded-2xl bg-surface-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-surface-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck className="size-4 text-ok" />
            100% Client-Side Neural Compute
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Unlike cloud APIs that charge per image and upload your photos to remote servers, remove.free runs completely inside the browser WebGPU. Zero server bills, zero data retention.
          </p>
        </div>
      </div>
    </div>
  )
}
