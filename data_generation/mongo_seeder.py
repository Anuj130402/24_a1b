"""
CareConnect — MongoDB seeder (Assignment 2 revision)

Rewritten from the Assignment 1 version to fix four defects. See
docs/handover_note.md for the evidence behind each.

  D1 / C1  Every clinic_id, patient_id and appointment_id was a fresh
           uuid4() that matched nothing in PostgreSQL, so every review
           and catalog was orphaned. We now read the real identifiers
           out of PostgreSQL first and seed against them.

  D2 / C2  datetime.now() is timezone-naive, and PyMongo stores a naive
           datetime as though it were already UTC. On a UTC+5:30 machine
           that put every ping 5.5 hours in the FUTURE; west of UTC it
           puts them in the past, where the TTL index deletes the whole
           collection within a minute of seeding. Now timezone-aware.

  D3 / C3  Pings were stamped within the last 119 minutes against a
           7200s TTL, so the data evaporated ~2h after seeding. Now
           spread over 23 hours against the 24h TTL set in
           mongo/04_a2_additions.js.

  D4 / C4  `active` was randomised per ping, so the same nurse was both
           active and inactive. It is now a property of the nurse and
           copied onto their pings, which keeps A1's pipeline filter
           `query: {active: true}` working unchanged.

  D10/ C2  No random seed, unlike postgres_seeder.py. Now deterministic.

Also: A1 scattered every ping around IIIT-H while postgres_seeder.py
scatters clinics across several Indian metros, so almost no clinic had a
nurse within 5km and the map was empty for nearly every origin. Nurses
are now anchored to real clinic coordinates.

Usage:
    python data_generation/mongo_seeder.py

    CARECONNECT_DSN="dbname=careconnect host=localhost user=postgres" \
    MONGO_URI="mongodb://localhost:27017/" \
        python data_generation/mongo_seeder.py
"""

import os
import random
from datetime import datetime, timedelta, timezone

import psycopg2
from faker import Faker
from pymongo import MongoClient

# ----------------------------------------------------------------- config

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME   = os.environ.get("MONGO_DB", "careconnect_db")
DSN       = os.environ.get("CARECONNECT_DSN", "dbname=careconnect")

SEED            = 20250401          # same seed postgres_seeder.py uses
NURSE_COUNT     = 40
PING_TOTAL      = 500_000           # assignment floor
PING_WINDOW_MIN = 23 * 60           # against the 24h TTL
CATALOG_TOTAL   = 1_000
BATCH           = 10_000

SPECIALTIES = ["Cardiology", "Dermatology", "Pediatrics",
               "Neurology", "General Practice", "Orthopaedics"]

TAGS = ["empathetic", "punctual", "clear-instructions",
        "rushed", "unprofessional", "friendly", "thorough"]

MEDS = [
    ("Atorvastatin",  ["tablet"],                 True),
    ("Amoxicillin",   ["capsule", "oral suspension"], True),
    ("Metformin",     ["tablet", "extended-release tablet"], True),
    ("Salbutamol",    ["inhaler", "nebuliser solution"], True),
    ("Paracetamol",   ["tablet", "syrup"],        False),
    ("Cetirizine",    ["tablet"],                 False),
    ("Omeprazole",    ["capsule"],                True),
    ("Ibuprofen",     ["tablet", "gel"],          False),
]

random.seed(SEED)
fake = Faker()
Faker.seed(SEED)

NOW = datetime.now(timezone.utc)


# ------------------------------------------------------------ postgres read

def load_from_postgres():
    """
    The whole point of C1: Mongo documents must reference rows that
    actually exist in PostgreSQL.
    """
    print("reading identifiers from PostgreSQL: %s" % DSN)
    conn = psycopg2.connect(DSN)
    cur = conn.cursor()

    cur.execute("SELECT id, name, latitude, longitude FROM clinics")
    clinics = [
        {"id": str(r[0]), "name": r[1], "lat": float(r[2]), "lng": float(r[3])}
        for r in cur.fetchall()
    ]

    # Reviews hang off completed visits, so a review carries a consistent
    # (appointment, patient, clinic) triple rather than three unrelated ids.
    cur.execute("""
        SELECT id, patient_id, clinic_id,
               COALESCE(discharged_at, created_at)
          FROM appointments
         WHERE status = 'DISCHARGED'
    """)
    visits = [
        {"appointment_id": str(r[0]), "patient_id": str(r[1]),
         "clinic_id": str(r[2]), "ended_at": r[3]}
        for r in cur.fetchall()
    ]

    cur.close()
    conn.close()

    if not clinics:
        raise SystemExit(
            "No clinics found. Run postgres_seeder.py before this script."
        )

    print("  clinics: %d" % len(clinics))
    print("  discharged appointments: %d" % len(visits))
    return clinics, visits


# ---------------------------------------------------------------- seeding

def clear(db):
    print("clearing existing collections...")
    for name in ("MedicalCatalogs", "PatientReviews", "NursePings", "Nurses"):
        db[name].delete_many({})


def seed_catalogs(db, clinics):
    """Specialist + medication catalogs, one or more per real clinic."""
    print("seeding MedicalCatalogs...")
    docs = []
    for i in range(CATALOG_TOTAL):
        clinic = clinics[i % len(clinics)]        # even spread, every clinic covered
        days = random.sample(
            ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
            k=random.randint(2, 4),
        )
        docs.append({
            "clinic_id": clinic["id"],
            "clinic_name": clinic["name"],
            "specialist_name": "Dr. " + fake.name(),
            "specialty": random.choice(SPECIALTIES),
            "availability": [
                {
                    "day": d,
                    "slots": random.sample(
                        ["09:00-11:00", "11:00-13:00",
                         "14:00-16:00", "16:00-18:00"],
                        k=random.randint(1, 2),
                    ),
                }
                for d in days
            ],
            "medications_handled": [
                {"name": m[0], "dosage_forms": m[1], "requires_rx": m[2]}
                for m in random.sample(MEDS, k=random.randint(2, 4))
            ],
        })
    db["MedicalCatalogs"].insert_many(docs)
    print("  MedicalCatalogs: %d documents across %d clinics"
          % (len(docs), len(clinics)))


def seed_reviews(db, visits):
    """One review per completed visit, so every id resolves in PostgreSQL."""
    print("seeding PatientReviews...")
    col = db["PatientReviews"]
    written = 0

    for start in range(0, len(visits), BATCH):
        batch = []
        for v in visits[start:start + BATCH]:
            ended = v["ended_at"]
            if ended.tzinfo is None:
                ended = ended.replace(tzinfo=timezone.utc)
            # a review is written some time AFTER the visit ends
            created = ended + timedelta(hours=random.randint(1, 72))
            if created > NOW:
                created = NOW

            # ratings skew positive, the way real review data does
            rating = random.choices([1, 2, 3, 4, 5],
                                    weights=[6, 9, 18, 32, 35])[0]
            batch.append({
                "appointment_id": v["appointment_id"],
                "patient_id":     v["patient_id"],
                "clinic_id":      v["clinic_id"],
                "rating":         rating,
                "bedside_manner_tags": random.sample(TAGS, k=random.randint(1, 3)),
                "review_text":    fake.sentence(),
                "created_at":     created,
            })
        col.insert_many(batch)
        written += len(batch)
        print("  PatientReviews: %d / %d" % (written, len(visits)))


def build_nurses(clinics):
    """
    A nurse is an entity: a name, a home clinic, and ONE active flag.
    A1 had five bare id strings and randomised `active` per ping.
    """
    homes = random.sample(clinics, min(NURSE_COUNT, len(clinics)))
    nurses = []
    for i, clinic in enumerate(homes):
        nurses.append({
            "nurse_id":       "N_%03d" % (i + 1),
            "name":           fake.name(),
            "phone":          "+91 " + str(random.randint(7000000000, 9999999999)),
            "home_clinic_id": clinic["id"],
            "home_clinic_name": clinic["name"],
            "active":         random.random() < 0.7,   # ~70% on shift
            "base_lat":       clinic["lat"],
            "base_lng":       clinic["lng"],
        })
    return nurses


def seed_nurses(db, nurses):
    print("seeding Nurses...")
    db["Nurses"].insert_many([
        {k: v for k, v in n.items() if k not in ("base_lat", "base_lng")}
        for n in nurses
    ])
    active = sum(1 for n in nurses if n["active"])
    print("  Nurses: %d (%d active)" % (len(nurses), active))


def seed_pings(db, nurses):
    """
    Pings trace each nurse moving around their home clinic. `active`
    is copied from the nurse so A1's `query: {active: true}` filter
    still selects coherently.
    """
    print("seeding NursePings...")
    col = db["NursePings"]
    per_nurse = PING_TOTAL // len(nurses)
    written = 0

    for n in nurses:
        # a slow random walk reads better on a map than pure scatter
        lat, lng = n["base_lat"], n["base_lng"]
        remaining = per_nurse
        while remaining > 0:
            size = min(BATCH, remaining)
            batch = []
            for _ in range(size):
                lat += random.uniform(-0.0015, 0.0015)
                lng += random.uniform(-0.0015, 0.0015)
                # keep the walk inside ~2.5km of the home clinic
                lat = max(min(lat, n["base_lat"] + 0.022), n["base_lat"] - 0.022)
                lng = max(min(lng, n["base_lng"] + 0.022), n["base_lng"] - 0.022)

                batch.append({
                    "nurse_id": n["nurse_id"],
                    "active":   n["active"],
                    "location": {"type": "Point",
                                 "coordinates": [round(lng, 6), round(lat, 6)]},
                    "created_at": NOW - timedelta(
                        minutes=random.randint(0, PING_WINDOW_MIN)
                    ),
                })
            col.insert_many(batch)
            written += size
            remaining -= size
        print("  NursePings: %d / %d" % (written, per_nurse * len(nurses)))


# ------------------------------------------------------------------- main

def verify(db, clinics, nurses):
    print("\nverifying...")
    ok = True

    def check(label, value, passed):
        nonlocal ok
        ok = ok and passed
        print("  [%s] %s: %s" % ("ok" if passed else "FAIL", label, value))

    clinic_ids = [c["id"] for c in clinics]

    n = db["PatientReviews"].count_documents({"clinic_id": {"$in": clinic_ids}})
    total = db["PatientReviews"].count_documents({})
    check("reviews resolving to a real clinic", "%d / %d" % (n, total), n == total)

    n = db["MedicalCatalogs"].count_documents({"clinic_id": {"$in": clinic_ids}})
    total = db["MedicalCatalogs"].count_documents({})
    check("catalogs resolving to a real clinic", "%d / %d" % (n, total), n == total)

    pings = db["NursePings"].count_documents({})
    check("NursePings (>= 500,000)", "%d" % pings, pings >= 500_000)

    newest = db["NursePings"].find().sort("created_at", -1).limit(1)[0]["created_at"]
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=timezone.utc)
    drift = abs((NOW - newest).total_seconds())
    check("newest ping is in the past, not the future",
          "%.0fs old" % drift, newest <= NOW + timedelta(seconds=5))

    oldest = db["NursePings"].find().sort("created_at", 1).limit(1)[0]["created_at"]
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    age_h = (NOW - oldest).total_seconds() / 3600
    check("oldest ping within the 24h TTL", "%.1fh" % age_h, age_h < 24)

    # every nurse must have exactly one active value across all their pings
    flapping = 0
    for n_ in nurses:
        vals = db["NursePings"].distinct("active", {"nurse_id": n_["nurse_id"]})
        if len(vals) > 1:
            flapping += 1
    check("nurses whose active flag flaps between pings", flapping, flapping == 0)

    active_pings = db["NursePings"].count_documents({"active": True})
    check("active pings available to Workflow 3", active_pings, active_pings > 0)

    print("\nall checks passed\n" if ok else "\nSOME CHECKS FAILED\n")
    return ok


def main():
    clinics, visits = load_from_postgres()

    print("connecting to MongoDB at %s" % MONGO_URI)
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]

    clear(db)
    seed_catalogs(db, clinics)
    seed_reviews(db, visits)

    nurses = build_nurses(clinics)
    seed_nurses(db, nurses)
    seed_pings(db, nurses)

    verify(db, clinics, nurses)

    # Demo aid: these clinics definitely have a nurse within 5km.
    print("clinics with an active nurse nearby (use one as the map origin):")
    for n in nurses[:5]:
        if n["active"]:
            print("  %s  %s" % (n["home_clinic_id"], n["home_clinic_name"]))

    client.close()


if __name__ == "__main__":
    main()
