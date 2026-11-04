// Fluid Functionalism borderless additive surface depth & elevation tokens.
export const surfaces = {
  // Base substrate plane (where left & right sidebars reside)
  base: "bg-surface-1 text-sidebar-foreground",
  
  // Inset canvas surface (the elevated workspace without harsh 1px borders)
  inset: "bg-background text-foreground shadow-surface-3 rounded-2xl",
  
  // Elevated cards and floating panels
  raised: "bg-surface-2 text-card-foreground shadow-surface-1",
  
  // Sunken wells, inputs, and codeblocks
  sunken: "bg-surface-1 text-foreground/90 shadow-surface-1",
  
  // Overlays, modals, and popups
  overlay: "bg-surface-3/95 backdrop-blur-md text-popover-foreground shadow-surface-5",
  
  // 24px icon button rhythm (16px icon inside 24px button)
  iconRhythm: "size-6 shrink-0 flex items-center justify-center rounded-md transition-colors",
} as const
