"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  Globe,
  Building2,
  BarChart3,
  FileText,
  Briefcase,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Map,
  Handshake,
  ClipboardList,
  School as SchoolIcon,
  CheckSquare,
  Plane,
  ShieldAlert,
  BookOpen,
  MessageCircle,
  Trash2, UserRoundX, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils";
import { NAV_PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";
import { HelpWidget } from "@/components/layout/help-widget";
import { Topbar, type Breadcrumb } from "@/components/layout/topbar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Nav Config ─────────────────────────────────────────────────────────────

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "institutions", label: "Clients", href: "/institutions", icon: Building2 },
  { key: "students", label: "Students & Pipeline", href: "/students", icon: Users },
  { key: "recruitment_network", label: "Recruitment Network", href: "/recruitment-network", icon: Globe },
  // Stakeholders sidebar entry removed — schools/counsellors will be folded
  // into the Clients (Institution) detail as a tab. Page + API routes at
  // /stakeholders and /api/stakeholders/* remain live so the merge is a
  // straight lift-and-shift, not a rebuild.
  { key: "market_intelligence", label: "Market Intelligence", href: "/market-intelligence", icon: Map },
  { key: "field_operations", label: "Field Operations", href: "/field-operations", icon: ClipboardList },
  // Events retired as a top-level module per spec §6 (retire standalone Events)
  // — they live under Recruitment Network → Events. Old /events routes still
  // resolve (Field Ops links use them and there are drill-ins from other
  // modules); this just removes the sidebar entry.
  { key: "recruitment_planning", label: "Recruitment Planning", href: "/recruitment-planning", icon: Plane },
  { key: "forecasting", label: "Forecasting", href: "/forecasting", icon: TrendingUp },
  { key: "icr_transition", label: "ICR Transition", href: "/icr-transition", icon: UserRoundX },
  { key: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3 },
  { key: "reports", label: "Reports", href: "/reports", icon: FileText },
  { key: "tasks", label: "Tasks", href: "/tasks", icon: CheckSquare },
  { key: "hr", label: "HR & ERP", href: "/hr", icon: Briefcase },
  { key: "risk_compliance", label: "Risk & Compliance", href: "/risk-compliance", icon: ShieldAlert },
  { key: "knowledge", label: "Knowledge Base", href: "/knowledge", icon: BookOpen },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", icon: MessageCircle },
  { key: "activity_log", label: "Activity Log", href: "/activity-log", icon: ShieldCheck },
  { key: "settings",    label: "Settings",     href: "/settings",    icon: Settings },
  { key: "recycle_bin", label: "Recycle Bin",  href: "/recycle-bin", icon: Trash2 },
];

const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_EXECUTIVE: "HQ Executive",
  HQ_ANALYTICS: "HQ Analytics",
  REGIONAL_MANAGER: "Regional Manager",
  ICR: "ICR",
  INSTITUTION_CLIENT: "Institution",
  HR_MANAGER: "HR Manager",
  EMPLOYEE: "Employee",
  ACCOUNT_MANAGER: "Account Manager",
  ADMISSIONS_SUPPORT: "Admissions Support",
  VP_GLOBAL_SALES: "VP Global Sales",
};

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarInnerProps {
  role: Role;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  currentPath: string;
  onLogout?: () => void;
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  allowedNavKeys?: string[];
  /** Drawer state for viewports below lg, where the sidebar is off-canvas. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function SidebarInner({
  role,
  userName,
  userEmail,
  userImage,
  currentPath,
  onLogout,
  collapsed,
  onCollapsedChange,
  allowedNavKeys,
  mobileOpen,
  onMobileClose,
}: SidebarInnerProps) {
  const allowedItems = NAV_ITEMS.filter((item) => {
    if (allowedNavKeys) return allowedNavKeys.includes(item.key);
    // Fallback to static NAV_PERMISSIONS if not provided
    const permitted = NAV_PERMISSIONS[item.key] as Role[] | undefined;
    return permitted ? permitted.includes(role) : false;
  });

  const isActive = (href: string) => {
    if (href === "/dashboard")
      return currentPath === "/dashboard" || currentPath === "/";
    return currentPath.startsWith(href);
  };

  return (
    <TooltipProvider delayDuration={0}>
      {/* Backdrop — only rendered while the mobile drawer is open */}
      {mobileOpen && (
        <div
          onClick={onMobileClose}
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen flex flex-col transition-transform duration-300 ease-in-out lg:transition-all",
          "bg-[#1E3A5F] border-r border-[#2a4a73]",
          // Below lg the sidebar is a drawer: full 64 width, slid off-screen unless open.
          mobileOpen ? "translate-x-0 w-64" : "-translate-x-full w-64",
          collapsed ? "lg:w-16" : "lg:w-64",
          "lg:translate-x-0"
        )}
      >
        {/* Logo — the PNG has a baked-in white background, so we embrace that
            by presenting it as a small "logo tile" recessed into the sidebar
            surface. The inner ring + drop shadow give it depth so it reads as
            an intentional design element rather than a floating asset on the
            dark navy. */}
        <div
          className={cn(
            "flex items-center h-16 px-4 border-b border-[#2a4a73] shrink-0",
            collapsed ? "justify-center" : "gap-3"
          )}
        >
          <div
            className={cn(
              // White in BOTH themes, deliberately. The PNG carries a baked-in
              // white background, so a dark tile behind it does not darken the
              // logo — it only shows through the padding, drawing a black frame
              // around a white rectangle. `dark:bg-slate-900` did exactly that.
              "flex items-center justify-center rounded-lg bg-white",
              // Barely-there edge so the tile still reads as a surface rather
              // than a cut-out. The previous ring-slate-200/60 plus a
              // 0.35-alpha drop shadow was strong enough to look like a border
              // in its own right against the navy.
              "ring-1 ring-inset ring-black/5 shadow-sm",
              "transition-all duration-200",
              collapsed ? "h-9 w-9 p-1" : "h-10 px-2.5 py-1.5"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Illume"
              className={cn(
                "object-contain shrink-0 select-none",
                collapsed ? "h-6 w-6" : "h-6 w-auto max-w-[120px]"
              )}
              draggable={false}
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);

            if (collapsed) {
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center justify-center h-10 w-10 mx-auto rounded-lg transition-all duration-150",
                        active
                          ? "bg-[#0EA5E9] text-white shadow-lg shadow-[#0EA5E9]/20"
                          : "text-slate-300 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="sr-only">{item.label}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 h-10 px-3 rounded-lg transition-all duration-150 text-sm font-medium",
                  active
                    ? "bg-[#0EA5E9] text-white shadow-lg shadow-[#0EA5E9]/20"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{item.label}</span>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Collapse Toggle — desktop only; on mobile the drawer is full width */}
        <div className="hidden lg:block px-2 py-2 border-t border-[#2a4a73]">
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            className="flex items-center justify-center h-8 w-full rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-150"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-2" />
                <span className="text-xs font-medium">Collapse</span>
              </>
            )}
          </button>
        </div>

        {/* User Footer */}
        <div className="p-3 border-t border-[#2a4a73] shrink-0">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">
                  <Avatar className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-[#0EA5E9] transition-all">
                    <AvatarImage src={userImage ?? undefined} alt={userName} />
                    <AvatarFallback className="bg-[#0EA5E9] text-white text-xs">
                      {getInitials(userName)}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="font-medium">{userName}</p>
                <p className="text-xs opacity-75">{userEmail}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={userImage ?? undefined} alt={userName} />
                  <AvatarFallback className="bg-[#0EA5E9] text-white text-xs">
                    {getInitials(userName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">
                    {userName}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{userEmail}</p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="text-xs bg-white/10 text-slate-300 border-0 hover:bg-white/20 w-full justify-center"
              >
                {ROLE_LABELS[role]}
              </Badge>
              <button
                onClick={onLogout}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-150 text-sm"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}

// ─── AppShellClient ───────────────────────────────────────────────────────────

interface AppShellClientProps {
  children: React.ReactNode;
  role: Role;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  currentPath: string;
  breadcrumbs?: Breadcrumb[];
  notificationCount?: number;
  allowedNavKeys?: string[];
}

export function AppShellClient({
  children,
  role,
  userName,
  userEmail,
  userImage,
  currentPath,
  breadcrumbs = [],
  notificationCount = 0,
  allowedNavKeys,
}: AppShellClientProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Close the mobile drawer whenever navigation happens, otherwise it stays
  // open on top of the page the user just navigated to.
  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleSearch = (query: string) => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 dark:text-slate-100">
      <SidebarInner
        role={role}
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        currentPath={pathname || currentPath}
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        allowedNavKeys={allowedNavKeys}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <Topbar
        onMenuClick={() => setMobileOpen(true)}
        breadcrumbs={breadcrumbs}
        notificationCount={notificationCount}
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        onLogout={handleLogout}
        onSearch={handleSearch}
        sidebarCollapsed={sidebarCollapsed}
      />
      <main
        className={cn(
          "pt-16 min-h-screen transition-all duration-300 ease-in-out",
          // No left offset below lg — the sidebar is off-canvas there.
          "pl-0",
          sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"
        )}
      >
        <div className="p-4 sm:p-6">{children}</div>
      </main>

      {/* Sits outside <main> so it stays put when the page scrolls, and is
          rendered once for the whole shell rather than per screen. */}
      <HelpWidget />
    </div>
  );
}
