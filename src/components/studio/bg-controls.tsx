import * as React from "react"
import { motion } from "framer-motion"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { type BgMode } from "@/lib/bg-removal"
import { spring } from "@/lib/springs"
import {
  Check,
  Palette,
  Image as ImageIcon,
  Sparkles,
  Layers,
  Pipette,
} from "lucide-react"

interface BgControlsProps {
  bgMode: BgMode
  onChange: (mode: BgMode) => void
}

const colorPresets = [
  { name: "White", value: "#ffffff", border: true },
  { name: "Black", value: "#000000" },
  { name: "Slate", value: "#334155" },
  { name: "Red", value: "#ef4444" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Emerald", value: "#10b981" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Purple", value: "#a855f7" },
  { name: "Rose", value: "#f43f5e" },
]

const gradientPresets = [
  { id: "dark", name: "Studio", class: "bg-gradient-dark-studio" },
  { id: "sunset", name: "Sunset", class: "bg-gradient-sunset" },
  { id: "ocean", name: "Ocean", class: "bg-gradient-ocean" },
  { id: "cyberpunk", name: "Cyber", class: "bg-gradient-cyberpunk" },
  { id: "light", name: "Light", class: "bg-gradient-minimal-light" },
] as const

const tabModes: BgMode["type"][] = ["transparent", "color", "gradient", "blur", "image"]

export function BgControls({ bgMode, onChange }: BgControlsProps) {
  const [customHex, setCustomHex] = React.useState("#ffffff")
  const [blurAmount, setBlurAmount] = React.useState(16)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const selectedTabIndex = Math.max(0, tabModes.indexOf(bgMode.type))

  const handleCustomImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onChange({ type: "image", dataUrl: reader.result })
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleTabSelect = (index: number) => {
    const mode = tabModes[index]
    if (mode === "transparent") onChange({ type: "transparent" })
    if (mode === "color") onChange({ type: "color", color: customHex })
    if (mode === "gradient") onChange({ type: "gradient", style: "dark" })
    if (mode === "blur") onChange({ type: "blur", amount: blurAmount })
    if (mode === "image" && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3.5 bg-surface-2 rounded-xl shadow-surface-1">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Background Surface</span>
        <span className="font-mono lowercase text-muted-foreground">
          {bgMode.type}
        </span>
      </div>

      {/* Fluid Functionalism TabsSubtle with Sliding Active Pill */}
      <TabsSubtle
        selectedIndex={selectedTabIndex}
        onSelect={handleTabSelect}
        size="compact"
        className="w-full flex"
      >
        <TabsSubtleItem index={0} label="Alpha" />
        <TabsSubtleItem index={1} label="Color" />
        <TabsSubtleItem index={2} label="Gradient" />
        <TabsSubtleItem index={3} label="Blur" />
        <TabsSubtleItem index={4} label="Photo" />
      </TabsSubtle>

      {/* Tab Panels */}
      {bgMode.type === "transparent" && (
        <div className="flex items-center gap-2.5 pt-1 text-[12px] text-muted-foreground">
          <div className="size-5 rounded bg-checkered shrink-0 shadow-surface-1" />
          <span>High-definition transparent PNG with alpha channel.</span>
        </div>
      )}

      {bgMode.type === "color" && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {colorPresets.map((c) => {
              const isSelected =
                bgMode.type === "color" && bgMode.color.toLowerCase() === c.value.toLowerCase()

              return (
                <motion.button
                  key={c.value}
                  type="button"
                  whileTap={{ scale: 0.9 }}
                  transition={spring.fast}
                  onClick={() => {
                    setCustomHex(c.value)
                    onChange({ type: "color", color: c.value })
                  }}
                  className={`relative size-6 rounded-md shadow-surface-1 transition-all flex items-center justify-center cursor-pointer ${
                    isSelected ? "ring-2 ring-[color:var(--focus-ring,#6B97FF)] ring-offset-1 ring-offset-surface-2" : ""
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={c.name}
                  aria-label={`Color ${c.name}`}
                >
                  {isSelected && (
                    <Check
                      className={`size-3 ${
                        c.value === "#ffffff" ? "text-black" : "text-white"
                      }`}
                    />
                  )}
                </motion.button>
              )
            })}

            {/* Custom Color Eyedropper */}
            <label 
              className="relative size-6 rounded-md bg-surface-3 shadow-surface-1 flex items-center justify-center cursor-pointer hover:bg-surface-4 active:scale-95 transition-all duration-80 overflow-hidden"
              title="Custom Color"
            >
              <span className="sr-only">Choose Custom Color</span>
              <input
                type="color"
                value={customHex}
                onChange={(e) => {
                  setCustomHex(e.target.value)
                  onChange({ type: "color", color: e.target.value })
                }}
                className="absolute -top-4 -left-4 w-16 h-16 cursor-pointer opacity-0"
              />
              <Pipette className="size-3 text-muted-foreground" />
            </label>
          </div>
        </div>
      )}

      {bgMode.type === "gradient" && (
        <div className="grid grid-cols-5 gap-1.5 pt-1">
          {gradientPresets.map((g) => {
            const isSelected =
              bgMode.type === "gradient" && bgMode.style === g.id

            return (
              <motion.button
                key={g.id}
                type="button"
                whileTap={{ scale: 0.92 }}
                transition={spring.fast}
                onClick={() => onChange({ type: "gradient", style: g.id })}
                className={`h-7 rounded-md ${g.class} shadow-surface-1 flex items-center justify-center text-[10px] font-medium transition-all cursor-pointer ${
                  isSelected
                    ? "ring-2 ring-[color:var(--focus-ring,#6B97FF)] ring-offset-1 ring-offset-surface-2 shadow-sm"
                    : "opacity-85 hover:opacity-100"
                }`}
                title={g.name}
                aria-label={`Gradient ${g.name}`}
              >
                {isSelected && <Check aria-hidden="true" className="size-3 text-white drop-shadow" />}
              </motion.button>
            )
          })}
        </div>
      )}

      {bgMode.type === "blur" && (
        <div className="pt-1">
          <Slider
            min={4}
            max={48}
            step={2}
            value={[blurAmount]}
            onValueChange={([val]) => {
              setBlurAmount(val)
              onChange({ type: "blur", amount: val })
            }}
            label="Aperture Bokeh Blur"
            formatValue={(val) => `${val}px`}
            size="compact"
          />
        </div>
      )}

      {bgMode.type === "image" && (
        <div className="pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleCustomImage}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={() => fileInputRef.current?.click()}
            className="w-full text-xs h-8 gap-2 border-dashed"
          >
            <ImageIcon className="size-3.5" />
            Choose Background Photo...
          </Button>
        </div>
      )}
    </div>
  )
}
