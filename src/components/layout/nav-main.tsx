import { type LucideIcon } from "lucide-react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavMainItem {
  title: string
  url: string
  icon: LucideIcon
  badge?: string
  description?: string
}

export function NavMain({ items }: { items: NavMainItem[] }) {
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold px-2">
        Workspaces
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isActive =
            item.url === "/"
              ? pathname === "/"
              : pathname.startsWith(item.url)

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={isActive}
                className="h-10 px-2.5 rounded-md transition-all"
              >
                <Link to={item.url} className="flex items-center gap-2.5">
                  <div
                    className={`flex size-6 shrink-0 items-center justify-center rounded-md transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 text-muted-foreground group-hover:text-foreground"
                    }`}
                  >
                    <item.icon className="size-3.5" />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0 text-left">
                    <span className="font-medium text-[13px] leading-tight truncate">
                      {item.title}
                    </span>
                    {item.description && (
                      <span className="text-[10px] text-muted-foreground truncate leading-tight">
                        {item.description}
                      </span>
                    )}
                  </div>
                  {item.badge && (
                    <span className="ml-auto text-[10px] font-medium uppercase px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                      {item.badge}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
