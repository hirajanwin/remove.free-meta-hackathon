import * as React from "react"
import { Cpu, ShieldCheck, Sparkles, CheckCircle2 } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"

export function NavUser() {
  const [hasWebGPU, setHasWebGPU] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    if (typeof navigator !== "undefined") {
      setHasWebGPU(Boolean((navigator as any).gpu))
    }
  }, [])

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className="cursor-default border border-border/60 bg-muted/40 hover:bg-muted/60 p-2.5 rounded-xl flex items-center gap-3 transition-colors"
        >
          <div className="flex size-9 items-center justify-center rounded-lg bg-ok/10 text-ok border border-ok/20 shrink-0">
            {hasWebGPU ? (
              <Sparkles className="size-4 animate-pulse" />
            ) : (
              <Cpu className="size-4" />
            )}
          </div>
          <div className="grid flex-1 text-left text-xs leading-tight">
            <span className="truncate font-semibold text-foreground flex items-center gap-1.5">
              {hasWebGPU ? "WebGPU Engine" : "WASM Engine"}
              <CheckCircle2 className="size-3 text-ok" />
            </span>
            <span className="truncate text-[11px] text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="size-3 text-ok" />
              100% Local · Zero Uploads
            </span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
