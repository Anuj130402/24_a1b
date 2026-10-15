# CareConnect — Assignment 2: Front End

**CS6.302 Software System Development · Team 24 · Project 4 (CareConnect, telemedicine)**

| | |
|---|---|
| Repository | https://github.com/Anuj130402/24_a1b |
| Final commit hash | `<PASTE AFTER FINAL COMMIT>` |
| Demo video | `https://youtu.be/5LnUj36waC0` |
| Inherited from | [JenilPadshala/SSD-A1-Project-4-CareConnect @ `8b8c56a7`](https://github.com/JenilPadshala/SSD-A1-Project-4-CareConnect/commit/8b8c56a79d7c3129c9054c23c042bae258ae9790) |

---

## What this is

CareConnect is an on-demand telemedicine platform. Patients hold HSA (health
savings account) balances, book appointments at clinics, pay a copay per visit,
and review the care they received. Mobile nurses can be dispatched to a
patient's location.

Assignment 1 built the system entirely inside the database: PostgreSQL holds
patients, clinics, appointments and an append-only audit ledger, with the
business rules enforced by CHECK constraints, a partial unique index, an audit
trigger and a stored procedure. MongoDB holds specialist catalogs, patient
reviews and nurse location telemetry.

Assignment 2 adds the web application. A thin API exposes the four Part A
workflows over HTTP, and a browser front end lets a user browse records, book an
appointment, inspect the audit trail, read revenue analytics, find the nearest
nurse on a map, and review care quality.

**The database still does the work.** The API calls the stored procedure, runs
the window query, and executes the aggregation pipelines. It does not
reimplement any of that logic in JavaScript.

```
web/   React + Vite, six screens
  ↓    HTTP/JSON  (Vite proxies /api → :3001, so requests are same-origin)
api/   Express — a translator, not a brain
  ↓                      ↘
PostgreSQL                MongoDB
procedure, trigger,       $geoNear, $facet,
partial index, MV,        TTL + 2dsphere indexes
window functions
```

---

## Technology choices

| Layer | Choice | Why |
|---|---|---|
| API | Node + Express | A thin routing layer is all that is wanted here. Same language as the front end, so one `npm install` idiom across the repo. |
| PostgreSQL driver | `pg` | Returns `DECIMAL(10,2)` as a **string**, which is what keeps money exact. See the note below. |
| MongoDB driver | `mongodb` (official) | Pipelines are plain JS arrays, so the Part A `.js` scripts and the API share one definition in `api/pipelines/index.js`. |
| Front end | React 18 + Vite | Component reuse across six screens; Vite's dev server and proxy remove CORS from the picture entirely. |
| Routing | React Router 6 | Deep-linkable URLs per screen. |
| Charts | Recharts | Declarative SVG, composes directly with React. Covers the moving-average line and the rating bars without configuration. |
| Maps | React-Leaflet | Free, no API key, no billing account. Mapbox and Google both need keys. |
| Styling | Plain CSS with custom properties | Every colour, size and space is a token in `web/src/styles/tokens.css`. Six screens stay visually consistent without a framework. |
| Tests | Node's built-in test runner | Zero dependencies. The logic under test lives in the database, so these are integration tests by design. |

### Money is a string, deliberately

`node-postgres` returns `DECIMAL` as a string rather than a float, and the value
stays a string all the way to the `<Money>` component. Converting two of them to
floats and subtracting is wrong:

```js
Number("16384.01") - Number("16134.01")   // 249.99999999999818, not 250
```

The test suite compares whole paise (`Math.round(Number(v) * 100)`) for the same
reason. This is not hypothetical — it caused a real test failure during
development.

### Dates are strings too

`node-postgres` materialises a PostgreSQL `DATE` as a JS `Date` at **local**
midnight. On a UTC+5:30 machine, `2026-09-01` serialises to
`"2026-08-31T18:30:00.000Z"` and every point on a chart ends up labelled a day
early. Calendar dates are therefore cast with `::text` in SQL and never
round-trip through a JS `Date`. Timestamps, which are `TIMESTAMPTZ`, are
unaffected.

---

## Assumptions

1. **No authentication.** The brief states real login is not required. The actor
   switcher in the sidebar changes which screens are foregrounded for a
   demonstration; it does not restrict what the API serves.
2. **Three actors**, derived from the workflows: a front-desk coordinator
   (Browse, Book, Audit), a clinic administrator (Analytics, Reviews) and a
   dispatch coordinator (Map). An "All roles" option exists for walkthroughs.
3. **Discharge is final.** `WAITING → IN_CONSULTATION → DISCHARGED` is forward
   only. A completed visit does not reopen; the patient books a new appointment.
4. **Revenue is earned at discharge**, not at booking — the same rule Part A used
   for its materialized view. Workflow 2 and the view both key off
   `discharged_at`.
5. **The analytics date range is capped at 730 days.** The window query
   cross-joins 250 clinics against every day in the range, so an unbounded
   request builds millions of rows.
6. **The ranking leaderboard is collective.** `DENSE_RANK()` partitions by date
   across all clinics, so selecting a clinic highlights its row rather than
   filtering the table — filtering would rank a clinic against itself and return
   rank 1 every time.
7. **Nurse pings expire after 24 hours** (widened from Part A's 2 hours). If the
   Map is empty, re-run the MongoDB seeder.
8. **Patients without coordinates** cannot be used as a Map origin and are
   filtered out of that picker.
9. **The test suite writes to the database** — one appointment, one audit row,
   one status transition. That is the only way to prove the trigger fires.
   Re-seed for a pristine state.

---

## Changes to the inherited system

Running Part A locally surfaced ten defects, recorded with evidence in
[`docs/handover_note.md`](docs/handover_note.md). The originals in `sql/01`–`06`
and `mongo/01`–`03` are **unmodified**; every addition lives in
`sql/07_a2_additions.sql` and `mongo/04_a2_additions.js`, so the diff against the
inherited submission is self-documenting.

### Defects fixed

| | Defect | Fix |
|---|---|---|
| C1 | MongoDB documents referenced nothing — every `clinic_id`, `patient_id` and `appointment_id` was a fresh `uuid4()` matching no PostgreSQL row, so all reviews and catalogs were orphaned | The seeder now reads real identifiers out of PostgreSQL first |
| C2 | `mongo_seeder.py` wrote timezone-naive local timestamps, which PyMongo stores as UTC — pings landed 5.5 h in the future on a UTC+5:30 machine, and *in the past* west of UTC, where the TTL deleted the collection within a minute of seeding | `datetime.now(timezone.utc)`, plus `random.seed()` / `Faker.seed()` for reproducibility |
| C3 | Pings were stamped within the last 119 minutes against a 7200 s TTL, so the collection emptied ~2 h after seeding | TTL widened to 24 h via `collMod`; pings spread across 23 h |
| C4 | `active` was randomised per ping, so the same nurse was simultaneously active and inactive | A `Nurses` collection; `active` is a property of the nurse and is copied onto their pings |
| C5 | `wallet_audit_logs` had no index on `patient_id`, so the seeder's own verification query took ~10 minutes and the Audit screen would scan 116,655 rows per page | `idx_audit_patient_time` on `(patient_id, timestamp DESC)` |
| C13 | `mongo_schema_map.json` was descriptive only, never applied | Applied as `$jsonSchema` validators at `validationLevel: "moderate"` |

### Capabilities Part A did not need

| | Addition |
|---|---|
| C6 | `clinic_moving_average(from, to)` — Workflow 2 parameterised. Unfiltered it returned ~134,750 rows, far too many for a browser |
| C7 | A `$match` stage so Workflow 4 reports per clinic, with an index on `PatientReviews.clinic_id` |
| C8 | Workflow 3's origin is a parameter; Part A hardcoded `[78.359518, 17.4532608]` |
| C9 | `latitude` / `longitude` on `patients`, so "nearest nurse to patient" has an origin |
| C10 | `advance_appointment_status()` and a `discharged_at` column. Nothing in Part A could move an appointment between statuses, so the partial unique index could never be demonstrated — a patient with an open visit was blocked forever. The materialized view now counts discharges by discharge month rather than booking month |
| C11 | `mv_refresh_log`, because PostgreSQL does not record when a materialized view was refreshed |
| C16 | Latitude/longitude bounds and positive-radius validation on `$geoNear` |
| C17 | `from <= to` plus the 730-day cap on the window query |
| C22 | 27 integration tests |

### Robustness and interface

| | Addition |
|---|---|
| C12 | Documented setup sequence. Part A's README omitted `04_stored_procedures.sql`, so following it literally left Workflow 1 uncreated. Python version and a `pip install --upgrade pip setuptools wheel` step are now stated |
| C14 | Paging sanitisation for negative and non-integer `page` / `limit` |
| C15 | Empty query parameters (`?patient_id=`) become SQL `NULL` instead of raising `22P02`; `22007` / `22008` malformed dates return 400 rather than 500 |
| C18 | Actor switcher in the sidebar |
| C19 | Patient-first origin on the Map, matching the project table in the brief |
| C20 | Accepting-patients filter on the Clinics tab |
| C21 | Inline "Discharge current appointment" button when a booking is blocked |
| C23 | `docker-compose.yml` for both databases |
| — | MongoDB connects without a top-level `await`, so an unreachable MongoDB is reported by `/health` instead of preventing the server from starting |

---

## Running it

**Prerequisites:** PostgreSQL 13+, MongoDB 6+, `mongosh`, Python 3.9+, Node 18+.

### 1. Databases

With Docker:

```bash
docker compose up -d
```

Or use local installations. On macOS, if `brew services start mongodb-community`
reports a `plist` error:

```bash
mkdir -p /usr/local/var/mongodb /usr/local/var/log/mongodb
mongod --config /usr/local/etc/mongod.conf --fork
```

On Windows, set the connection details once per terminal:

```powershell
$env:CARECONNECT_DSN = "dbname=careconnect host=localhost user=postgres password=YOURPASSWORD"
$env:DATABASE_URL    = "postgresql://postgres:YOURPASSWORD@localhost:5432/careconnect"
```

### 2. Schema

```bash
createdb careconnect
psql -d careconnect -f sql/01_schema_ddl.sql
psql -d careconnect -f sql/02_indexes.sql
psql -d careconnect -f sql/03_triggers_and_audit.sql
psql -d careconnect -f sql/04_stored_procedures.sql      # omitted by Part A's README
psql -d careconnect -f sql/05_materialized_views.sql
```

### 3. Seed PostgreSQL

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r data_generation/requirements.txt
python data_generation/postgres_seeder.py
```

> The seeder appears to hang after its seventh `[ok]`. That is inherited
> behaviour: its eighth verification query has no supporting index and takes
> about ten minutes on 25,000 patients. All data is committed by that point —
> press `Ctrl+C` once the seventh `[ok]` appears. `sql/07_a2_additions.sql`
> adds the index that makes the check fast.

Expect 250 clinics, 25,000 patients, 60,000 appointments, 116,655 audit rows.

### 4. Assignment 2 additions

```bash
psql -d careconnect -f sql/07_a2_additions.sql
```

### 5. MongoDB

Order matters — step 2 widens the ping TTL, and seeding first would have
MongoDB delete most of the data within a minute.

```bash
mongosh mongo/01_collections_and_indexes.js
mongosh mongo/04_a2_additions.js
python data_generation/mongo_seeder.py
```

The seeder ends with its own verification block and prints a few clinics that
have a nurse nearby — useful origins for the Map screen.

### 6. Run

```bash
cd api && npm install && node app.js      # terminal 2 — http://localhost:3001
cd web && npm install && npm run dev      # terminal 3 — http://localhost:5173
```

Check both databases are reachable:

```bash
curl http://localhost:3001/health
# {"api":"ok","postgres":"ok","mongo":"ok"}
```

---

## The screens

### Browse

![Browse](docs/screenshots/01-browse.png)

Patients, clinics and appointments across three tabs, with search, an
accepting-patients filter on clinics, and a status filter on appointments.
Paging is **server-side** — 25 rows per request against 60,000 appointments,
never a full load into the browser. Patient and clinic names are joined in SQL,
so the browser makes no N+1 lookups. Appointment rows carry the status-transition
buttons.

### Book an appointment — Workflow 1

![Book](docs/screenshots/02-book.png)

Calls `create_appointment_atomic()`. The balance before and after sit side by
side, and below them the `wallet_audit_logs` row that appeared — written by
`trigger_audit_hsa_balance`, not by the application. Reading it back is how the
screen demonstrates the trigger fired.

![Booking blocked](docs/screenshots/03-book-blocked.png)

Booking a patient who already has an open consultation is rejected by the partial
unique index `idx_active_consult`, surfaced as a readable sentence rather than a
raw constraint violation. The inline button discharges the current visit so the
blocked → discharge → rebook cycle can be shown without leaving the screen.

Five distinct failures are demonstrable: insufficient balance, copay of zero, a
clinic closed to new patients, a non-existent patient or clinic, and the
duplicate consultation above.

### Audit trail

![Audit](docs/screenshots/04-audit.png)

Read-only ledger for one patient, with a date range filter. Credits are pine,
debits brick, and the running balance is a stored column — `balance_after` is
written by the trigger on every movement, so nothing is recomputed. Verified
against the seed: zero mismatches across 25,000 patients.

### Analytics — Workflow 2 and the materialized view

![Analytics](docs/screenshots/05-analytics.png)

The 7-day moving average of copay revenue per clinic, from the Part A window
query. Days with no discharges are padded with ₹0.00 so the window spans seven
*calendar* days rather than seven rows. Below it, the `DENSE_RANK()` leaderboard
for a selectable date — tied clinics share a rank and the next still takes the
next number — and the materialized view summary with its last-refreshed time and
a refresh button that runs `REFRESH MATERIALIZED VIEW CONCURRENTLY`.

### Map — Workflow 3

![Map](docs/screenshots/06-map.png)

`$geoNear` around a selectable origin: a patient by default, matching the
project table's "nearest nurse to patient", or a clinic. A radius circle, one
marker per nurse, and a distance-sorted list. Polls every five seconds so new
pings appear without a reload. Grouping by `nurse_id` returns the nearest
*nurse* rather than the nearest ping.

### Reviews — Workflow 4

![Reviews](docs/screenshots/07-reviews.png)

One `$facet` pipeline computes the rating distribution, the top tags and the
overall average in a single pass over the collection. Below, recent review text
and a `MedicalCatalogs` document rendered as nested lists — `availability` and
`medications_handled` are variable-length per specialist, which is why that
collection lives in MongoDB rather than SQL.

Every screen handles loading, empty and error states.

---

## Tests

```bash
cd api && npm test        # the API must be running, with both databases seeded
```

27 integration tests across seven groups. They run against a live server
deliberately: the logic under test lives in the database, so mocking it away
would assert almost nothing worth asserting.

| Group | What it proves |
|---|---|
| Health | Both databases reachable |
| Browse | Paging is server-side, pages do not overlap, search narrows, names are joined, empty filters and malformed UUIDs do not 500 |
| Workflow 1 | A booking deducts exactly the copay; the trigger writes the ledger row unaided; all four procedure failure paths return 400; a second open consultation returns 409 |
| Lifecycle | `WAITING → IN_CONSULTATION → DISCHARGED`, reversal rejected, and discharge frees the patient to book again |
| Workflow 2 | The window columns are present, `DENSE_RANK` leaves no gaps, the view refreshes and records when |
| Workflow 3 | Sorted by distance, one row per nurse, active only |
| Workflow 4 | All three facets in one response; buckets sum to the review total; nested catalog arrays survive |

### Concurrency

Ten simultaneous booking requests for the same patient produce **exactly one 201
and nine 409s**. Afterwards: zero ledger mismatches, zero patients holding two
open appointments, zero negative balances. The `FOR UPDATE` row lock inside
`create_appointment_atomic()` serialises the requests and the partial unique
index rejects the rest.

---

## Packaging

```bash
bash scripts/package_submission.sh
```

Builds `../24_a1b.zip` and refuses to produce one containing `node_modules`,
`venv`, `__pycache__` or build output, or one over 20 MB.

---

## Contribution



| Member | Roll number | Design | Code |
|---|---|---|---|
| Anuj Kandwal (M1) | 2026201048 | Designed the Browse screen for patients, clinics, and appointments, including search, filters, pagination, and record detail views; contributed to the shared design system, component library, six-screen wireframes, and API contract. | Implemented Browse UI and `/patients`, `/clinics`, and `/appointments` endpoints; worked on PostgreSQL UI indexes and seeder adjustments; set up the repository fork, app scaffolding, routing, Docker Compose, handover note, and README assembly. |
| Summer Koushal (M2) | 2026201016 | Designed the Transaction and Audit Trail screens, including booking feedback, balance before/after, readable failure states, date filtering, and audit-ledger presentation. | Implemented `POST /appointments`, `PATCH /appointments/:id/status`, and `/patients/:id/audit`; added the status-transition procedure and `discharged_at` support; handled atomic booking integration, audit trail data, and related tests. |
| Vishal Singh (M3) | 2026201006 | Designed the Analytics screen with the moving-average chart, clinic ranking table, materialized-view summary, last-refreshed timestamp, and refresh control. | Implemented `/analytics/moving-average`, `/analytics/summary`, and `POST /analytics/refresh`; parameterised the window analytics query, added the materialized-view refresh log, and integrated the analytics data and refresh flow. |
| Mohit Sharma (M4) | 2026201028 | Designed the Map and Reviews screens, including the nurse map, origin and radius display, distance-sorted results, review analytics, and medical catalog presentation. | Implemented `/nurses/near`, `/clinics/:id/reviews/stats`, and `/clinics/:id/catalog`; handled MongoDB seeder fixes for shared IDs, stable nurse identity, TTL/re-seeding, and deterministic data, plus the `$geoNear` and `$facet` pipeline integration. |

---

## Repository layout

```
24_a1b/
├── README.md
├── docker-compose.yml
├── docs/
│   ├── handover_note.md          evaluation of the inherited system
│   ├── api_endpoints.md          every endpoint, parameters and response shapes
│   ├── CONVENTIONS.md            ports, ownership, the design-token rule
│   ├── design/wireframes.html    six screens, three user personas
│   └── screenshots/
├── sql/                          01–06 inherited unmodified · 07 = our additions
├── mongo/                        01–03 inherited unmodified · 04 = our additions
├── data_generation/              postgres_seeder.py unmodified · mongo_seeder.py rewritten
├── performance/                  inherited EXPLAIN and executionStats captures
├── api/
│   ├── app.js  db.js
│   ├── routes/                   browse · transactions · analytics · mongo
│   ├── pipelines/index.js        $geoNear and $facet, shared with mongo/
│   ├── middleware/errors.js      SQLSTATE → readable message
│   └── tests/api.test.js
├── web/src/
│   ├── App.jsx                   shell, routing, actor switcher
│   ├── components/               shared library
│   ├── hooks/useApi.js
│   ├── pages/                    Browse · Transaction · Audit · Analytics · MapScreen · Reviews
│   └── styles/                   tokens.css · base.css
└── scripts/package_submission.sh
```
