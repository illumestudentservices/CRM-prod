"use client";

import * as React from "react";
import {
  ArrowRight,
  MessageSquare,
  UserCheck,
  Plus,
  FileText,
  Activity,
} from "lucide-react";
import { cn, formatRelative, getInitials } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Activity types matching what we store
const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  STAGE_CHANGE: ArrowRight,
  NOTE_ADDED: MessageSquare,
  ASSIGNED: UserCheck,
  CREATED: Plus,
  DOCUMENT_ADDED: FileText,
};

const ACTIVITY_COLORS: Record<string, string> = {
  STAGE_CHANGE: "bg-blue-100 text-blue-600",
  NOTE_ADDED: "bg-violet-100 text-violet-600",
  ASSIGNED: "bg-amber-100 text-amber-600",
  CREATED: "bg-green-100 text-green-600",
  DOCUMENT_ADDED: "bg-slate-100 text-slate-600",
};

export interface ActivityItem {
  id: string;
  type: string;
  description: string;
  createdAt: Date | string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

interface ActivityTimelineProps {
  activities: ActivityItem[];
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <Activity className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm text-slate-500">No activity yet</p>
        <p className="text-xs text-slate-400 mt-0.5">Activities will appear here as you update this lead.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {activities.map((activity, index) => {
        const Icon = ACTIVITY_ICONS[activity.type] ?? Activity;
        const iconColor = ACTIVITY_COLORS[activity.type] ?? "bg-slate-100 text-slate-600";
        const isLast = index === activities.length - 1;

        return (
          <div key={activity.id} className="flex gap-3">
            {/* Icon + connector line */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  iconColor
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
            </div>

            {/* Content */}
            <div className={cn("flex-1 min-w-0", !isLast && "pb-4")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-700 leading-snug">{activity.description}</p>
                <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0 mt-0.5">
                  {formatRelative(activity.createdAt)}
                </span>
              </div>

              {/* User info */}
              <div className="flex items-center gap-1.5 mt-1">
                <Avatar className="h-4 w-4">
                  {activity.user.image && (
                    <AvatarImage src={activity.user.image} alt={activity.user.name ?? ""} />
                  )}
                  <AvatarFallback className="text-[8px]">
                    {getInitials(activity.user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[11px] text-slate-500">{activity.user.name}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
