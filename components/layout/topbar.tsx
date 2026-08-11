"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Search, ChevronRight, User, Settings, LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface TopbarProps {
  breadcrumbs?: Breadcrumb[];
  notificationCount?: number;
  userName: string;
  userEmail: string;
  userImage?: string | null;
  onLogout?: () => void;
  onSearch?: (query: string) => void;
  sidebarCollapsed?: boolean;
  onMenuClick?: () => void;
}

export function Topbar({
  breadcrumbs = [],
  notificationCount = 0,
  userName,
  userEmail,
  userImage,
  onLogout,
  onSearch,
  sidebarCollapsed = false,
  onMenuClick,
}: TopbarProps) {
  const [searchQuery, setSearchQuery] = React.useState("");

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 h-16 bg-white border-b border-slate-200",
        "dark:bg-slate-900 dark:border-slate-800",
        "flex items-center justify-between gap-4 px-4 sm:px-6",
        "transition-all duration-300 ease-in-out",
        // The sidebar is off-canvas below lg, so the bar spans the full width there.
        "left-0",
        sidebarCollapsed ? "lg:left-16" : "lg:left-64"
      )}
    >
      {/* Mobile menu toggle — sidebar is a drawer below lg */}
      <button
        onClick={onMenuClick}
        className="lg:hidden -ml-1 p-2 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors shrink-0"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Left: Breadcrumbs */}
      <nav className="hidden sm:flex items-center gap-1 min-w-0 flex-shrink">
        {breadcrumbs.length > 0 ? (
          <ol className="flex items-center gap-1">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex items-center gap-1">
                  {index > 0 && (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600 shrink-0" />
                  )}
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="text-sm text-slate-500 hover:text-[#1E3A5F] dark:text-slate-400 dark:hover:text-slate-100 transition-colors truncate max-w-[120px]"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={cn(
                        "text-sm truncate max-w-[160px]",
                        isLast
                          ? "font-semibold text-slate-900 dark:text-slate-100"
                          : "text-slate-500 dark:text-slate-400"
                      )}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Illume Student Advisory Services</span>
        )}
      </nav>

      {/* Center: Global Search */}
      <form
        onSubmit={handleSearchSubmit}
        className="flex-1 max-w-md mx-auto hidden md:block"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <Input
            type="search"
            placeholder="Search students, institutions..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-9 h-9 bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:ring-[#1E3A5F] placeholder:text-slate-400 w-full"
          />
        </div>
      </form>

      {/* Right: Theme toggle + Notifications + User */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Theme toggle — light / system / dark segmented control */}
        <ThemeToggle className="hidden sm:inline-flex" />

        {/* Notification Bell */}
        <button
          className="relative flex items-center justify-center h-9 w-9 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#EF4444] text-[9px] font-bold text-white leading-none">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </button>

        {/* User Avatar Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:bg-slate-800 transition-colors outline-none"
              aria-label="User menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarImage src={userImage ?? undefined} alt={userName} />
                <AvatarFallback className="bg-[#1E3A5F] text-white text-xs">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 hidden sm:block max-w-[120px] truncate">
                {userName}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{userName}</p>
                <p className="text-xs text-slate-500 font-normal">{userEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center gap-2 cursor-pointer">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onLogout}
              className="flex items-center gap-2 text-[#EF4444] focus:text-[#EF4444] focus:bg-[#EF4444]/10 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
