# -*- coding: utf-8 -*-
"""
Match the asset register's custodian names to employee records.

    python scripts/match-asset-custodians.py <custodians.tsv> <staff.tsv> <out.json>

The IT register records who holds a device BY NAME, because when it was
imported the CRM had sixteen employees and the register named fifty-two.
Now that everyone has an account those names can become real assignments —
a foreign key with a date, rather than a string that nobody can query.

★ THE MATCHING IS DELIBERATELY TIMID.

A wrong match here is not a cosmetic error: it records that a particular
person is holding a particular laptop, which is the document an organisation
reaches for when a device goes missing. So only matches that are unambiguous
are emitted, and everything else is listed for a human.

Three tiers, and nothing below them:

  EXACT    the normalised full names are identical
  CONTAINS one full name sits inside the other, which is how
           "Cathy Luo" meets "Xiaohong (Cathy) Luo" and
           "Christina Ren SAIT" meets "Christina Ren"
  INITIAL  same surname and same first initial, and exactly one candidate

A surname match alone is NOT a tier. "Akindele Oyewuwo" and "Akindele
Afolalu" share a given name and nothing else; "Tran" is a surname and a given
name in the same register. Both would be matched by a looser rule and both
would be wrong.
"""
import json
import re
import sys
from collections import defaultdict

# Names the tiers below cannot reach, resolved by hand and listed here so the
# decision is reviewable rather than buried in a fuzzy threshold. Each is the
# same person beyond reasonable doubt: three single-character spelling slips in
# the register, and one where the same three words appear in a different order.
# A similarity score high enough to catch these automatically would also catch
# "Precious Okoro" / "Precious Okeke", who are two different people.
MANUAL = {
    "akindele oyewuwo": "Akindele Oyewuwuo",      # register drops a 'u'
    "aminat liasu": "Aminat Lisau",               # 'sa' transposed
    "kevin guevarara": "Kevin Guevarra",          # an extra 'a'
    "viet anh nguyen": "Anh Viet Nguyen",         # same words, reordered
}

NOT_PEOPLE = {
    "spare stock", "spare", "stock", "unassigned", "n/a", "na", "-",
    "office", "store", "storage", "it", "warehouse",
}


def norm(s):
    """Lowercase letters only, parenthesised nicknames kept as separate words."""
    s = (s or "").lower().replace("(", " ").replace(")", " ")
    return " ".join(re.sub(r"[^a-z ]", " ", s).split())


def tokens(s):
    return [t for t in norm(s).split() if len(t) > 1]


def main(cust_path, staff_path, out_path):
    custodians = []
    for line in open(cust_path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and parts[0].strip():
            custodians.append((parts[0].strip(), int(parts[1])))

    staff = []
    for line in open(staff_path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 3:
            staff.append({"employeeId": parts[0], "name": parts[1], "email": parts[2]})

    by_norm = defaultdict(list)
    for s in staff:
        by_norm[norm(s["name"])].append(s)

    matched, unmatched, ambiguous, skipped = [], [], [], []

    for name, devices in custodians:
        n = norm(name)
        if n in NOT_PEOPLE or not n:
            skipped.append((name, devices, "not a person"))
            continue

        # Tier 0 — resolved by hand, see MANUAL above.
        if n in MANUAL:
            hits = by_norm.get(norm(MANUAL[n]), [])
            if len(hits) == 1:
                matched.append({
                    "custodianName": name, "devices": devices, "tier": "MANUAL",
                    "employeeId": hits[0]["employeeId"], "employeeName": hits[0]["name"],
                    "email": hits[0]["email"],
                })
                continue
            unmatched.append((name, devices))
            continue

        # Tier 1 — identical once normalised.
        hits = by_norm.get(n, [])
        tier = "EXACT"

        # Tier 2 — one name inside the other. Covers a nickname in brackets and
        # a trailing site code like "SAIT".
        if not hits:
            tier = "CONTAINS"
            hits = [s for s in staff
                    if n and (n in norm(s["name"]) or norm(s["name"]) in n)]

        # Tier 3 — same surname AND same first initial, with exactly one
        # candidate. Surname alone is not enough; see the note at the top.
        if not hits:
            tier = "INITIAL"
            ct = tokens(name)
            if len(ct) >= 2:
                surname, initial = ct[-1], ct[0][0]
                hits = [s for s in staff
                        if (st := tokens(s["name"])) and len(st) >= 2
                        and st[-1] == surname and st[0][0] == initial]

        if len(hits) == 1:
            matched.append({
                "custodianName": name, "devices": devices, "tier": tier,
                "employeeId": hits[0]["employeeId"], "employeeName": hits[0]["name"],
                "email": hits[0]["email"],
            })
        elif len(hits) > 1:
            ambiguous.append((name, devices, [h["employeeId"] + " " + h["name"] for h in hits]))
        else:
            unmatched.append((name, devices))

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(matched, f, indent=1, ensure_ascii=False)

    dev_matched = sum(m["devices"] for m in matched)
    dev_unmatched = sum(d for _, d in unmatched)
    dev_skipped = sum(d for _, d, _ in skipped)
    dev_ambig = sum(d for _, d, _ in ambiguous)

    print(f"{len(custodians)} custodian name(s), {len(staff)} employees\n")
    print(f"  matched    {len(matched):3d} names  ({dev_matched} devices)")
    for t in ("EXACT", "CONTAINS", "INITIAL", "MANUAL"):
        n = [m for m in matched if m["tier"] == t]
        if n:
            print(f"      {t:<9s} {len(n)}")
            if t != "EXACT":
                for m in n:
                    print(f"          \"{m['custodianName']}\"  ->  {m['employeeId']} {m['employeeName']}")
    print(f"  not a person {len(skipped):1d} names  ({dev_skipped} devices)")
    for s, d, why in skipped:
        print(f"      {s} ({d})")
    print(f"  ambiguous  {len(ambiguous):3d} names  ({dev_ambig} devices)")
    for a, d, opts in ambiguous:
        print(f"      \"{a}\" ({d}) -> {', '.join(opts)}")
    print(f"  no match   {len(unmatched):3d} names  ({dev_unmatched} devices)")
    for u, d in unmatched:
        print(f"      \"{u}\" ({d} device{'s' if d != 1 else ''})")
    print(f"\nwritten: {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    main(*sys.argv[1:])
