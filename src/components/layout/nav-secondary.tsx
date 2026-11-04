import * as React from "react"
import { type LucideIcon } from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavSecondaryItem {
  title: string
  url: string
  icon: LucideIcon
  badge?: string
  onClick?: () => void
}

export function NavSecondary({
  items,
  className,
  ...props
}: {
  items: NavSecondaryItem[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup className={className} {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild={!item.onClick}
                size="sm"
                onClick={item.onClick}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                {item.onClick ? (
                  <button type="button" className="flex items-center gap-2 w-full text-left">
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                    {item.badge && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                  </button>
                ) : (
                  <a
                    href={item.url}
                    target={item.url.startsWith("http") ? "_blank" : undefined}
                    rel={item.url.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="flex items-center gap-2 w-full"
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                    {item.badge && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                  </a>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
