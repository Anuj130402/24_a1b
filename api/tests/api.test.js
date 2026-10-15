/**
 * CareConnect API tests
 *
 * These cover the parts most likely to break and hardest to eyeball:
 * the Workflow 1 stored procedure (success plus every failure path), the
 * audit trigger firing on its own, the partial unique index, the status
 * lifecycle, and the shape of each workflow's response.
 *
 * They run against a live server and a seeded database:
 *
 *     cd api && node app.js        # terminal 1
 *     cd api && npm test           # terminal 2
 *
 * They are integration tests on purpose. The point of this project is
 * that the DATABASE holds the logic, so a test that mocked the database
 * away would assert almost nothing worth asserting.
 *
 * NOTE: the booking tests write to the database (one appointment, one
 * audit row, one status transition). That is intentional — it is the
 * only way to prove the trigger fires — but it means the tests mutate
 * seeded data. Re-run the seeders for a pristine state.
 */

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_API_URL ?? 'http://localhost:3001';

async function api(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const json = (method, payload) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

// Shared across the booking tests, which run in order.
const ctx = {};

before(async () => {
  const health = await api('/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(
      `API not reachable at ${BASE}. Start it with "node app.js" before running tests.`
    );
  }
  assert.equal(health.body.postgres, 'ok', 'PostgreSQL must be reachable');
  assert.equal(health.body.mongo, 'ok', 'MongoDB must be reachable');
});

// ---------------------------------------------------------------- health

describe('health', () => {
  test('reports both databases', async () => {
    const { status, body } = await api('/health');
    assert.equal(status, 200);
    assert.equal(body.api, 'ok');
  });
});

// ---------------------------------------------------------------- browse

describe('browse', () => {
  test('patients are paginated, not dumped', async () => {
    const { status, body } = await api('/patients?page=1&limit=5');
    assert.equal(status, 200);
    assert.equal(body.data.length, 5, 'limit must be honoured server-side');
    assert.equal(body.page, 1);
    assert.equal(body.limit, 5);
    assert.ok(body.total > 5, 'total counts every match, not just this page');
  });

  test('page 2 returns different rows from page 1', async () => {
    const p1 = await api('/patients?page=1&limit=5');
    const p2 = await api('/patients?page=2&limit=5');
    const ids1 = p1.body.data.map((r) => r.id);
    const ids2 = p2.body.data.map((r) => r.id);
    assert.equal(ids1.filter((id) => ids2.includes(id)).length, 0);
  });

  test('search narrows the result set', async () => {
    const all = await api('/patients?limit=1');
    const one = await api('/patients?limit=1&q=zzzzzznomatch');
    assert.ok(one.body.total < all.body.total);
    assert.equal(one.body.data.length, 0);
  });

  test('appointments join patient and clinic names server-side', async () => {
    const { body } = await api('/appointments?limit=1');
    const row = body.data[0];
    assert.ok(row.patient_name, 'no N+1 lookups from the browser');
    assert.ok(row.clinic_name);
  });

  test('an empty filter means no filter, not an error', async () => {
    // ?patient_id= arrives as "" and must not reach PostgreSQL as a uuid.
    const { status, body } = await api('/appointments?patient_id=&status=&limit=2');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
  });

  test('a malformed uuid is rejected cleanly, not with a 500', async () => {
    const { status, body } = await api('/patients/not-a-uuid');
    assert.equal(status, 400);
    assert.ok(body.error);
  });
});

// ------------------------------------------- workflow 1: atomic booking

describe('workflow 1 — create_appointment_atomic', () => {
  test('finds a bookable patient and an open clinic', async () => {
    const clinics = await api('/clinics?accepting=true&limit=1');
    assert.ok(clinics.body.data.length, 'need at least one accepting clinic');
    ctx.clinic = clinics.body.data[0];

    const closed = await api('/clinics?accepting=false&limit=1');
    ctx.closedClinic = closed.body.data[0] ?? null;

    // A patient with no open consultation and enough balance for the copay.
    const list = await api('/patients?limit=40');
    for (const p of list.body.data) {
      if (Number(p.hsa_balance) < 500) continue;
      const detail = await api(`/patients/${p.id}`);
      if (!detail.body.open_appointment) {
        ctx.patient = detail.body;
        break;
      }
    }
    assert.ok(ctx.patient, 'no free patient with a usable balance in the first 40');
  });

  test('a booking deducts the copay and returns the new appointment', async () => {
    const copay = '250.00';
    const { status, body } = await api(
      '/appointments',
      json('POST', {
        patient_id: ctx.patient.id,
        clinic_id: ctx.clinic.id,
        copay_amount: copay,
      })
    );

    assert.equal(status, 201);
    assert.equal(body.appointment.status, 'WAITING', 'new visits start as WAITING');
    assert.equal(
      Number(body.balance_before) - Number(body.balance_after),
      Number(copay),
      'balance must drop by exactly the copay'
    );

    ctx.appointmentId = body.appointment.id;
    ctx.auditEntry = body.audit_entry;
    ctx.balanceAfter = body.balance_after;
  });

  test('the audit trigger wrote the ledger row by itself', async () => {
    // Nothing in the API inserts into wallet_audit_logs. If this row
    // exists, trigger_audit_hsa_balance fired.
    const e = ctx.auditEntry;
    assert.ok(e, 'no audit entry returned');
    assert.equal(e.action_type, 'DEBIT');
    assert.equal(Number(e.amount_changed), 250);
    assert.equal(
      Number(e.balance_after),
      Number(ctx.balanceAfter),
      'ledger balance must agree with the patient row'
    );
  });

  test('the ledger row is visible on the audit trail', async () => {
    const { status, body } = await api(`/patients/${ctx.patient.id}/audit?limit=1`);
    assert.equal(status, 200);
    assert.equal(body.data[0].id, ctx.auditEntry.id, 'newest entry first');
  });

  test('FAILURE: a second open consultation is blocked by the partial unique index', async () => {
    const { status, body } = await api(
      '/appointments',
      json('POST', {
        patient_id: ctx.patient.id,
        clinic_id: ctx.clinic.id,
        copay_amount: '100.00',
      })
    );
    assert.equal(status, 409, 'idx_active_consult must reject this');
    assert.match(body.error, /already in an active consultation/i);
  });

  test('FAILURE: a copay beyond the balance is rejected', async () => {
    const free = await findFreePatient();
    const { status, body } = await api(
      '/appointments',
      json('POST', {
        patient_id: free.id,
        clinic_id: ctx.clinic.id,
        copay_amount: '99999999.00',
      })
    );
    assert.equal(status, 400);
    assert.match(body.error, /insufficient hsa balance/i);
  });

  test('FAILURE: a copay of zero is rejected by the procedure', async () => {
    const free = await findFreePatient();
    const { status, body } = await api(
      '/appointments',
      json('POST', {
        patient_id: free.id,
        clinic_id: ctx.clinic.id,
        copay_amount: '0',
      })
    );
    assert.equal(status, 400);
    assert.match(body.error, /greater than zero/i);
  });

  test('FAILURE: a clinic closed to new patients is rejected', async (t) => {
    if (!ctx.closedClinic) return t.skip('no closed clinic in the seed');
    const free = await findFreePatient();
    const { status, body } = await api(
      '/appointments',
      json('POST', {
        patient_id: free.id,
        clinic_id: ctx.closedClinic.id,
        copay_amount: '100.00',
      })
    );
    assert.equal(status, 400);
    assert.match(body.error, /not accepting patients/i);
  });
});

// ------------------------------------------------- status lifecycle

describe('appointment lifecycle', () => {
  test('advances WAITING to IN_CONSULTATION to DISCHARGED', async () => {
    let r = await api(
      `/appointments/${ctx.appointmentId}/status`,
      json('PATCH', { status: 'IN_CONSULTATION' })
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'IN_CONSULTATION');

    r = await api(
      `/appointments/${ctx.appointmentId}/status`,
      json('PATCH', { status: 'DISCHARGED' })
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'DISCHARGED');
    assert.ok(r.body.discharged_at, 'discharged_at must be stamped');
  });

  test('refuses to move an appointment backwards', async () => {
    const { status, body } = await api(
      `/appointments/${ctx.appointmentId}/status`,
      json('PATCH', { status: 'WAITING' })
    );
    assert.equal(status, 400);
    assert.match(body.error, /cannot move an appointment/i);
  });

  test('discharging frees the patient to book again', async () => {
    // The whole point of the partial unique index: it constrains only
    // open visits, so a discharged patient is bookable once more.
    const { status } = await api(
      '/appointments',
      json('POST', {
        patient_id: ctx.patient.id,
        clinic_id: ctx.clinic.id,
        copay_amount: '100.00',
      })
    );
    assert.equal(status, 201);
  });
});

// ----------------------------------------- workflow 2: window analytics

describe('workflow 2 — window analytics', () => {
  test('the moving average carries the window-function columns', async () => {
    const clinics = await api('/clinics?limit=1');
    const id = clinics.body.data[0].id;
    const { status, body } = await api(`/analytics/moving-average?clinic_id=${id}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.data));
    if (body.data.length) {
      const row = body.data[0];
      for (const col of [
        'revenue_date', 'daily_revenue', 'rolling_total_7day',
        'moving_avg_7day', 'days_in_window', 'clinic_rank',
      ]) {
        assert.ok(col in row, `missing ${col}`);
      }
    }
  });

  test('clinic_id is required', async () => {
    const { status } = await api('/analytics/moving-average');
    assert.equal(status, 400);
  });

  test('a malformed date is a 400, not a crash', async () => {
    const clinics = await api('/clinics?limit=1');
    const id = clinics.body.data[0].id;
    const { status } = await api(
      `/analytics/moving-average?clinic_id=${id}&from=not-a-date`
    );
    assert.equal(status, 400);
  });

  test('the ranking is a DENSE_RANK leaderboard across clinics', async () => {
    const { status, body } = await api('/analytics/ranking?limit=10');
    assert.equal(status, 200);
    assert.ok(body.data.length > 1, 'ranking compares clinics against each other');
    const ranks = body.data.map((r) => Number(r.clinic_rank));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'ranks ascend');
    // DENSE_RANK leaves no gaps: consecutive ranks differ by 0 or 1.
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(ranks[i] - ranks[i - 1] <= 1, 'DENSE_RANK must not skip numbers');
    }
  });

  test('the materialized view summary refreshes and records when', async () => {
    const before = await api('/analytics/summary');
    assert.equal(before.status, 200);
    assert.ok(before.body.totals.total_discharges > 0);

    const refresh = await api('/analytics/refresh', { method: 'POST' });
    assert.equal(refresh.status, 200);
    assert.ok(refresh.body.refreshed_at, 'refresh_clinic_discharges_mv must return a time');

    const after = await api('/analytics/summary');
    assert.ok(after.body.last_refreshed, 'mv_refresh_log must be written');
  });
});

// ------------------------------------------- workflow 3: nearest nurse

describe('workflow 3 — $geoNear', () => {
  test('finds nurses from a clinic origin, nearest first, one row per nurse', async () => {
    const clinics = await api('/clinics?limit=25');
    let found = null;
    for (const c of clinics.body.data) {
      const r = await api(`/nurses/near?clinic_id=${c.id}&radius=25000`);
      if (r.body.data.length) { found = r.body; break; }
    }
    assert.ok(found, 'no nurses within 25km of the first 25 clinics — reseed Mongo');

    const distances = found.data.map((n) => n.distance_m);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'sorted by distance');

    const ids = found.data.map((n) => n.nurse_id);
    assert.equal(new Set(ids).size, ids.length, 'grouped: one entry per nurse, not per ping');

    assert.ok(found.data.every((n) => n.active), 'only active nurses are returned');
  });

  test('requires a usable origin', async () => {
    const { status } = await api('/nurses/near');
    assert.equal(status, 400);
  });
});

// ------------------------------------ workflow 4: faceted review stats

describe('workflow 4 — $facet', () => {
  test('returns all three facets in one response', async () => {
    const clinics = await api('/clinics?limit=10');
    let stats = null;
    for (const c of clinics.body.data) {
      const r = await api(`/clinics/${c.id}/reviews/stats`);
      if (r.body.total_reviews > 0) { stats = r.body; break; }
    }
    assert.ok(stats, 'no clinic had reviews — Mongo ids may not match PostgreSQL');

    assert.equal(stats.rating_distribution.length, 5, 'one bucket per star, 1..5');
    assert.deepEqual(
      stats.rating_distribution.map((d) => d.rating),
      [1, 2, 3, 4, 5]
    );

    const summed = stats.rating_distribution.reduce((s, d) => s + d.count, 0);
    assert.equal(summed, stats.total_reviews, 'buckets must account for every review');

    assert.ok(stats.average_rating >= 1 && stats.average_rating <= 5);
    assert.ok(stats.frequent_tags.length > 0);
    assert.ok(stats.frequent_tags.length <= 5, 'top 5 only');
  });

  test('the flexible catalog keeps its nested shape', async () => {
    const clinics = await api('/clinics?limit=10');
    let catalog = null;
    for (const c of clinics.body.data) {
      const r = await api(`/clinics/${c.id}/catalog`);
      if (r.body.data.length) { catalog = r.body.data[0]; break; }
    }
    assert.ok(catalog, 'no catalog documents resolved to a real clinic');
    assert.ok(Array.isArray(catalog.availability));
    assert.ok(Array.isArray(catalog.medications_handled));
    assert.ok(Array.isArray(catalog.availability[0].slots), 'nested arrays survive');
  });
});

// --------------------------------------------------------------- helper

/** A patient with no open consultation, so a booking test starts clean. */
async function findFreePatient() {
  const list = await api('/patients?limit=40');
  for (const p of list.body.data) {
    const detail = await api(`/patients/${p.id}`);
    if (!detail.body.open_appointment) return detail.body;
  }
  throw new Error('no patient without an open appointment in the first 40');
}
