"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { Crown, Shield, UserCircle } from "lucide-react";

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image?: string | null;
}

interface TeamTabProps {
  accountManager: TeamMember | null;
  assignedUsers: TeamMember[];
}

const ROLE_ICON: Record<string, React.ElementType> = {
  SUPER_ADMIN: Crown,
  REGIONAL_MANAGER: Shield,
  ICR: UserCircle,
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_EXECUTIVE: "HQ Executive",
  HQ_ANALYTICS: "HQ Analytics",
  REGIONAL_MANAGER: "Regional Manager",
  ICR: "ICR",
  INSTITUTION_CLIENT: "Institution Client",
  HR_MANAGER: "HR Manager",
  EMPLOYEE: "Employee",
};

export function TeamTab({ accountManager, assignedUsers }: TeamTabProps) {
  const regionalManagers = assignedUsers.filter((u) => u.role === "REGIONAL_MANAGER");
  const icrs = assignedUsers.filter((u) => u.role === "ICR");
  const others = assignedUsers.filter((u) => !["REGIONAL_MANAGER", "ICR"].includes(u.role));

  return (
    <div className="space-y-6">
      {/* Account Manager */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Account Manager</CardTitle>
        </CardHeader>
        <CardContent>
          {accountManager ? (
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-[#1E3A5F] text-white text-sm">
                  {getInitials(accountManager.name)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{accountManager.name ?? accountManager.email}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{accountManager.email}</p>
              </div>
              <Badge variant="outline" className="ml-auto bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/30 text-xs">
                Account Manager
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">No account manager assigned.</p>
          )}
        </CardContent>
      </Card>

      {/* Regional Managers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Regional Managers ({regionalManagers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {regionalManagers.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No regional managers assigned.</p>
          ) : (
            <div className="space-y-3">
              {regionalManagers.map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-xs">
                      {getInitials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{u.name ?? u.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ICRs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            ICRs ({icrs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {icrs.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No ICRs assigned.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {icrs.map((u) => (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-md bg-slate-50 dark:bg-slate-800/60">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-xs">
                      {getInitials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{u.name ?? u.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Other assigned users */}
      {others.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Other Assigned Users ({others.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {others.map((u) => (
                <div key={u.id} className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300 text-xs">
                      {getInitials(u.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{u.name ?? u.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{u.email}</p>
                  </div>
                  <Badge variant="outline" className="ml-auto text-xs">
                    {ROLE_LABEL[u.role] ?? u.role}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
