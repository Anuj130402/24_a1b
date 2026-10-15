// Workflow 2 (window analytics) and the materialized view.

import { Router } from 'express';
import { pg } from '../db.js';
import { badRequest } from '../middleware/errors.js';

const router = Router();

// Default window when the caller gives no dates.
const DEFAULT_DAYS = 90;

// clinic_moving_average() cross-joins 250 clinics against every day in
// the range, so the row count is 250 x days. A two-year ceiling keeps
// the worst case near 180,000 rows; an unbounded range (someone typing
// year 1900) would build millions and spill heavily to disk.
const MAX_RANGE_DAYS = 730;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates YYYY-MM-DD and that the date actually exists. */
function parseDate(value, label) {
  if (!DATE_RE.test(value)) {
    throw badRequest(`${label} must be a date in the format YYYY-MM-DD.`);
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw badRequest(`${label} is not a real date.`);
  }
  return d;
}

/** Shared by the chart and the leaderboard. */
function validateRange(from, to) {
  const a = parseDate(from, 'from');
  const b = parseDate(to, 'to');
  if (a > b) throw badRequest('The "from" date must not be after the "to" date.');
  const days = Math.round((b - a) / 86400000);
  if (days > MAX_RANGE_DAYS) {
    throw badRequest(
      `That range covers ${days} days. Please request ${MAX_RANGE_DAYS} days or fewer.`
    );
  }
}

// Dates are cast to text in SQL and never round-tripped through a JS
// Date. node-postgres materialises a DATE at LOCAL midnight, so
// .toISOString() on a UTC+5:30 machine shifts it back into the previous
// day — which is why the ranking header read one day early.
async function defaultRange() {
  const { rows: [r] } = await pg.query(
    `SELECT (MAX((discharged_at AT TIME ZONE 'UTC')::date) - $1::int)::text AS from_date,
             MAX((discharged_at AT TIME ZONE 'UTC')::date)::text            AS to_date
       FROM appointments WHERE status = 'DISCHARGED'`,
    [DEFAULT_DAYS]
  );
  const today = new Date().toLocaleDateString('en-CA');
  return { from: r?.from_date ?? today, to: r?.to_date ?? today };
}

// --- Workflow 2: moving average for one clinic ----------------------
//
// clinic_moving_average() is sql/06_window_analytics.sql parameterised
// by date. The clinic filter is applied HERE, on the function's result,
// because DENSE_RANK() partitions by revenue_date across all clinics —
// filtering inside would make every rank 1.

router.get('/analytics/moving-average', async (req, res, next) => {
  try {
    const clinicId = req.query.clinic_id;
    if (!clinicId) throw badRequest('clinic_id is required.');

    const range = await defaultRange();
    const from = req.query.from || range.from;
    const to = req.query.to || range.to;
    validateRange(from, to);

    const { rows } = await pg.query(
      `SELECT revenue_date, daily_revenue, rolling_total_7day,
              moving_avg_7day, days_in_window, clinic_rank
         FROM clinic_moving_average($1::date, $2::date)
        WHERE clinic_id = $3
        ORDER BY revenue_date`,
      [from, to, clinicId]
    );

    const { rows: clinic } = await pg.query(
      'SELECT id, name FROM clinics WHERE id = $1',
      [clinicId]
    );

    res.json({ clinic: clinic[0] ?? null, from, to, data: rows });
  } catch (err) { next(err); }
});

// --- ranking leaderboard for one date -------------------------------

router.get('/analytics/ranking', async (req, res, next) => {
  try {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    let date = req.query.date;

    if (date) parseDate(date, 'date');

    if (!date) {
      // NOT simply MAX(discharged_at). Discharging two appointments by
      // hand during a demo makes today the most recent discharge date,
      // and on that date the trailing 7-day window holds almost no
      // revenue — so every clinic averages 0.00 and all 250 tie at
      // rank 1. Default to the most recent day of real activity.
      const { rows: [r] } = await pg.query(
        `SELECT (discharged_at AT TIME ZONE 'UTC')::date::text AS d
           FROM appointments
          WHERE status = 'DISCHARGED' AND discharged_at IS NOT NULL
          GROUP BY 1
         HAVING count(*) >= 20
          ORDER BY 1 DESC
          LIMIT 1`
      );
      date = r?.d ?? null;
      if (!date) return res.json({ date: null, data: [] });
    }

    // A 7-day window needs the 6 preceding days in range for the average
    // to be a real 7-day average on the target date. The subtraction is
    // done in SQL so no JS Date is involved.
    const { rows } = await pg.query(
      `SELECT clinic_id, clinic_name, moving_avg_7day, daily_revenue, clinic_rank
         FROM clinic_moving_average(($1::date - 6), $1::date)
        WHERE revenue_date = $1::date
        ORDER BY clinic_rank, clinic_name
        LIMIT $2`,
      [date, limit]
    );

    // Bounds for the date picker. Outside this range every clinic
    // averages 0.00 and the leaderboard is a wall of ties — the picker
    // constrains the input rather than letting that happen silently.
    const { rows: [bounds] } = await pg.query(
      `SELECT MIN((discharged_at AT TIME ZONE 'UTC')::date)::text AS min_date,
              MAX((discharged_at AT TIME ZONE 'UTC')::date)::text AS max_date
         FROM appointments
        WHERE status = 'DISCHARGED' AND discharged_at IS NOT NULL`
    );

    res.json({ date, bounds, data: rows });
  } catch (err) { next(err); }
});

// --- materialized view summary --------------------------------------

router.get('/analytics/summary', async (req, res, next) => {
  try {
    let month = req.query.month; // YYYY-MM
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw badRequest('month must be in the format YYYY-MM.');
    }
    if (!month) {
      const { rows: [r] } = await pg.query(
        'SELECT MAX(discharge_month) AS m FROM clinic_monthly_discharges'
      );
      month = r.m ? new Date(r.m).toISOString().slice(0, 7) : null;
      if (!month) {
        return res.json({
          month: null, months: [], last_refreshed: null, totals: null, data: [],
        });
      }
    }

    const { rows } = await pg.query(
      `SELECT v.clinic_id, c.name AS clinic_name,
              v.total_discharges, v.total_revenue
         FROM clinic_monthly_discharges v
         JOIN clinics c ON c.id = v.clinic_id
        WHERE DATE_TRUNC('month', v.discharge_month) = ($1 || '-01')::date
        ORDER BY v.total_discharges DESC`,
      [month]
    );

    const { rows: [refreshed] } = await pg.query(
      `SELECT refreshed_at FROM mv_refresh_log
        WHERE view_name = 'clinic_monthly_discharges'`
    );

    // Every month the view holds, so the UI can offer a picker without
    // guessing which months exist.
    const { rows: months } = await pg.query(
      `SELECT DISTINCT to_char(discharge_month, 'YYYY-MM') AS month
         FROM clinic_monthly_discharges
        ORDER BY 1 DESC`
    );

    res.json({
      month,
      months: months.map((m) => m.month),
      last_refreshed: refreshed?.refreshed_at ?? null,
      totals: {
        clinics_reporting: rows.length,
        total_discharges: rows.reduce((s, r) => s + Number(r.total_discharges), 0),
      },
      data: rows,
    });
  } catch (err) { next(err); }
});

// --- refresh the materialized view -----------------------------------
//
// refresh_clinic_discharges_mv() runs REFRESH ... CONCURRENTLY, which is
// non-blocking and is why idx_clinic_month_discharge has to exist.

router.post('/analytics/refresh', async (_req, res, next) => {
  try {
    const { rows: [r] } = await pg.query('SELECT refresh_clinic_discharges_mv() AS refreshed_at');
    res.json({ refreshed_at: r.refreshed_at });
  } catch (err) { next(err); }
});

export default router;
