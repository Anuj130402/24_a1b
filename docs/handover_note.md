# Handover Note — CareConnect (Project 4)

**Source:** `JenilPadshala/SSD-A1-Project-4-CareConnect` @ `8b8c56a7`
**Evaluated:** 5 Oct 2026 · PostgreSQL 18.6, MongoDB 8.3.7, Python 3.9.4, macOS Intel, UTC+5:30

---

## What we checked

Provisioned the schema and ran every script in order, seeded both databases, and verified the
loaded data. The four workflow scripts were read against the seeded data and against the plans
committed in `performance/`; figures marked *(theirs)* come from those logs.

---

## Status

| Component | | Note |
|---|---|---|
| `01_schema_ddl.sql` | ✅ | 4 tables |
| `02_indexes.sql` | ✅ | `idx_active_consult`, `idx_appointments_analytics` |
| `03_triggers_and_audit.sql` | ✅ | function + trigger |
| `04_stored_procedures.sql` | ✅ | runs clean; omitted from their setup sequence — D7 |
| `05_materialized_views.sql` | ✅ | `SELECT 0` at creation (empty table) is expected |
| `06_window_analytics.sql` | ✅ | correct; unparameterised — C6 |
| `mongo/01_collections_and_indexes.js` | ✅ | `2dsphere` + TTL 7200s confirmed |
| `mongo/02_workflow3_geonear.js` | ⚠️ | returns nearest ping, not nearest nurse — D5 |
| `mongo/03_workflow4_facet.js` | ✅ | correct; global only, no `$match` — C7 |
| `postgres_seeder.py` | ⚠️ | data correct and committed; `verify()` stalls — D6 |
| `mongo_seeder.py` | ❌ | timestamps wrong — D2 |

**Seeded volumes:** 250 clinics · 25,000 patients · 60,000 appointments · 116,655 audit rows ·
1,000 catalogs · 100,000 reviews · 500,000 pings. All targets met.

**Data integrity verified:** 0 ledger mismatches across 25,000 patients, 0 orphaned audit rows,
0 negative balances, 0 patients holding two open appointments.

---

## Defects

| # | Defect | Evidence | Severity |
|---|---|---|---|
| **D1** | **Mongo documents reference nothing.** `mongo_seeder.py` writes `clinic_id`, `patient_id`, `appointment_id` as fresh `uuid.uuid4()` calls. The script never reads from PostgreSQL, so no document can match a real row. Every review and catalog is orphaned. | `countDocuments({clinic_id: <real id>})` → 0, for any clinic | Blocking |
| **D2** | **Timestamps are local time stored as UTC.** `mongo_seeder.py` uses naive `datetime.now()`; PyMongo serialises it as UTC. East of UTC the TTL fires late; west of UTC pings are born already expired and the collection is deleted within ~60s of seeding. `postgres_seeder.py` correctly uses `datetime.now(timezone.utc)`. | seeded at `17:16Z`, pings stamped `20:42Z`–`22:41Z` — up to 5.5 h in the future | Blocking |
| **D3** | **TTL window too tight.** Pings are stamped within the last 119 min against a 7200 s (120 min) TTL, so the collection empties ~2 h after seeding regardless of D2. | | Blocking |
| **D4** | **`active` randomised per ping, not per nurse.** 5 nurse IDs across 500,000 pings, `random.choice([True, False])` per document — the same nurse is both active and inactive. | | High |
| **D5** | **Workflow 3 returns the nearest ping, not the nearest nurse.** `$geoNear` then `$limit: 1`, no `$group` by `nurse_id`. With ~100,000 pings per nurse it answers the wrong question, and the returned document carries no nurse identity beyond a UUID. | | High |
| **D6** | **`verify()` cannot complete.** Check 8 uses `LATERAL … LIMIT 1` against `wallet_audit_logs`, which has no index on `patient_id` — one sequential scan per patient. | 11.96 s for 500 patients (`Seq Scan`, `loops=500`, `Rows Removed by Filter: 116650`) → ~10 min for 25,000 | High |
| **D7** | **Setup sequence omits `04_stored_procedures.sql`.** Their Step 4 lists `01`, `02`, `03`, `05` and the seeder. Following it literally leaves Workflow 1 uncreated. | `\df create_appointment_atomic` → empty | Medium |
| **D8** | **Dependencies unpinnable to an interpreter.** No Python version stated; on 3.9.4 with pip 20.2.3 both `pymongo` and `psycopg2-binary` had no wheel and built from source. `psycopg2-binary` compiling needs PostgreSQL headers, so this fails outright on a Docker-only machine. | `Running setup.py install for psycopg2-binary` | Medium |
| **D9** | **`mongo_schema_map.json` is never applied** as a `$jsonSchema` validator — nothing enforces document shape. | | Low |
| **D10** | **`mongo_seeder.py` is non-deterministic** — no `random.seed()` / `Faker.seed()`, unlike its PostgreSQL counterpart. Contents differ per run and per machine. | | Low |

---

## Changes required

| # | Change | Addresses |
|---|---|---|
| **C1** | Seed Mongo from real `clinics.id` / `patients.id` read out of PostgreSQL | D1 |
| **C2** | Use `datetime.now(timezone.utc)` in `mongo_seeder.py`; add `random.seed()` / `Faker.seed()` | D2, D10 |
| **C3** | Widen the TTL or write pings continuously so data survives a demo | D3 |
| **C4** | Introduce a nurse entity with `active` per nurse; group Workflow 3 by `nurse_id` and return one marker per nurse | D4, D5 |
| **C5** | `CREATE INDEX ON wallet_audit_logs (patient_id, timestamp DESC)` | D6, and the Audit Trail screen |
| **C6** | Parameterise Workflow 2 by clinic and date range — it currently returns ~134,750 rows in ~405 ms *(theirs)*, too large for a browser | — |
| **C7** | Add a `$match` stage to Workflow 4 for per-clinic statistics; index `PatientReviews.clinic_id` | — |
| **C8** | Parameterise the Workflow 3 origin (currently hardcoded to `[78.359518, 17.4532608]`) | — |
| **C9** | Add latitude/longitude to `patients` so "nearest nurse to patient" has an origin | — |
| **C10** | Add a status-transition procedure and a `discharged_at` column; repoint the materialized view at it | — |
| **C11** | Record a "last refreshed" timestamp for the materialized view | — |
| **C12** | Document the Python version and the full setup sequence including `04` | D7, D8 |
| **C13** | Apply `mongo_schema_map.json` as a `$jsonSchema` validator | D9 |

API-layer notes carried from the review: `create_appointment_atomic()` has no `BEGIN`/`COMMIT`
and no `EXCEPTION` block — it relies on the caller's transaction, and an uncaught exception
aborts it. A connection that hits one must be rolled back before reuse. Failures surface as
`P0001` (four `RAISE EXCEPTION` paths) or `23505` on constraint `idx_active_consult`.

---

## Verification log

```
\dt → appointments, clinics, patients, wallet_audit_logs
\df → create_appointment_atomic, log_hsa_balance_change, refresh_clinic_discharges_mv

postgres_seeder.py
  clinics 250 · patients 25,000 · wallet_audit_logs 112,655 (+4,000 via trigger) · appointments 60,000
  [ok] ×7   |   check 8 stalled, interrupted   |   check 9 not reached
  re-run manually: ledger_mismatches 0 · orphaned_audit_rows 0
  CREDIT 41,556 / DEBIT 75,099
  DISCHARGED 54,000 / IN_CONSULTATION 2,973 / WAITING 3,027

mongo_seeder.py  (26.1 s)
  MedicalCatalogs 1,000 · PatientReviews 100,000 · NursePings 500,000
  now 2026-10-05T17:16:29Z · oldest 20:42:08Z · newest 22:41:24Z · count 500000

EXPLAIN, verify() check 8 at 500 patients
  Seq Scan on wallet_audit_logs (loops=500, Rows Removed by Filter: 116650)
  Buffers: shared hit=822512 · Execution Time: 11955.523 ms

Committed plans (theirs)
  W2  Index Scan idx_appointments_analytics, 54,000 rows, 134,750 out, 405 ms, no seq scan
  W3  GEO_NEAR_2DSPHERE, 193 docs examined of 500,000, 6 ms
  W4  COLLSCAN, 100,000 docs examined, 181 ms — correct, no $match present
```
