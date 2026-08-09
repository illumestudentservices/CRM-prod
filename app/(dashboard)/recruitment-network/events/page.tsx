import { db } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await db.event.findMany({
    where: { deletedAt: null },
    orderBy: { date: "desc" },
    include: {
      _count: { select: { participations: true, leads: true, expenses: true } },
    },
    take: 100,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {events.length} recruitment events
        </p>
        <Link href="/events/new" className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700">
          + New event
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Event</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Location</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Participations</th>
              <th className="text-left p-2">Leads</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t hover:bg-muted/50">
                <td className="p-2">
                  <Link href={`/events/${e.id}`} className="text-blue-600 hover:underline">
                    {e.name}
                  </Link>
                </td>
                <td className="p-2">{e.type}</td>
                <td className="p-2">{e.date.toISOString().slice(0, 10)}</td>
                <td className="p-2">{e.city}, {e.country}</td>
                <td className="p-2">{e.status}</td>
                <td className="p-2">{e._count.participations}</td>
                <td className="p-2">{e._count.leads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
