# -*- coding: utf-8 -*-
"""
Reconcile the CRM's staff against the Microsoft 365 user list.

    python scripts/reconcile-m365.py <m365.csv> <crm_state.tsv> [out.json]

M365 is treated as the roll: if somebody has a licensed mailbox they work
here, and if they do not, they probably do not. It is not, however, an HR
system — it carries no joining date, no employment type and no reporting line,
so it can correct a job title and a region but it cannot fill the fields that
actually matter for leave and approvals. The report separates the two.

`Office` is the useful column and the one the Zoho export did not have. It
names the region directly ("South Asia", "West Africa", "Latin America") where
Zoho only had a free-text department, and it covers people Zoho left blank.

`Department` is NOT a department in the CRM's sense. Most values are partner
institutions — the account a person looks after — so mapping it onto the CRM's
four departments would be wrong. Only Management and Finance are real.
"""
import csv
import io
import json
import re
import sys
from collections import Counter, defaultdict

# M365 Office -> CRM region. West and East Africa both roll up to Africa; the
# CRM has one Africa region and splitting it is an HR decision, not a data one.
REGION_BY_OFFICE = {
    "south asia": "South Asia",
    "southeast asia": "Southeast Asia",
    "west africa": "Africa",
    "east africa": "Africa",
    "africa": "Africa",
    "china": "China",
    "latin america": "Latin America",
    "middle east": "Middle East",
    "north america": "North America",
    "europe": "Europe",
}

# Fallback when Office is blank: the person's own country.
REGION_BY_COUNTRY = {
    "india": "South Asia", "pakistan": "South Asia", "bangladesh": "South Asia",
    "sri lanka": "South Asia", "nepal": "South Asia",
    "nigeria": "Africa", "ghana": "Africa", "kenya": "Africa", "uganda": "Africa",
    "tanzania": "Africa", "cameroon": "Africa", "zimbabwe": "Africa",
    "south africa": "Africa", "rwanda": "Africa", "ethiopia": "Africa",
    "vietnam": "Southeast Asia", "philippines": "Southeast Asia",
    "indonesia": "Southeast Asia", "thailand": "Southeast Asia",
    "malaysia": "Southeast Asia", "singapore": "Southeast Asia",
    "china": "China",
    "brazil": "Latin America", "mexico": "Latin America", "colombia": "Latin America",
    "peru": "Latin America", "chile": "Latin America", "argentina": "Latin America",
    "ecuador": "Latin America",
    "united arab emirates": "Middle East", "uae": "Middle East",
    "saudi arabia": "Middle East", "egypt": "Middle East", "jordan": "Middle East",
    "turkey": "Middle East", "iran": "Middle East",
    "canada": "North America", "united states": "North America", "usa": "North America",
    "united kingdom": "Europe", "ireland": "Europe", "france": "Europe",
    "germany": "Europe", "spain": "Europe", "italy": "Europe",
}

# The CRM's own four departments. Everything else in the M365 Department column
# is a partner institution and is deliberately ignored.
CRM_DEPARTMENTS = {
    "management": "Leadership",
    "leadership": "Leadership",
    "finance": "Finance",
    "marketing": "Marketing",
    "student recruitment": "Student Recruitment",
}

BLANK = {"", "-", "none", "null", "n/a"}


def clean(v):
    s = (v or "").strip()
    return "" if s.lower() in BLANK else s


def load_m365(path):
    raw = open(path, "rb").read()
    text = raw.decode("utf-8-sig", errors="replace")
    out = {}
    for r in csv.DictReader(io.StringIO(text)):
        email = clean(r.get("User principal name")).lower()
        if not email:
            continue
        office = clean(r.get("Office"))
        country = clean(r.get("Country or region"))
        region = REGION_BY_OFFICE.get(office.lower())
        region_src = "Office" if region else ""
        if not region and country:
            region = REGION_BY_COUNTRY.get(country.lower())
            region_src = "Country" if region else ""
        out[email] = {
            "email": email,
            "firstName": clean(r.get("First name")),
            "lastName": clean(r.get("Last name")),
            "displayName": clean(r.get("Display name")),
            "jobTitle": clean(r.get("Job title")),
            "m365Department": clean(r.get("Department")),
            "crmDepartment": CRM_DEPARTMENTS.get(clean(r.get("Department")).lower()),
            "office": office,
            "country": country,
            "city": clean(r.get("City")),
            "region": region,
            "regionSource": region_src,
        }
    return out


def load_crm(path):
    cols = ["employeeId", "email", "firstName", "lastName", "role", "jobTitle",
            "region", "department", "managerId", "startDate", "phone", "gender",
            "isActive"]
    out = {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < len(cols):
            continue
        rec = dict(zip(cols, parts))
        rec["email"] = rec["email"].lower()
        out[rec["email"]] = rec
    return out


def main(m365_path, crm_path, out_path=None):
    m365 = load_m365(m365_path)
    crm = load_crm(crm_path)

    only_m365 = sorted(set(m365) - set(crm))
    only_crm = sorted(set(crm) - set(m365))
    both = sorted(set(m365) & set(crm))

    print(f"Microsoft 365 licensed users : {len(m365)}")
    print(f"CRM employee records         : {len(crm)}")
    print(f"  in both                    : {len(both)}")
    print(f"  in M365 but NOT in the CRM : {len(only_m365)}")
    print(f"  in the CRM but NOT in M365 : {len(only_crm)}")

    # ── Updates M365 can make to records that already exist ────────────────
    updates = []
    for e in both:
        c, m = crm[e], m365[e]
        ch = {}
        if m["jobTitle"] and m["jobTitle"] != c["jobTitle"]:
            ch["jobTitle"] = {"from": c["jobTitle"], "to": m["jobTitle"]}
        if m["region"] and m["region"] != c["region"]:
            ch["region"] = {"from": c["region"] or "(none)", "to": m["region"],
                            "via": m["regionSource"]}
        # Department is only ever FILLED IN, never overwritten.
        #
        # M365's Department column says "Management" for fifteen people, which
        # is a statement about seniority rather than a department. Mapping it
        # through would have moved the finance team and two recruitment leads
        # into Leadership and thrown away the more accurate value the CRM
        # already held — a correction that makes the data worse.
        if m["crmDepartment"] and not c["department"]:
            ch["department"] = {"from": "(none)", "to": m["crmDepartment"]}
        # Names are corrected only when the CRM's is blank. M365 display names
        # are the authority for spelling, but overwriting a name HR typed is
        # not a data fix, it is a decision.
        if m["firstName"] and not c["firstName"]:
            ch["firstName"] = {"from": "", "to": m["firstName"]}
        if m["lastName"] and not c["lastName"]:
            ch["lastName"] = {"from": "", "to": m["lastName"]}
        if ch:
            updates.append({"employeeId": c["employeeId"], "email": e, "changes": ch})

    print(f"\nRecords M365 can correct     : {len(updates)}")
    field_counts = Counter(k for u in updates for k in u["changes"])
    for f, n in field_counts.most_common():
        print(f"    {n:3d}  {f}")

    # ── What is still missing, and which system owns it ────────────────────
    print("\n" + "=" * 64)
    print("  STILL MISSING AFTER APPLYING M365 — and M365 cannot supply it")
    print("=" * 64)
    missing = defaultdict(list)
    for e in both:
        c, m = crm[e], m365[e]
        if not c["managerId"]:
            missing["manager (no leave approver, nobody can assign them tasks)"].append(c["employeeId"])
        if not (m["region"] or c["region"]):
            missing["region"].append(c["employeeId"])
        if not c["startDate"]:
            missing["joining date (drives leave entitlement)"].append(c["employeeId"])
        if not c["phone"]:
            missing["phone"].append(c["employeeId"])
        if not c["gender"]:
            missing["gender (blocks maternity/paternity leave)"].append(c["employeeId"])
        if not (m["jobTitle"] or c["jobTitle"]):
            missing["job title"].append(c["employeeId"])
    for k in sorted(missing, key=lambda x: -len(missing[x])):
        v = missing[k]
        print(f"  {len(v):3d}  {k}")

    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({
                "updates": updates,
                "onlyInM365": [m365[e] for e in only_m365],
                "onlyInCrm": [crm[e] for e in only_crm],
                "missing": {k: v for k, v in missing.items()},
            }, f, indent=1, ensure_ascii=False)
        print(f"\nwritten: {out_path}")

    return only_m365, only_crm, m365, crm


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:4])
