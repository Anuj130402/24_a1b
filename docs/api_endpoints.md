# API endpoints

The contract between the four of us. Build against these shapes; don't discover them.

**Frozen after Phase 0.** To change an endpoint: say so in the group chat, update this file
first, then write code.

Base URL `http://localhost:3001`. All responses are JSON.

| | Owner | Endpoints |
|---|---|---|
| Browse | M1 | `/patients`, `/patients/:id`, `/clinics`, `/clinics/:id`, `/appointments` |
| Transaction + Audit | M2 | `POST /appointments`, `PATCH /appointments/:id/status`, `/patients/:id/audit` |
| Analytics | M3 | `/analytics/moving-average`, `/analytics/ranking`, `/analytics/summary`, `POST /analytics/refresh` |
| Map + Reviews | M4 | `/nurses/near`, `/clinics/:id/reviews/stats`, `/clinics/:id/catalog` |

---

## Conventions

**Lists** always return this envelope, because `<Pagination>` depends on it:

```json
{ "data": [ ... ], "page": 1, "limit": 25, "total": 25000 }
```

`page` is 1-based. `limit` defaults to 25, capped at 100.

**Single records** return the object directly, not wrapped.

**Errors** always return `{ "error": "<sentence a user can read>" }` with an appropriate status.
Never build these by hand — `throw` and let `api/middleware/errors.js` translate.

| Status | When |
|---|---|
| 400 | Bad input, or `P0001` from a stored procedure |
| 404 | Record not found |
| 409 | `23505` — conflicts with the partial unique index |
| 500 | Anything else |

**Money is a string.** `node-postgres` returns `DECIMAL(10,2)` as a string to avoid float
drift. Keep it a string all the way to `<Money>`. Never `parseFloat` and do arithmetic in JS.

```json
"hsa_balance": "49070.00"
```

**Timestamps are ISO 8601 UTC**, e.g. `"2026-10-04T08:30:00.000Z"`. Format for display in the
browser, not on the server.

**IDs are UUID strings.**

---

## Browse — M1

### `GET /patients`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int | 1 | |
| `limit` | int | 25 | max 100 |
| `q` | string | `''` | case-insensitive match on `name` |

```json
{
  "data": [
    { "id": "a4f2c81e-...", "name": "Meera Raghavan", "hsa_balance": "49070.00" }
  ],
  "page": 1, "limit": 25, "total": 25000
}
```

### `GET /patients/:id`

```json
{
  "id": "a4f2c81e-...",
  "name": "Meera Raghavan",
  "hsa_balance": "49070.00",
  "open_appointment": {
    "id": "7c1a94e2-...", "clinic_id": "b03f5d71-...",
    "clinic_name": "Nilgiri Family Clinic",
    "status": "IN_CONSULTATION", "copay_amount": "250.00",
    "created_at": "2026-10-04T08:30:00.000Z"
  },
  "appointment_count": 7
}
```

`open_appointment` is `null` when the patient has no `WAITING` or `IN_CONSULTATION` row. The
Transaction screen uses it to disable booking before the user hits the 409.

**404** if no such patient.

### `GET /clinics`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page`, `limit` | int | 1, 25 | |
| `q` | string | `''` | matches `name` |
| `accepting` | bool | — | omit for all; `true`/`false` to filter |

```json
{
  "data": [
    {
      "id": "b03f5d71-...", "name": "Nilgiri Family Clinic",
      "latitude": 17.4532608, "longitude": 78.359518,
      "is_accepting_patients": true
    }
  ],
  "page": 1, "limit": 25, "total": 250
}
```

Latitude and longitude are numbers, not strings — they're `DOUBLE PRECISION`, not `DECIMAL`.
The Map screen uses this endpoint to populate its origin picker.

### `GET /clinics/:id`

The clinic fields above, plus:

```json
{
  "appointment_count": 240,
  "discharged_count": 216,
  "total_revenue": "54000.00"
}
```

### `GET /appointments`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page`, `limit` | int | 1, 25 | |
| `patient_id` | uuid | — | |
| `clinic_id` | uuid | — | |
| `status` | enum | — | `WAITING` \| `IN_CONSULTATION` \| `DISCHARGED` |

```json
{
  "data": [
    {
      "id": "7c1a94e2-...",
      "patient_id": "a4f2c81e-...", "patient_name": "Meera Raghavan",
      "clinic_id": "b03f5d71-...", "clinic_name": "Nilgiri Family Clinic",
      "copay_amount": "250.00", "status": "WAITING",
      "created_at": "2026-10-04T08:30:00.000Z"
    }
  ],
  "page": 1, "limit": 25, "total": 60000
}
```

Names are joined server-side. The browser should never make N+1 calls to resolve them.

---

## Transaction + Audit — M2

### `POST /appointments`

Calls `create_appointment_atomic(p_patient_id, p_clinic_id, p_copay_amount)`. Do not replicate
its logic in JavaScript.

```json
{ "patient_id": "a4f2c81e-...", "clinic_id": "b03f5d71-...", "copay_amount": "250.00" }
```

**201**

```json
{
  "appointment": {
    "id": "e9d2807a-...", "status": "WAITING",
    "copay_amount": "250.00", "created_at": "2026-10-05T18:02:11.000Z"
  },
  "balance_before": "49320.00",
  "balance_after": "49070.00",
  "audit_entry": {
    "id": "14ab6cf0-...", "action_type": "DEBIT",
    "amount_changed": "250.00", "balance_after": "49070.00",
    "timestamp": "2026-10-05T18:02:11.000Z"
  }
}
```

`audit_entry` is read back after the call. It was written by the trigger, not by us — showing
it is how the UI demonstrates the trigger fired.

**Failures.** Five distinct paths, all already carrying readable messages:

| Cause | SQLSTATE | Status | Message |
|---|---|---|---|
| Copay ≤ 0 | `P0001` | 400 | `Copay amount must be greater than zero` |
| Patient missing | `P0001` | 400 | `Patient <uuid> does not exist` |
| Clinic missing | `P0001` | 400 | `Clinic <uuid> does not exist` |
| Clinic closed | `P0001` | 400 | `Clinic <uuid> is not accepting patients` |
| Balance too low | `P0001` | 400 | `Insufficient HSA balance. Available: 120.00, Required: 250.00` |
| Second open appointment | `23505` | 409 | translated by middleware — the index raises this, not the procedure |

**Transaction handling.** An exception leaves the connection in an aborted state. Always
`ROLLBACK` before releasing it, or the *next* request on that connection fails for unrelated
reasons. See `api/routes/_TEMPLATE.js`.

### `PATCH /appointments/:id/status`

New in A2 — nothing in A1 moves an appointment between statuses. Needed to demonstrate the
partial unique index: discharge, then book again.

```json
{ "status": "DISCHARGED" }
```

Legal transitions: `WAITING → IN_CONSULTATION → DISCHARGED`. Reject anything else with **400**
`Cannot move an appointment from DISCHARGED back to WAITING.`

**200** returns the updated appointment.

### `GET /patients/:id/audit`

| Param | Type | Default | Notes |
|---|---|---|---|
| `page`, `limit` | int | 1, 25 | |
| `from`, `to` | ISO date | — | filters on `timestamp` |

```json
{
  "patient": { "id": "a4f2c81e-...", "name": "Meera Raghavan", "hsa_balance": "49070.00" },
  "data": [
    {
      "id": "14ab6cf0-...", "action_type": "DEBIT",
      "amount_changed": "250.00", "balance_after": "49070.00",
      "timestamp": "2026-10-05T18:02:11.000Z"
    }
  ],
  "page": 1, "limit": 25, "total": 42
}
```

**Note:** the running balance is already stored. `balance_after` is written by the trigger on
every movement, so there is no need to compute one — just render that column. We verified it
reconciles exactly: 0 mismatches across 25,000 patients.

Order newest-first. This needs `CREATE INDEX ON wallet_audit_logs (patient_id, timestamp DESC)`
(change C5) or it sequentially scans 116,655 rows per page load.

---

## Analytics — M3

### `GET /analytics/moving-average`

Wraps `sql/06_window_analytics.sql`. Returns one series for the chart.

| Param | Type | Required | Notes |
|---|---|---|---|
| `clinic_id` | uuid | yes | |
| `from`, `to` | ISO date | no | defaults to the last 90 days |

```json
{
  "clinic": { "id": "b03f5d71-...", "name": "Nilgiri Family Clinic" },
  "data": [
    {
      "revenue_date": "2026-09-28",
      "daily_revenue": "1250.00",
      "rolling_total_7day": "8400.00",
      "moving_avg_7day": "1200.00",
      "days_in_window": 7,
      "clinic_rank": 12
    }
  ]
}
```

Field names match the A1 query's output columns exactly — don't rename them.

> **Important.** `DENSE_RANK()` partitions by `revenue_date` across *all* clinics. If you filter
> by `clinic_id` inside the `daily_totals` CTE, the rank is computed over one clinic and comes
> back as `1` on every row.
>
> - **Date range** → safe to push into `daily_totals` / `reporting_period`. Cuts the row count.
> - **Clinic filter** → must be applied at the *outer* `SELECT`, after the window functions.
>
> Unfiltered the query returns ~134,750 rows in ~405 ms, which is far too much for a browser.

### `GET /analytics/ranking`

The leaderboard for one date, same query, filtered the other way.

| Param | Type | Default |
|---|---|---|
| `date` | ISO date | most recent date in the data |
| `limit` | int | 20 |

```json
{
  "date": "2026-09-28",
  "data": [
    { "clinic_rank": 1, "clinic_name": "Saraswati Urgent Care", "moving_avg_7day": "3480.00" },
    { "clinic_rank": 2, "clinic_name": "Nilgiri Family Clinic", "moving_avg_7day": "3120.00" }
  ]
}
```

Ties share a rank and the next clinic still gets the next number — that's why A1 used
`DENSE_RANK` rather than `RANK`. Expect ties at the bottom, since clinics with no revenue on a
date all sit at `0.00`.

### `GET /analytics/summary`

Reads the materialized view `clinic_monthly_discharges` (`clinic_id`, `discharge_month`,
`total_discharges`).

| Param | Type | Default |
|---|---|---|
| `month` | `YYYY-MM` | latest month present |

```json
{
  "month": "2026-09",
  "last_refreshed": "2026-10-05T17:04:00.000Z",
  "totals": { "clinics_reporting": 250, "total_discharges": 4820 },
  "data": [
    { "clinic_id": "b03f5d71-...", "clinic_name": "Nilgiri Family Clinic", "total_discharges": 31 }
  ]
}
```

`last_refreshed` does not exist in A1 — change C11 adds a one-row table that
`refresh_clinic_discharges_mv()` updates. Return `null` until that lands.

### `POST /analytics/refresh`

No body. Calls `refresh_clinic_discharges_mv()`, which runs `REFRESH MATERIALIZED VIEW
CONCURRENTLY` — non-blocking, which is why `idx_clinic_month_discharge` has to exist.

```json
{ "refreshed_at": "2026-10-05T18:11:00.000Z" }
```

Takes a few seconds. Disable the button while it's in flight.

---

## Map + Reviews — M4

### `GET /nurses/near`

Wraps Workflow 3. Pipeline lives in `api/pipelines/geonear.js` so the A1 script and the API
share one definition.

| Param | Type | Default | Notes |
|---|---|---|---|
| `lat`, `lng` | float | required | origin |
| `radius` | int | 5000 | metres |

```json
{
  "origin": { "lat": 17.4532608, "lng": 78.359518 },
  "radius": 5000,
  "data": [
    {
      "nurse_id": "nurse_3",
      "location": { "type": "Point", "coordinates": [78.3612, 17.4498] },
      "distance_m": 412.6,
      "active": true,
      "created_at": "2026-10-05T17:09:44.000Z"
    }
  ]
}
```

Sorted nearest-first. **GeoJSON is `[longitude, latitude]`** — Leaflet wants `[lat, lng]`, so
swap at the component boundary, not in the API.

A1 used `$limit: 1`, which returns the nearest *ping* rather than the nearest *nurse*
(defect D5). Change C4 groups by `nurse_id` and returns one entry per nurse at their closest
position — that's what this shape assumes.

The Map screen polls this every few seconds. Keep it cheap; it's an indexed `$geoNear`, ~6 ms.

### `GET /clinics/:id/reviews/stats`

Wraps Workflow 4. A1's pipeline has no `$match`, so it reports globally — change C7 adds one.

```json
{
  "clinic_id": "b03f5d71-...",
  "rating_distribution": [
    { "rating": 1, "count": 1240 }, { "rating": 2, "count": 1810 },
    { "rating": 3, "count": 2050 }, { "rating": 4, "count": 2390 },
    { "rating": 5, "count": 2510 }
  ],
  "frequent_tags": [
    { "tag": "thorough", "frequency": 4120 },
    { "tag": "empathetic", "frequency": 3890 }
  ],
  "average_rating": 3.42,
  "total_reviews": 10000
}
```

The pipeline emits `$bucket` output as `{ _id, count }` and tags as `{ _id, frequency }`.
Reshape to `rating` / `tag` in the route so the chart code isn't dealing with `_id`.

Tag vocabulary is fixed: `empathetic`, `punctual`, `clear-instructions`, `rushed`,
`unprofessional`, `friendly`, `thorough`.

Returns empty arrays and `total_reviews: 0` for a clinic with no reviews — the UI must handle
that, and **it is the current state for every clinic** until change C1 lands.

### `GET /clinics/:id/catalog`

One or more `MedicalCatalogs` documents. The spec requires displaying at least one flexible
catalog document readably.

```json
{
  "clinic_id": "b03f5d71-...",
  "data": [
    {
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

`availability` and `medications_handled` are variable-length — render them as nested lists,
not a fixed table. This is the document whose shape would be awkward in SQL, so it's worth
showing properly rather than dumping JSON.

Same as above: empty until C1 lands.

---

## Not in scope

No authentication. The spec says real login is not required — actor switching is a dropdown
in the UI that sets `patient_id` on requests.
