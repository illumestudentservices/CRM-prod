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
  Calendar,
  FileText,
  Briefcase,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils";
import { NAV_PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/lib/permissions";
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
  { key: "students", label: "Students & Pipeline", href: "/students", icon: Users },
  { key: "sources", label: "Sources", href: "/sources", icon: Globe },
  { key: "institutions", label: "Institutions", href: "/institutions", icon: Building2 },
  { key: "analytics", label: "Analytics", href: "/analytics", icon: BarChart3 },
  { key: "events", label: "Events", href: "/events", icon: Calendar },
  { key: "reports", label: "Reports", href: "/reports", icon: FileText },
  { key: "hr", label: "HR & ERP", href: "/hr", icon: Briefcase },
  { key: "activity_log", label: "Activity Log", href: "/activity-log", icon: ShieldCheck },
  { key: "settings",    label: "Settings",     href: "/settings",    icon: Settings },
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
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen flex flex-col transition-all duration-300 ease-in-out",
          "bg-[#1E3A5F] border-r border-[#2a4a73]",
          collapsed ? "w-16" : "w-64"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center h-16 px-4 border-b border-[#2a4a73] shrink-0",
            collapsed ? "justify-center" : "gap-3"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Illume"
            className={cn(
              "object-contain shrink-0",
              collapsed ? "h-7 w-7" : "h-8 w-auto max-w-[130px]"
            )}
          />
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

        {/* Collapse Toggle */}
        <div className="px-2 py-2 border-t border-[#2a4a73]">
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
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/login" });
  };

  const handleSearch = (query: string) => {
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
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
      />
      <Topbar
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
          sidebarCollapsed ? "pl-16" : "pl-64"
        )}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
