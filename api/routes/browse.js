// Browse screen: patients, clinics, appointments.

import { Router } from 'express';
import { pg } from '../db.js';
import { notFound } from '../middleware/errors.js';

const router = Router();

function paging(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

// --- patients -------------------------------------------------------

router.get('/patients', async (req, res, next) => {
  try {
    const { page, limit, offset } = paging(req);
    const q = req.query.q ?? '';

    const { rows } = await pg.query(
      `SELECT id, name, hsa_balance, latitude, longitude
         FROM patients
        WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
        ORDER BY name
        LIMIT $2 OFFSET $3`,
      [q, limit, offset]
    );

    const { rows: [{ count }] } = await pg.query(
      `SELECT count(*)::int AS count FROM patients
        WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')`,
      [q]
    );

    res.json({ data: rows, page, limit, total: count });
  } catch (err) { next(err); }
});

router.get('/patients/:id', async (req, res, next) => {
  try {
    const { rows } = await pg.query(
      `SELECT id, name, hsa_balance, latitude, longitude
         FROM patients WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) throw notFound('Patient');

    // The Transaction screen uses this to disable booking before the
    // partial unique index raises a 409.
    const { rows: open } = await pg.query(
      `SELECT a.id, a.clinic_id, c.name AS clinic_name, a.status,
              a.copay_amount, a.created_at
         FROM appointments a
         JOIN clinics c ON c.id = a.clinic_id
        WHERE a.patient_id = $1
          AND a.status IN ('WAITING', 'IN_CONSULTATION')
        LIMIT 1`,
      [req.params.id]
    );

    const { rows: [counts] } = await pg.query(
      `SELECT count(*)::int AS appointment_count
         FROM appointments WHERE patient_id = $1`,
      [req.params.id]
    );

    res.json({
      ...rows[0],
      open_appointment: open[0] ?? null,
      appointment_count: counts.appointment_count,
    });
  } catch (err) { next(err); }
});

// --- clinics --------------------------------------------------------

router.get('/clinics', async (req, res, next) => {
  try {
    const { page, limit, offset } = paging(req);
    const q = req.query.q ?? '';
    const accepting =
      req.query.accepting === undefined ? null : req.query.accepting === 'true';

    const { rows } = await pg.query(
      `SELECT id, name, latitude, longitude, is_accepting_patients
         FROM clinics
        WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
          AND ($2::boolean IS NULL OR is_accepting_patients = $2)
        ORDER BY name
        LIMIT $3 OFFSET $4`,
      [q, accepting, limit, offset]
    );

    const { rows: [{ count }] } = await pg.query(
      `SELECT count(*)::int AS count FROM clinics
        WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
          AND ($2::boolean IS NULL OR is_accepting_patients = $2)`,
      [q, accepting]
    );

    res.json({ data: rows, page, limit, total: count });
  } catch (err) { next(err); }
});

router.get('/clinics/:id', async (req, res, next) => {
  try {
    const { rows } = await pg.query(
      `SELECT c.id, c.name, c.latitude, c.longitude, c.is_accepting_patients,
              count(a.id)::int AS appointment_count,
              count(a.id) FILTER (WHERE a.status = 'DISCHARGED')::int AS discharged_count,
              COALESCE(SUM(a.copay_amount) FILTER (WHERE a.status = 'DISCHARGED'), 0) AS total_revenue
         FROM clinics c
         LEFT JOIN appointments a ON a.clinic_id = c.id
        WHERE c.id = $1
        GROUP BY c.id`,
      [req.params.id]
    );
    if (!rows.length) throw notFound('Clinic');
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// --- appointments ---------------------------------------------------

router.get('/appointments', async (req, res, next) => {
  try {
    const { page, limit, offset } = paging(req);
    const patientId = req.query.patient_id ?? null;
    const clinicId = req.query.clinic_id ?? null;
    const status = req.query.status ?? null;

    const where = `
       WHERE ($1::uuid IS NULL OR a.patient_id = $1)
         AND ($2::uuid IS NULL OR a.clinic_id  = $2)
         AND ($3::text IS NULL OR a.status     = $3)`;

    const { rows } = await pg.query(
      `SELECT a.id, a.patient_id, p.name AS patient_name,
              a.clinic_id,  c.name AS clinic_name,
              a.copay_amount, a.status, a.created_at, a.discharged_at
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN clinics  c ON c.id = a.clinic_id
         ${where}
        ORDER BY a.created_at DESC
        LIMIT $4 OFFSET $5`,
      [patientId, clinicId, status, limit, offset]
    );

    const { rows: [{ count }] } = await pg.query(
      `SELECT count(*)::int AS count FROM appointments a ${where}`,
      [patientId, clinicId, status]
    );

    res.json({ data: rows, page, limit, total: count });
  } catch (err) { next(err); }
});

export default router;
