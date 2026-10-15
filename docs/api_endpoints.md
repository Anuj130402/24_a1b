# API endpoints

The contract between the browser and the server. Every response shape below
matches the implementation in `api/routes/`.

Base URL `http://localhost:3001`. The Vite dev server proxies `/api/*` to it,
so the browser makes same-origin requests and there is no CORS configuration.

| Area | Endpoints | Route file |
|---|---|---|
| Health | `/health` | `api/app.js` |
| Browse | `/patients`, `/patients/:id`, `/clinics`, `/clinics/:id`, `/appointments` | `routes/browse.js` |
| Workflow 1 + Audit | `POST /appointments`, `PATCH /appointments/:id/status`, `/patients/:id/audit` | `routes/transactions.js` |
| Workflow 2 | `/analytics/moving-average`, `/analytics/ranking`, `/analytics/summary`, `POST /analytics/refresh` | `routes/analytics.js` |
| Workflow 3 + 4 | `/nurses/near`, `/clinics/:id/reviews/stats`, `/clinics/:id/reviews`, `/clinics/:id/catalog` | `routes/mongo.js` |

---

## Conventions

**Lists** return this envelope, which is what the `<Pagination>` component reads:

```json
{ "data": [ ... ], "page": 1, "limit": 25, "total": 25000 }
```

`page` is 1-based. `limit` defaults to 25 and is capped at 100. `total` counts
every matching row, not the rows on this page.

**Single records** are returned directly, with no envelope.

**Errors** always return `{ "error": "<a sentence a user can read>" }`.
Routes never build these by hand — they `throw` or `next(err)` and
`middleware/errors.js` maps the PostgreSQL SQLSTATE:

| SQLSTATE | Cause | Status |
|---|---|---|
| `P0001` | `RAISE EXCEPTION` in a stored procedure | 400 |
| `22P02` | Malformed uuid or numeric | 400 |
| `22007` / `22008` | Malformed or out-of-range date | 400 |
| `23514` | CHECK constraint | 400 |
| `23503` | Foreign key | 400 |
| `23505` on `idx_active_consult` | Second open consultation | 409 |
| `23505` other | Any other unique violation | 409 |
| — | Anything else | 500 |

**Money** is a string. `node-postgres` returns `DECIMAL(10,2)` as a string to
avoid float drift, and it stays a string through to `<Money>`, which formats it.
Subtracting two of them as floats is wrong: `16384.01 - 16134.01` evaluates to
`249.99999999999818`, not `250`.

**Dates.** Timestamps are ISO 8601 UTC (`2026-10-04T08:30:00.000Z`). Plain
calendar dates are **strings** (`"2026-09-01"`), cast with `::text` in SQL —
`node-postgres` materialises a `DATE` at local midnight, so on a UTC+5:30
machine a JS `Date` round-trip shifts it into the previous day.

**Coordinates** are numbers, not strings — `latitude` and `longitude` are
`DOUBLE PRECISION`, unlike the money columns.

**Identifiers** are UUID strings. An omitted filter and an empty one
(`?patient_id=`) both mean "do not filter" and become SQL `NULL`.

---

## Health

### `GET /health`

```json
{ "api": "ok", "postgres": "ok", "mongo": "ok" }
```

Each database is reported independently. MongoDB being unreachable does not stop
the server starting, so `mongo` can read `"down"` while the rest works — the
PostgreSQL screens stay usable.

---

## Browse

### `GET /patients`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | 1 | |
| `limit` | int | 25 | capped at 100 |
| `q` | string | — | case-insensitive match on `name` |

```json
{
  "data": [
    {
      "id": "578774cf-1327-4283-8bf4-f613a42901d0",
      "name": "Aaron Allen",
      "hsa_balance": "3767.55",
      "latitude": 22.761527483350697,
      "longitude": 88.017454
    }
  ],
  "page": 1, "limit": 25, "total": 25000
}
```

`latitude` and `longitude` are `null` for patients with no recorded location.
Those patients cannot be used as a Map origin.

### `GET /patients/:id`

```json
{
  "id": "578774cf-…",
  "name": "Aaron Allen",
  "hsa_balance": "3767.55",
  "latitude": 22.761527,
  "longitude": 88.017454,
  "open_appointment": {
    "id": "77a7293f-…",
    "clinic_id": "4df9df4e-…",
    "clinic_name": "Adams Medical Group",
    "status": "WAITING",
    "copay_amount": "250.00",
    "created_at": "2026-10-15T11:04:52.000Z"
  },
  "appointment_count": 7
}
```

`open_appointment` is `null` when the patient has no `WAITING` or
`IN_CONSULTATION` row. The booking form uses it to warn before the partial
unique index rejects a second booking.

**404** `Patient not found.` · **400** on a malformed uuid.

### `GET /clinics`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page`, `limit` | int | 1, 25 | |
| `q` | string | — | matches `name` |
| `accepting` | `true` \| `false` | — | omit, or send empty, for all clinics |

```json
{
  "data": [
    {
      "id": "4df9df4e-…",
      "name": "Adams Medical Group",
      "latitude": 19.026819,
      "longitude": 72.984744,
      "is_accepting_patients": true
    }
  ],
  "page": 1, "limit": 25, "total": 250
}
```

### `GET /clinics/:id`

The clinic fields above, plus aggregates:

```json
{
  "appointment_count": 240,
  "discharged_count": 216,
  "total_revenue": "54000.00"
}
```

### `GET /appointments`

| Param | Type | Notes |
|---|---|---|
| `page`, `limit` | int | |
| `patient_id` | uuid | |
| `clinic_id` | uuid | |
| `status` | enum | `WAITING` \| `IN_CONSULTATION` \| `DISCHARGED` |

```json
{
  "data": [
    {
      "id": "b997cdae-…",
      "patient_id": "2719176f-…", "patient_name": "Thomas Miller",
      "clinic_id": "4df9df4e-…", "clinic_name": "Adams Medical Group",
      "copay_amount": "250.00",
      "status": "DISCHARGED",
      "created_at": "2026-05-10T17:00:49.000Z",
      "discharged_at": "2026-05-10T20:14:22.000Z"
    }
  ],
  "page": 1, "limit": 25, "total": 60000
}
```

Names are joined server-side so the browser never makes N+1 lookups.
`discharged_at` is `null` unless the status is `DISCHARGED`.

---

## Workflow 1 — booking, lifecycle and the audit trail

### `POST /appointments`

Calls `create_appointment_atomic(p_patient_id, p_clinic_id, p_copay_amount)`.
None of its logic is reimplemented in JavaScript.

```json
{ "patient_id": "0a5eaa08-…", "clinic_id": "4df9df4e-…", "copay_amount": "250.00" }
```

**201**

```json
{
  "appointment": {
    "id": "77a7293f-…",
    "status": "WAITING",
    "copay_amount": "250.00",
    "created_at": "2026-10-15T11:04:52.000Z"
  },
  "balance_before": "1082.08",
  "balance_after": "832.08",
  "audit_entry": {
    "id": "a1b2c3d4-…",
    "action_type": "DEBIT",
    "amount_changed": "250.00",
    "balance_after": "832.08",
    "timestamp": "2026-10-15T11:04:52.000Z"
  }
}
```

`audit_entry` is **read back**, not written by the API. `trigger_audit_hsa_balance`
produced it when the procedure updated the balance. Showing it is how the UI
demonstrates the trigger fired.

**Failures**

| Cause | SQLSTATE | Status | Message |
|---|---|---|---|
| Copay ≤ 0 | `P0001` | 400 | `Copay amount must be greater than zero` |
| Patient missing | `P0001` | 400 | `Patient <uuid> does not exist` |
| Clinic missing | `P0001` | 400 | `Clinic <uuid> does not exist` |
| Clinic closed | `P0001` | 400 | `Clinic <uuid> is not accepting patients` |
| Balance too low | `P0001` | 400 | `Insufficient HSA balance. Available: …, Required: …` |
| Second open visit | `23505` | 409 | translated by the middleware — raised by the index, not the procedure |

**Transaction handling.** A raised exception leaves the connection in an aborted
transaction, so the route always `ROLLBACK`s before releasing it to the pool.
Without that, the *next* request on that connection fails for unrelated reasons.

**Concurrency.** Ten simultaneous bookings for one patient produce exactly one
201 and nine 409s: `create_appointment_atomic` takes a `FOR UPDATE` lock on the
patient row, and the partial unique index rejects the rest.

### `PATCH /appointments/:id/status`

Added in Assignment 2 (`advance_appointment_status`). Nothing in Part A could
move an appointment between statuses, so the partial unique index could never be
demonstrated — once a patient had an open visit they were blocked forever.

```json
{ "status": "DISCHARGED" }
```

Forward only: `WAITING → IN_CONSULTATION → DISCHARGED`, and `WAITING → DISCHARGED`
directly. Anything else is **400** `Cannot move an appointment from X to Y`.
Discharging stamps `discharged_at` and frees the patient to book again.

**200** returns the updated appointment in the same shape as `GET /appointments`.

### `GET /patients/:id/audit`

| Param | Type | Notes |
|---|---|---|
| `page`, `limit` | int | |
| `from`, `to` | `YYYY-MM-DD` | inclusive; filters on `timestamp` |

```json
{
  "patient": { "id": "578774cf-…", "name": "Aaron Allen", "hsa_balance": "3767.55" },
  "summary": { "total_credit": "62500.00", "total_debit": "13430.00" },
  "data": [
    {
      "id": "14ab6cf0-…",
      "action_type": "DEBIT",
      "amount_changed": "250.00",
      "balance_after": "832.08",
      "timestamp": "2026-10-15T11:04:52.000Z"
    }
  ],
  "page": 1, "limit": 25, "total": 42
}
```

Newest first. `summary` covers the filtered range, not all time.

**The running balance is not computed.** `balance_after` is written by the
trigger on every movement, so the screen renders a stored column. Verified
against the seed: zero mismatches across 25,000 patients.

Requires `idx_audit_patient_time` from `sql/07_a2_additions.sql`, or this
sequentially scans 116,655 rows per page.

---

## Workflow 2 — window analytics and the materialized view

### `GET /analytics/moving-average`

Wraps `clinic_moving_average(from, to)`, which is `sql/06_window_analytics.sql`
parameterised by date.

| Param | Type | Required | Notes |
|---|---|---|---|
| `clinic_id` | uuid | yes | |
| `from`, `to` | `YYYY-MM-DD` | no | defaults to the last 90 days of discharge activity |

```json
{
  "clinic": { "id": "4df9df4e-…", "name": "Adams Medical Group" },
  "from": "2026-09-01",
  "to": "2026-09-05",
  "data": [
    {
      "revenue_date": "2026-09-01",
      "daily_revenue": "1250.00",
      "rolling_total_7day": "8400.00",
      "moving_avg_7day": "1200.00",
      "days_in_window": 7,
      "clinic_rank": 12
    }
  ]
}
```

Column names match the Part A query's output exactly.

> **The clinic filter is applied to the function's result, not inside it.**
> `DENSE_RANK()` partitions by `revenue_date` across all 250 clinics, so
> filtering by clinic inside the CTEs ranks a clinic against itself and every
> row comes back as rank 1. The date range *is* pushed down — it narrows rows
> without changing the competitor set.

**Validation.** `from` must not be after `to`, and the range is capped at
**730 days**. The function cross-joins 250 clinics against every day in the
range, so an unbounded request (a 50-year span) builds millions of rows:

```
400 { "error": "That range covers 18263 days. Please request 730 days or fewer." }
```

### `GET /analytics/ranking`

The leaderboard for a single date — the same function, filtered the other way.

| Param | Type | Default |
|---|---|---|
| `date` | `YYYY-MM-DD` | the most recent day with at least 20 discharges |
| `limit` | int | 20, capped at 50 |

```json
{
  "date": "2026-10-13",
  "bounds": { "min_date": "2025-04-23", "max_date": "2026-10-13" },
  "data": [
    { "clinic_id": "4f3ce36b-…", "clinic_name": "Phillips Urgent Care",
      "moving_avg_7day": "3480.00", "daily_revenue": "4100.00", "clinic_rank": 1 }
  ]
}
```

`bounds` drives the min/max on the screen's date picker.

The default deliberately skips days with almost no activity. Discharging two
appointments by hand during a demo would otherwise make *today* the most recent
discharge date, and on that date every clinic's 7-day average is 0.00 — so all
250 tie at rank 1 and the leaderboard looks broken.

Ties share a rank and the next clinic still takes the next number, which is why
Part A used `DENSE_RANK` rather than `RANK`.

### `GET /analytics/summary`

Reads the materialized view `clinic_monthly_discharges`.

| Param | Type | Default |
|---|---|---|
| `month` | `YYYY-MM` | the latest month in the view |

```json
{
  "month": "2026-10",
  "months": ["2026-10", "2026-09", "2026-08"],
  "last_refreshed": "2026-10-15T11:03:08.714Z",
  "totals": { "clinics_reporting": 250, "total_discharges": 4820 },
  "data": [
    { "clinic_id": "4df9df4e-…", "clinic_name": "Adams Medical Group",
      "total_discharges": 31, "total_revenue": "3410.00" }
  ]
}
```

`months` populates the screen's month picker. `last_refreshed` comes from
`mv_refresh_log`, added in Assignment 2 — PostgreSQL does not record when a
materialized view was refreshed.

### `POST /analytics/refresh`

No body. Calls `refresh_clinic_discharges_mv()`, which runs
`REFRESH MATERIALIZED VIEW CONCURRENTLY` — non-blocking for readers, which is
why `idx_clinic_month_discharge` has to exist — and records the time.

```json
{ "refreshed_at": "2026-10-15T11:03:08.714Z" }
```

Takes a few seconds; the button is disabled while it runs.

---

## Workflow 3 — nearest nurse

### `GET /nurses/near`

Wraps the `$geoNear` pipeline in `api/pipelines/index.js`, shared with
`mongo/02_workflow3_geonear.js`.

| Param | Type | Notes |
|---|---|---|
| `patient_id` | uuid | origin is that patient's location — the brief's "nearest nurse to patient" |
| `clinic_id` | uuid | alternative origin |
| `lat`, `lng` | float | raw coordinates |
| `radius` | int | metres, default 5000, capped at 50000 |

Provide exactly one of `patient_id`, `clinic_id`, or the `lat`/`lng` pair.

```json
{
  "origin": { "lat": 17.4532608, "lng": 78.359518 },
  "radius": 5000,
  "data": [
    {
      "nurse_id": "N_003",
      "name": "Connie Mcdonald",
      "phone": "+91 9876543210",
      "home_clinic_name": "Chen Urgent Care",
      "location": { "type": "Point", "coordinates": [78.3612, 17.4498] },
      "distance_m": 412.6,
      "active": true,
      "created_at": "2026-10-15T07:48:17.000Z"
    }
  ]
}
```

Sorted nearest first, **one entry per nurse**. Part A used `$limit: 1` with no
grouping, which returns the nearest *ping* rather than the nearest *nurse* —
with ~12,500 pings per nurse that answers the wrong question. The pipeline now
groups by `nurse_id` and `$lookup`s the `Nurses` collection for the name and
home clinic.

**400** if no usable origin is given, or if the chosen patient has no recorded
location.

**GeoJSON is `[longitude, latitude]`.** Leaflet expects `[lat, lng]`, so the
Map component swaps at the boundary rather than the API doing it.

---

## Workflow 4 — faceted review analytics

### `GET /clinics/:id/reviews/stats`

Wraps the `$facet` pipeline, which computes all three statistics in a single
pass over the collection.

```json
{
  "clinic_id": "4df9df4e-…",
  "rating_distribution": [
    { "rating": 1, "count": 12 }, { "rating": 2, "count": 18 },
    { "rating": 3, "count": 36 }, { "rating": 4, "count": 64 },
    { "rating": 5, "count": 70 }
  ],
  "frequent_tags": [
    { "tag": "thorough", "frequency": 82 },
    { "tag": "empathetic", "frequency": 77 }
  ],
  "average_rating": 3.81,
  "total_reviews": 200
}
```

The pipeline emits `$bucket` output as `{ _id, count }` and tags as
`{ _id, frequency }`; the route reshapes them to `rating` and `tag` so the chart
code never handles `_id`. All five buckets are always present, zero-filled —
`$bucket` boundaries run to 6 because upper bounds are exclusive, so a 5-star
review needs the 6 to be counted.

Part A's pipeline had no `$match` and reported globally; the `$match` added here
scopes it to one clinic, backed by an index on `PatientReviews.clinic_id`.

Returns zeroes and empty arrays for a clinic with no reviews.

Tag vocabulary: `empathetic`, `punctual`, `clear-instructions`, `rushed`,
`unprofessional`, `friendly`, `thorough`.

### `GET /clinics/:id/reviews`

Recent review text for the same clinic. `limit` defaults to 10, capped at 50.

```json
{
  "data": [
    {
      "rating": 5,
      "review_text": "Explained everything clearly.",
      "bedside_manner_tags": ["thorough", "punctual"],
      "created_at": "2026-09-28T04:12:00.000Z"
    }
  ]
}
```

### `GET /clinics/:id/catalog`

The flexible `MedicalCatalogs` documents, up to 10.

```json
{
  "clinic_id": "4df9df4e-…",
  "data": [
    {
      "clinic_id": "4df9df4e-…",
      "clinic_name": "Adams Medical Group",
      "specialist_name": "Dr. Anand Varma",
      "specialty": "Cardiology",
      "availability": [
        { "day": "Monday", "slots": ["09:00-11:00", "14:00-16:00"] },
        { "day": "Thursday", "slots": ["10:00-13:00"] }
      ],
      "medications_handled": [
        { "name": "Atorvastatin", "dosage_forms": ["tablet"], "requires_rx": true }
      ]
    }
  ]
}
```

`availability` and `medications_handled` are variable-length and vary by
specialist — the reason this collection lives in MongoDB rather than SQL. The
screen renders them as nested lists rather than flattening them into a table.

---

## Out of scope

No authentication. The brief states real login is not required; the actor
switcher in the sidebar changes which screens are foregrounded for a
demonstration and does not restrict what the API will serve.
