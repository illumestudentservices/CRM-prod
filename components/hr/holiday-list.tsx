"use client";

/**
 * The public holidays that apply to the signed-in person, to read.
 *
 * `GET /api/hr/holidays` has always answered any signed-in user, returning the
 * global holidays plus their own region's. The only screen built on it is the
 * HR tab's HolidayManager — which lives on /hr, and an EMPLOYEE is redirected
 * off /hr to their own profile. So the data was reachable and the calendar was
 * not: an employee's sole view was a dashboard box listing the next 60 days.
 *
 * Deliberately read-only. Creating and deleting holidays stays with HR, where
 * POST and DELETE already require it; this is the same list without the
 * controls.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Globe, MapPin } from "lucide-react";

interface Holiday {
  id: string;
  name: string;
  date: string;
  description: string | null;
  isGlobal: boolean;
  region: { id: string; name: string } | null;
}

function formatHolidayDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-CA", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

/** Midnight today, so a holiday falling today still counts as upcoming. */
function isUpcoming(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) >= today;
}

export function HolidayList() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hr/holidays");
        const data = await res.json();
        setHolidays(data.holidays ?? []);
      } catch {
        setHolidays([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const upcoming = holidays.filter((h) => isUpcoming(h.date));
  const past = holidays.filter((h) => !isUpcoming(h.date));

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarDays className="h-4 w-4" /> Public Holidays
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {loading && <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>}

        {/*
          The empty state names who can fix it. "No holidays" on its own reads
          as a broken page, and the holiday table is in fact empty — nobody has
          loaded a calendar yet, which is an HR task and not something the
          person reading this can do.
        */}
        {!loading && holidays.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No public holidays have been added yet. HR maintains this calendar.
          </p>
        )}

        {upcoming.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border text-sm">
            <div className="min-w-0">
              <p className="font-medium">{h.name}</p>
              <p className="text-xs text-muted-foreground">{formatHolidayDate(h.date)}</p>
              {h.description && <p className="text-xs text-muted-foreground truncate max-w-[420px]">{h.description}</p>}
            </div>
            <Badge variant="outline" className="shrink-0 gap-1">
              {h.isGlobal
                ? <><Globe className="h-3 w-3" /> All regions</>
                : <><MapPin className="h-3 w-3" /> {h.region?.name ?? "Region"}</>}
            </Badge>
          </div>
        ))}

        {past.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-medium text-muted-foreground mb-2">Earlier this year</p>
            {past.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 p-2 text-sm text-muted-foreground">
                <span className="truncate">{h.name}</span>
                <span className="text-xs shrink-0">{formatHolidayDate(h.date)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
