import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Search, ZapIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { type NavigationItem, navigations } from "@/lib/constants";
import { getAccessibleNavigationItems } from "@/lib/rbac";
import { cn } from "@/lib/utils";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { NavUser } from "./nav-user";
import { EnvironmentIndicator } from "./environment-indicator";
import { ScrollArea } from "../ui/scroll-area";

// ── Path helpers ───────────────────────────────────────────────────────────────

const isLeafActive = (
  pathname: string,
  itemPath: string,
  exact?: boolean,
): boolean =>
  pathname === itemPath || (!exact && pathname.startsWith(`${itemPath}/`));

const isChildExactlyActive = (
  pathname: string,
  item: NavigationItem,
): boolean => {
  if (!item.items?.length) return false;
  return item.items.some((child) =>
    child.items?.length
      ? isChildExactlyActive(pathname, child)
      : isLeafActive(pathname, child.url, child.exact),
  );
};

const isItemOrChildActive = (
  pathname: string,
  item: NavigationItem,
): boolean => {
  if (isLeafActive(pathname, item.url, item.exact)) return true;
  return (
    item.items?.some((child) => isItemOrChildActive(pathname, child)) ?? false
  );
};

// ── Search filter ──────────────────────────────────────────────────────────────

const filterNavItems = (
  items: NavigationItem[],
  query: string,
): NavigationItem[] => {
  if (!query.trim()) return items;
  const q = query.toLowerCase();
  return items.reduce((acc: NavigationItem[], item) => {
    const titleMatch = item.title.toLowerCase().includes(q);
    const filteredChildren = item.items ? filterNavItems(item.items, q) : [];
    if (titleMatch || filteredChildren.length > 0) {
      acc.push({
        ...item,
        items: filteredChildren.length > 0 ? filteredChildren : item.items,
      });
    }
    return acc;
  }, []);
};

// ── NavItem ────────────────────────────────────────────────────────────────────

interface NavItemProps {
  item: NavigationItem;
  pathname: string;
  searchActive?: boolean;
}

const NavItem = ({ item, pathname, searchActive = false }: NavItemProps) => {
  const { state, setOpen } = useSidebar();
  const navigate = useNavigate();
  const hasChildren = !!(item.items && item.items.length > 0);

  const isActive = hasChildren
    ? isChildExactlyActive(pathname, item)
    : isLeafActive(pathname, item.url, item.exact);

  const [isOpen, setIsOpen] = useState(
    () =>
      isActive ||
      (hasChildren && isItemOrChildActive(pathname, item)) ||
      searchActive,
  );

  // ── Leaf ──────────────────────────────────────────────────────────────────
  if (!hasChildren) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          tooltip={item.title}
          onClick={() => navigate({ to: item.url as any })}
          className={cn(
            "relative rounded-xl px-3 transition-all duration-150 group/btn",
            "h-11 group-data-[collapsible=icon]:!rounded-xl",
            // Idle
            !isActive &&
              "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent",
            // Active expanded — indigo pill + glow
            isActive && [
              "bg-sidebar-primary text-white font-semibold",
              "hover:bg-sidebar-primary/95",
              "shadow-[0_4px_14px_0_rgba(79,70,229,0.45)]",
            ],
            // Active collapsed — same pill, icon centred by CVA p-0 + justify-center
            isActive &&
              "group-data-[collapsible=icon]:bg-sidebar-primary group-data-[collapsible=icon]:shadow-[0_4px_14px_0_rgba(79,70,229,0.45)]",
          )}
        >
          {/* Left-edge bar — expanded only */}
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3.5px] h-6 rounded-r-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.6)] group-data-[collapsible=icon]:hidden" />
          )}

          {item.icon && (
            <item.icon
              className={cn(
                "size-[18px] shrink-0 transition-colors duration-150",
                isActive
                  ? "text-white"
                  : "text-sidebar-foreground/90 group-hover/btn:text-sidebar-accent-foreground",
              )}
              isActive={isActive}
            />
          )}

          <span className="text-[13.5px] tracking-tight whitespace-nowrap group-data-[collapsible=icon]:hidden">
            {item.title}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  // ── Parent / group ─────────────────────────────────────────────────────────
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => {
          if (state === "collapsed") {
            setOpen(true);
            setIsOpen(true);
          } else setIsOpen(!isOpen);
        }}
        tooltip={item.title}
        className={cn(
          "relative h-11 rounded-xl px-3 transition-all duration-150 group/btn",
          !isActive &&
            "text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent",
          isActive &&
            "bg-sidebar-accent/80 text-sidebar-accent-foreground font-medium",
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3.5px] h-6 rounded-r-full bg-sidebar-ring group-data-[collapsible=icon]:hidden" />
        )}

        <div className="flex items-center w-full gap-3 group-data-[collapsible=icon]:justify-center">
          {item.icon && (
            <item.icon
              className={cn(
                "size-[18px] shrink-0 transition-colors duration-150",
                isActive
                  ? "text-sidebar-ring"
                  : "text-sidebar-foreground/90 group-hover/btn:text-sidebar-accent-foreground",
              )}
              isActive={isActive}
            />
          )}
          <span className="text-[13.5px] tracking-tight flex-1 text-left whitespace-nowrap group-data-[collapsible=icon]:hidden">
            {item.title}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-300 group-data-[collapsible=icon]:hidden",
              isActive ? "text-sidebar-ring/80" : "text-sidebar-foreground/60",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </SidebarMenuButton>

      {/* Sub-items */}
      {isOpen && (
        <SidebarMenuSub
          className={cn(
            "ml-4 border-l pl-3 py-1 gap-0.5",
            isActive ? "border-sidebar-ring/30" : "border-sidebar-border/50",
          )}
        >
          {item.items!.map((child) => {
            const childActive = isLeafActive(pathname, child.url, child.exact);
            return (
              <SidebarMenuSubItem key={child.title}>
                <SidebarMenuSubButton
                  isActive={childActive}
                  onClick={() => navigate({ to: child.url as any })}
                  className={cn(
                    "relative h-9 rounded-lg px-3 transition-all duration-150 text-[13px] group/sub cursor-pointer",
                    !childActive &&
                      "text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent",
                    childActive && [
                      "bg-sidebar-primary text-white font-semibold",
                      "hover:bg-sidebar-primary/95",
                      "shadow-[0_2px_10px_0_rgba(79,70,229,0.35)]",
                    ],
                  )}
                >
                  {childActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-white/60" />
                  )}
                  {child.icon && (
                    <child.icon
                      className={cn(
                        "size-[15px] shrink-0 transition-colors",
                        childActive
                          ? "text-white"
                          : "text-sidebar-foreground/85 group-hover/sub:text-sidebar-accent-foreground",
                      )}
                      isActive={childActive}
                    />
                  )}
                  <span>{child.title}</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
};

// ── AppSidebar ─────────────────────────────────────────────────────────────────

export const AppSidebar = () => {
  const router = useRouterState();
  const pathname = router.location.pathname;
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: viewerAccess, isPending } = useViewerAccess();

  if (isPending) {
    return (
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader className="p-3">
          <div className="h-12 w-full animate-pulse rounded-xl bg-sidebar-accent" />
        </SidebarHeader>
        <SidebarContent>
          <div className="space-y-1.5 p-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-11 w-full animate-pulse rounded-xl bg-sidebar-accent/50"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </SidebarContent>
      </Sidebar>
    );
  }

  const visibleNavigations = getAccessibleNavigationItems(
    navigations,
    viewerAccess?.permissions ?? [],
  );

  const filteredNavigations = filterNavItems(visibleNavigations, searchQuery);
  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <SidebarHeader className="px-3 pt-3 pb-2.5 group-data-[collapsible=icon]:px-1.5 group-data-[collapsible=icon]:items-center">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Muftah Chemical PVT LTD (S-WASH)"
              onClick={() =>
                navigate({
                  to: (viewerAccess?.defaultLandingPath ?? "/dashboard") as any,
                })
              }
              className={cn(
                "group/logo rounded-xl transition-all duration-150",
                // Expanded: full-width row, subtle hover
                "h-11 px-2 hover:bg-sidebar-accent",
                "flex items-center gap-3",
                // Collapsed: shrink to a centred indigo pill, override ALL CVA size/padding
                "group-data-[collapsible=icon]:!size-9 group-data-[collapsible=icon]:!p-0",
                "group-data-[collapsible=icon]:!flex group-data-[collapsible=icon]:!items-center group-data-[collapsible=icon]:!justify-center",
                "group-data-[collapsible=icon]:bg-sidebar-primary group-data-[collapsible=icon]:hover:bg-sidebar-primary/90",
                "group-data-[collapsible=icon]:shadow-[0_4px_14px_rgba(79,70,229,0.55)]",
              )}
            >
              {/* Icon — always visible */}
              <div
                className={cn(
                  "shrink-0 flex items-center justify-center rounded-lg text-white transition-all",
                  "group-hover/logo:scale-105",
                  // Expanded: full indigo pill
                  "size-8 bg-sidebar-primary shadow-[0_4px_12px_rgba(79,70,229,0.45)] ring-1 ring-white/10",
                  // Collapsed: button IS the pill, so this div becomes icon-only, no bg
                  "group-data-[collapsible=icon]:size-5 group-data-[collapsible=icon]:bg-transparent",
                  "group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:ring-0",
                )}
              >
                <ZapIcon className="size-4" />
              </div>

              {/* Text — expanded only */}
              <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
                <span className="font-bold text-[14px] tracking-tight text-sidebar-accent-foreground">
                  Muftah Chemical PVT LTD (S-WASH)
                </span>
                <span className="text-[10.5px] font-medium mt-0.5 text-sidebar-ring/60">
                  Management System
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {viewerAccess?.role.slug !== "operator" && (
          <div className="relative group/search group-data-[collapsible=icon]:hidden mt-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-sidebar-foreground/70 transition-colors group-focus-within/search:text-sidebar-ring" />
            <Input
              type="search"
              placeholder="Quick find..."
              className="h-9 w-full pl-8 text-[12.5px] rounded-xl border shadow-none transition-all
                bg-sidebar-accent/70 border-sidebar-border
                text-sidebar-accent-foreground
                placeholder:text-sidebar-foreground/60
                focus-visible:border-sidebar-primary/60
                focus-visible:ring-1 focus-visible:ring-sidebar-primary/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </SidebarHeader>

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="mx-3 h-px bg-sidebar-border/60 group-data-[collapsible=icon]:mx-2" />

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <SidebarContent className="overflow-hidden">
        <ScrollArea className="h-full">
          <SidebarGroup className="px-2 py-2">
            <SidebarMenu className="gap-0.5">
              {filteredNavigations.length > 0 ? (
                filteredNavigations.map((item) => (
                  <NavItem
                    key={item.title}
                    item={item}
                    pathname={pathname}
                    searchActive={hasSearchQuery}
                  />
                ))
              ) : (
                <div className="px-3 py-10 text-center">
                  <div className="w-9 h-9 rounded-xl bg-sidebar-accent flex items-center justify-center mx-auto mb-3">
                    <Search className="size-4 text-sidebar-foreground/70" />
                  </div>
                  <p className="text-[12.5px] font-medium text-sidebar-foreground">
                    No results
                  </p>
                  <p className="mt-0.5 text-[11px] text-sidebar-foreground/60">
                    Try a different keyword
                  </p>
                </div>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </ScrollArea>
      </SidebarContent>

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="mx-3 h-px bg-sidebar-border/60 group-data-[collapsible=icon]:mx-2" />

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <SidebarFooter className="px-2 py-2 gap-2">
        <div className="px-1 group-data-[collapsible=icon]:hidden">
          <EnvironmentIndicator />
        </div>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
};
