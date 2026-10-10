# -*- coding: utf-8 -*-
"""
Build the import payload for a named subset of the Microsoft 365 roll.

    python scripts/build-additions.py <m365.csv> <dates.tsv> <out.json>

`dates.tsv` is "name<TAB>joining date<TAB>country?" — the shape a joining date
actually arrives in, pasted out of a message or a spreadsheet. Everything else
about the person comes from M365, which is the authority on who they are and
what they are called; the date is the one field it does not carry.

Only the people named in dates.tsv are emitted. Nobody is added because they
appear in the export.

★ DATES ARE READ STRICTLY AND CHECKED.

"30-Oct-24" and "7 May 2026" both appear in real input, so several formats are
accepted — but a date that does not parse stops the build rather than being
guessed at, and a date in the future or implausibly far past is reported.
Joining date drives leave entitlement: a year wrong here is a year of holiday
wrong, and silently.
"""
import csv
import io
import json
import re
import sys
from datetime import datetime

DATE_FORMATS = [
    "%d-%b-%y", "%d-%b-%Y", "%d %b %Y", "%d %B %Y",
    "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y",
]

REGION_BY_OFFICE = {
    "south asia": "South Asia", "southeast asia": "Southeast Asia",
    "west africa": "Africa", "east africa": "Africa", "africa": "Africa",
    "china": "China", "latin america": "Latin America",
    "middle east": "Middle East", "north america": "North America",
    "europe": "Europe",
}
REGION_BY_COUNTRY = {
    "india": "South Asia", "pakistan": "South Asia", "bangladesh": "South Asia",
    "sri lanka": "South Asia", "nepal": "South Asia",
    "nigeria": "Africa", "ghana": "Africa", "kenya": "Africa", "uganda": "Africa",
    "tanzania": "Africa", "cameroon": "Africa", "ethiopia": "Africa",
    "vietnam": "Southeast Asia", "philippines": "Southeast Asia",
    "indonesia": "Southeast Asia", "thailand": "Southeast Asia",
    "malaysia": "Southeast Asia", "singapore": "Southeast Asia",
    "china": "China",
    "brazil": "Latin America", "mexico": "Latin America", "colombia": "Latin America",
    "peru": "Latin America", "chile": "Latin America", "argentina": "Latin America",
    "united arab emirates": "Middle East", "uae": "Middle East",
    "saudi arabia": "Middle East", "egypt": "Middle East", "jordan": "Middle East",
    "canada": "North America", "united states": "North America",
    "united kingdom": "Europe", "australia": None,   # no CRM region for Oceania
}

# Same rule the earlier batch used: where the export names no manager, fall
# back to the region's manager if that region has one on record.
REGION_MANAGER = {
    "South Asia": "ILL-0014",
    "Africa": "ILL-0019",
    "China": "ILL-0021",
    "Southeast Asia": "ILL-0018",
}

CRM_DEPARTMENTS = {
    "management": "Leadership", "finance": "Finance",
    "marketing": "Marketing", "student recruitment": "Student Recruitment",
}

BLANK = {"", "-", "none", "null", "n/a"}
norm = lambda s: re.sub(r"[^a-z]", "", (s or "").lower())


def clean(v):
    s = (v or "").strip()
    return "" if s.lower() in BLANK else s


def parse_date(raw):
    s = " ".join(raw.replace("\n", " ").split()).strip().strip('"')
    for f in DATE_FORMATS:
        try:
            return datetime.strptime(s, f)
        except ValueError:
            continue
    return None


def main(m365_path, dates_path, out_path):
    raw = open(m365_path, "rb").read()
    users = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))

    wanted = []
    for line in open(dates_path, encoding="utf-8"):
        if not line.strip():
            continue
        parts = [p.strip() for p in line.rstrip("\n").split("\t")]
        name = parts[0]
        date_raw = parts[1] if len(parts) > 1 else ""
        country = parts[2] if len(parts) > 2 else ""
        wanted.append((name, date_raw, country))

    today = datetime.now()
    out, problems = [], []

    for name, date_raw, country in wanted:
        key = norm(name)
        hits = [
            u for u in users
            if norm(u.get("Display name")) == key
            or norm((u.get("First name") or "") + (u.get("Last name") or "")) == key
            or norm(u.get("First name")) == key
        ]
        if len(hits) != 1:
            problems.append(f"{name}: matched {len(hits)} M365 users — not added")
            continue
        u = hits[0]

        dt = parse_date(date_raw)
        if dt is None:
            problems.append(f"{name}: could not read the joining date {date_raw!r} — not added")
            continue
        if dt > today:
            problems.append(f"{name}: joining date {dt:%Y-%m-%d} is in the future — not added")
            continue
        if dt.year < 2015:
            problems.append(f"{name}: joining date {dt:%Y-%m-%d} looks wrong — not added")
            continue

        office = clean(u.get("Office"))
        m365_country = clean(u.get("Country or region"))
        region = REGION_BY_OFFICE.get(office.lower())
        src = "Office" if region else ""
        if not region:
            # The country supplied alongside the date wins over M365's, because
            # it was given deliberately for the people M365 left blank.
            for c, s in ((country, "given"), (m365_country, "M365 country")):
                if c and REGION_BY_COUNTRY.get(c.lower()):
                    region, src = REGION_BY_COUNTRY[c.lower()], s
                    break

        out.append({
            "email": clean(u.get("User principal name")).lower(),
            "firstName": clean(u.get("First name")),
            "lastName": clean(u.get("Last name")),
            "jobTitle": clean(u.get("Job title")) or "Team Member",
            "regionName": region,
            "_regionFrom": src or "(none)",
            "departmentName": CRM_DEPARTMENTS.get(clean(u.get("Department")).lower()),
            "employmentType": "FULL_TIME",
            "managerName": None,            # M365 carries no reporting line
            "regionManagerEmployeeId": REGION_MANAGER.get(region) if region else None,
            "startDate": dt.strftime("%Y-%m-%d"),
            "phone": None,
            "address": None,
            "gender": None,
        })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in p.items() if not k.startswith("_")} for p in out],
                  f, indent=1, ensure_ascii=False)

    print(f"{len(out)} of {len(wanted)} ready to import -> {out_path}\n")
    print(f"{'email':<34s} {'joined':<12s} {'region':<15s} {'via':<14s} manager")
    print("-" * 92)
    for p in sorted(out, key=lambda x: x["email"]):
        mgr = p["regionManagerEmployeeId"] or "(none)"
        print(f"{p['email']:<34s} {p['startDate']:<12s} "
              f"{(p['regionName'] or '(none)'):<15s} {p['_regionFrom']:<14s} {mgr}")
    if problems:
        print("\nNOT ADDED:")
        for pr in problems:
            print(f"  {pr}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
