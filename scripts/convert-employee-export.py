# -*- coding: utf-8 -*-
"""
Turn the Zoho People "Employee View" export into the JSON that
scripts/import-employees.mjs consumes.

    python scripts/convert-employee-export.py "<export.xlsx>" out.json

Kept separate from the importer on purpose. The mapping decisions below are
about THIS export — its column names, its "None" strings, its department
labels — and they do not belong in a script that writes to the production
database. Converting first also means the exact payload can be read and
checked before anything is created.

Nothing is invented. Where the export has no value the field is left null,
except job title, which the database requires: that falls back to the Zoho
role the person already holds in the export ("Team member"), not to a title
nobody gave them.
"""
import json
import re
import sys
from datetime import datetime

import openpyxl

BLANK = {"", "none", "-", "null", "n/a"}


def val(cell):
    if cell is None:
        return ""
    s = str(cell).strip()
    return "" if s.lower() in BLANK else s


# Department label in the export -> region in the CRM.
REGION_BY_DEPARTMENT = {
    "south asia - regional representation": "South Asia",
    "africa - regional representation": "Africa",
    "southeast asia - regional representation": "Southeast Asia",
    "china - regional representation": "China",
    "middle east - regional representation": "Middle East",
    "latin america - regional representation": "Latin America",
}

# ...and to a CRM department, which is a different idea from a region: the CRM
# has four (Finance, Leadership, Marketing, Student Recruitment) and the export
# uses the word for regional teams.
DEPARTMENT_BY_DEPARTMENT = {
    "operations": None,
    "management": "Leadership",
}

# Who to fall back to when the export names no manager, keyed by region. Taken
# from the live org chart, and only where that region actually has one: Latin
# America and the Middle East have no manager on record, so people there are
# left unassigned rather than pointed at somebody arbitrary.
REGION_MANAGER = {
    "South Asia": "ILL-0014",
    "Africa": "ILL-0019",
    "China": "ILL-0021",
    "Southeast Asia": "ILL-0018",
    # Set by the user on 2026-10-10, and standing: these two regions had no
    # manager on record, so anyone in them was being left with no leave
    # approver and no way to be assigned work.
    "Latin America": "ILL-0021",   # Annie Li
    "Middle East": "ILL-0010",     # Jamshid Mirzabekov
}

EMPLOYMENT_TYPE = {
    "permanent": "FULL_TIME",
    "full time": "FULL_TIME",
    "on contract": "CONTRACT",
    "contract": "CONTRACT",
    "intern": "INTERN",
    "part time": "PART_TIME",
}

GENDER = {"male": "MALE", "female": "FEMALE"}


def main(xlsx_path, out_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else "" for h in rows[0]]
    H = {h: i for i, h in enumerate(hdr)}

    def g(row, name):
        i = H.get(name)
        return val(row[i]) if i is not None and i < len(row) else ""

    out, skipped = [], []
    for row in rows[1:]:
        email = g(row, "Email address")
        first, last = g(row, "First Name"), g(row, "Last Name")
        if not email or not first or not last:
            skipped.append((email or "(no email)", "missing name or email"))
            continue

        if g(row, "Employee Status").lower() not in ("", "active"):
            skipped.append((email, "not Active in the export"))
            continue

        joined = g(row, "Date of Joining")
        if not joined:
            skipped.append((email, "no joining date — leave entitlement cannot be derived"))
            continue
        start = joined.split(" ")[0] if " " in joined else joined
        try:
            datetime.strptime(start, "%Y-%m-%d")
        except ValueError:
            skipped.append((email, f"unreadable joining date {joined!r}"))
            continue

        dept_raw = g(row, "Department").lower()
        region = REGION_BY_DEPARTMENT.get(dept_raw)
        crm_dept = DEPARTMENT_BY_DEPARTMENT.get(dept_raw)

        # A reporting manager comes through as "Nancy Doan 004" — the Zoho
        # employee number is appended to the name.
        mgr = re.sub(r"\s*\d+\s*$", "", g(row, "Reporting Manager")).strip()

        out.append({
            "email": email,
            "firstName": first,
            "lastName": last,
            # Required by the schema; the export leaves it blank for 31 people.
            "jobTitle": g(row, "Designation") or g(row, "Zoho Role") or "Team Member",
            "regionName": region,
            "departmentName": crm_dept,
            "employmentType": EMPLOYMENT_TYPE.get(g(row, "Employment Type").lower(), "FULL_TIME"),
            "managerName": mgr or None,
            "regionManagerEmployeeId": REGION_MANAGER.get(region) if region else None,
            "startDate": start,
            "phone": g(row, "Work Phone Number") or g(row, "Personal Mobile Number") or None,
            "address": g(row, "Present Address") or None,
            "gender": GENDER.get(g(row, "Gender").lower()),
        })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)

    print(f"{len(out)} record(s) written to {out_path}")
    if skipped:
        print(f"{len(skipped)} row(s) skipped:")
        for e, why in skipped:
            print(f"   {e} — {why}")

    named = sum(1 for p in out if p["managerName"])
    byregion = sum(1 for p in out if not p["managerName"] and p["regionManagerEmployeeId"])
    neither = sum(1 for p in out if not p["managerName"] and not p["regionManagerEmployeeId"])
    print(f"\nmanager named: {named}   by region: {byregion}   none: {neither}")
    print(f"with a region: {sum(1 for p in out if p['regionName'])}")
    print(f"job title from Designation: {sum(1 for p in out if p['jobTitle'] not in ('Team member','Team Member'))}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
