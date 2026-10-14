-- ============================================================
-- Assignment 2 additions
-- ------------------------------------------------------------
-- Nothing in sql/01..06 is modified. Everything A2 needs that
-- A1 did not provide lives here, so the diff against the
-- inherited submission is this one file.
--
-- Run AFTER 01..06 and after postgres_seeder.py.
--   psql -d careconnect -f sql/07_a2_additions.sql
--
-- Change IDs refer to docs/handover_note.md section 5.
-- ============================================================


-- ============================================================
-- C5 — indexes for the UI's access patterns
-- ------------------------------------------------------------
-- A1 indexed for A1's queries. The screens have different ones.
-- Without the first index the Audit Trail screen sequentially
-- scans 116,655 rows on every page load, and the seeder's own
-- verify() check 8 takes ~10 minutes (handover D6).
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_audit_patient_time
    ON wallet_audit_logs (patient_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_appt_patient_time
    ON appointments (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_appt_clinic_time
    ON appointments (clinic_id, created_at DESC);

-- Browse search boxes use ILIKE on name; index the lowered form
-- so the planner can use it for prefix matches.
CREATE INDEX IF NOT EXISTS idx_patients_name_lower
    ON patients (lower(name));

CREATE INDEX IF NOT EXISTS idx_clinics_name_lower
    ON clinics (lower(name));


-- ============================================================
-- C9 — patient coordinates
-- ------------------------------------------------------------
-- "Nearest nurse to patient" needs an origin. A1's patients
-- table has only id, name and hsa_balance.
-- Nullable: a patient without coordinates simply cannot be used
-- as a map origin, which the UI handles.
-- ============================================================

ALTER TABLE patients ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Give each patient a position near a clinic they have actually
-- visited, so the map origin is somewhere plausible.
UPDATE patients p
   SET latitude  = c.latitude  + (random() - 0.5) * 0.04,
       longitude = c.longitude + (random() - 0.5) * 0.04
  FROM (
        SELECT DISTINCT ON (a.patient_id)
               a.patient_id, cl.latitude, cl.longitude
          FROM appointments a
          JOIN clinics cl ON cl.id = a.clinic_id
         ORDER BY a.patient_id, a.created_at DESC
       ) c
 WHERE c.patient_id = p.id
   AND p.latitude IS NULL;


-- ============================================================
-- C10 — appointment lifecycle
-- ------------------------------------------------------------
-- A1 has no way to move an appointment between statuses, so the
-- partial unique index can never be demonstrated: once a patient
-- has an open appointment they are blocked forever.
--
-- discharged_at also fixes the materialized view, which counted
-- "monthly discharges" by created_at, i.e. the month the
-- appointment was BOOKED, not the month it was completed.
-- ============================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS discharged_at TIMESTAMPTZ;

-- Backfill the 54,000 already-DISCHARGED rows. Without this the
-- rebuilt materialized view would be empty.
UPDATE appointments
   SET discharged_at = created_at + (random() * INTERVAL '6 hours')
 WHERE status = 'DISCHARGED'
   AND discharged_at IS NULL;

-- Keep the column honest from here on.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_discharged_at;
ALTER TABLE appointments ADD CONSTRAINT chk_discharged_at CHECK (
    (status =  'DISCHARGED' AND discharged_at IS NOT NULL) OR
    (status <> 'DISCHARGED' AND discharged_at IS NULL)
);

-- A1 enforced copay > 0 only inside the procedure, so a direct
-- INSERT could bypass it (handover, suggestion 10).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS chk_copay_positive;
ALTER TABLE appointments ADD CONSTRAINT chk_copay_positive
    CHECK (copay_amount > 0);


CREATE OR REPLACE PROCEDURE advance_appointment_status(
    IN p_appointment_id UUID,
    IN p_new_status     VARCHAR(50)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current VARCHAR(50);
BEGIN
    -- Lock the row so two clients cannot advance it at once.
    SELECT status INTO v_current
      FROM appointments
     WHERE id = p_appointment_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Appointment % does not exist', p_appointment_id;
    END IF;

    IF p_new_status NOT IN ('WAITING', 'IN_CONSULTATION', 'DISCHARGED') THEN
        RAISE EXCEPTION '% is not a valid status', p_new_status;
    END IF;

    -- Forward only: WAITING -> IN_CONSULTATION -> DISCHARGED.
    IF NOT (
         (v_current = 'WAITING'         AND p_new_status = 'IN_CONSULTATION') OR
         (v_current = 'IN_CONSULTATION' AND p_new_status = 'DISCHARGED')      OR
         (v_current = 'WAITING'         AND p_new_status = 'DISCHARGED')
    ) THEN
        RAISE EXCEPTION 'Cannot move an appointment from % to %',
                        v_current, p_new_status;
    END IF;

    UPDATE appointments
       SET status        = p_new_status,
           discharged_at = CASE WHEN p_new_status = 'DISCHARGED'
                                THEN NOW() ELSE NULL END
     WHERE id = p_appointment_id;
END;
$$;


-- ============================================================
-- C11 — materialized view refresh log
-- ------------------------------------------------------------
-- The Analytics screen must show a "last refreshed" time.
-- PostgreSQL does not record one, so we keep our own.
-- ============================================================

CREATE TABLE IF NOT EXISTS mv_refresh_log (
    view_name    TEXT PRIMARY KEY,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Rebuild the view against discharged_at rather than created_at.
-- DROP + CREATE because a materialized view's query cannot be altered.
DROP MATERIALIZED VIEW IF EXISTS clinic_monthly_discharges CASCADE;

CREATE MATERIALIZED VIEW clinic_monthly_discharges AS
SELECT
    clinic_id,
    DATE_TRUNC('month', discharged_at) AS discharge_month,
    COUNT(id)                          AS total_discharges,
    SUM(copay_amount)                  AS total_revenue
FROM appointments
WHERE status = 'DISCHARGED'
  AND discharged_at IS NOT NULL
GROUP BY clinic_id, DATE_TRUNC('month', discharged_at);

-- REFRESH ... CONCURRENTLY requires a unique index on the view.
CREATE UNIQUE INDEX idx_clinic_month_discharge
    ON clinic_monthly_discharges (clinic_id, discharge_month);


DROP FUNCTION IF EXISTS refresh_clinic_discharges_mv();

CREATE FUNCTION refresh_clinic_discharges_mv()RETURNS TIMESTAMPTZ AS $$
DECLARE
    v_now TIMESTAMPTZ;
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY clinic_monthly_discharges;

    v_now := NOW();
    INSERT INTO mv_refresh_log (view_name, refreshed_at)
    VALUES ('clinic_monthly_discharges', v_now)
    ON CONFLICT (view_name)
    DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at;

    RETURN v_now;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- C6 — Workflow 2, parameterised
-- ------------------------------------------------------------
-- Identical logic to sql/06_window_analytics.sql. The only
-- changes are the date-range parameters and clinic_id in the
-- output. Unfiltered the original returns ~134,750 rows, which
-- is far too much to hand to a browser.
--
-- IMPORTANT: DENSE_RANK() partitions by revenue_date across ALL
-- clinics, so the rank is only meaningful when every clinic is
-- present. The date range is therefore pushed down into the
-- CTEs (safe — it narrows rows, not the competitor set), while
-- a clinic filter MUST be applied by the caller on the result:
--
--   SELECT * FROM clinic_moving_average('2026-07-01','2026-10-01')
--    WHERE clinic_id = $1;
--
-- Filtering by clinic inside the CTEs would make every rank 1.
-- ============================================================

DROP FUNCTION IF EXISTS clinic_moving_average(DATE, DATE);

CREATE FUNCTION clinic_moving_average(p_from DATE, p_to DATE)
RETURNS TABLE (
    clinic_id          UUID,
    clinic_name        VARCHAR(255),
    revenue_date       DATE,
    daily_revenue      NUMERIC,
    rolling_total_7day NUMERIC,
    moving_avg_7day    NUMERIC,
    days_in_window     BIGINT,
    clinic_rank        BIGINT
)
LANGUAGE sql
STABLE
AS $$
    WITH daily_totals AS (
        SELECT
            a.clinic_id,
            (a.discharged_at AT TIME ZONE 'UTC')::date AS revenue_date,
            SUM(a.copay_amount) AS daily_revenue
        FROM appointments a
        WHERE a.status = 'DISCHARGED'
          AND a.discharged_at IS NOT NULL
          AND (a.discharged_at AT TIME ZONE 'UTC')::date
              BETWEEN p_from AND p_to
        GROUP BY a.clinic_id, (a.discharged_at AT TIME ZONE 'UTC')::date
    ),
    clinic_calendar AS (
        -- every clinic gets a row for every day in the range, so a
        -- day with no discharges counts as 0.00 instead of dropping
        -- out of the window. 6 preceding rows + the current row is
        -- then exactly a 7 CALENDAR day span.
        SELECT
            c.id    AS clinic_id,
            c.name  AS clinic_name,
            d::date AS revenue_date
        FROM clinics c
        CROSS JOIN generate_series(
            p_from::timestamp, p_to::timestamp, INTERVAL '1 day'
        ) AS d
    ),
    daily_revenue AS (
        SELECT
            cal.clinic_id,
            cal.clinic_name,
            cal.revenue_date,
            COALESCE(t.daily_revenue, 0.00) AS daily_revenue
        FROM clinic_calendar cal
        LEFT JOIN daily_totals t
               ON t.clinic_id    = cal.clinic_id
              AND t.revenue_date = cal.revenue_date
    ),
    rolling AS (
        SELECT
            clinic_id,
            clinic_name,
            revenue_date,
            daily_revenue,
            SUM(daily_revenue)            OVER seven_days AS rolling_total_7day,
            ROUND(AVG(daily_revenue)      OVER seven_days, 2) AS moving_avg_7day,
            COUNT(*)                      OVER seven_days AS days_in_window
        FROM daily_revenue
        WINDOW seven_days AS (
            PARTITION BY clinic_id
            ORDER BY revenue_date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        )
    )
    SELECT
        clinic_id,
        clinic_name,
        revenue_date,
        daily_revenue,
        rolling_total_7day,
        moving_avg_7day,
        days_in_window,
        -- DENSE_RANK, not RANK: clinics tied on the same average
        -- share a rank and the next clinic still gets the next
        -- number rather than a gap.
        DENSE_RANK() OVER (
            PARTITION BY revenue_date
            ORDER BY moving_avg_7day DESC
        ) AS clinic_rank
    FROM rolling
    ORDER BY revenue_date, clinic_rank, clinic_name;
$$;


-- ============================================================
-- Populate and report
-- ============================================================

SELECT refresh_clinic_discharges_mv();

ANALYZE patients;
ANALYZE appointments;
ANALYZE wallet_audit_logs;

\echo ''
\echo '07_a2_additions.sql applied.'
SELECT
    (SELECT count(*) FROM patients WHERE latitude IS NOT NULL)      AS patients_with_coords,
    (SELECT count(*) FROM appointments WHERE discharged_at IS NOT NULL) AS appts_with_discharge_time,
    (SELECT count(*) FROM clinic_monthly_discharges)                AS mv_rows,
    (SELECT refreshed_at FROM mv_refresh_log
      WHERE view_name = 'clinic_monthly_discharges')                AS mv_last_refreshed;
