// Workflow 1 (booking), status transitions, and the audit trail.

import { Router } from 'express';
import { pg } from '../db.js';
import { badRequest, notFound } from '../middleware/errors.js';

const router = Router();

// --- Workflow 1: book an appointment --------------------------------
//
// Calls the Assignment 1 stored procedure. None of its logic is
// reimplemented here: the procedure locks the patient row, checks the
// balance, deducts it (firing the audit trigger) and inserts the
// appointment, all in one transaction.

router.post('/appointments', async (req, res, next) => {
  const { patient_id, clinic_id, copay_amount } = req.body ?? {};
  if (!patient_id || !clinic_id || copay_amount === undefined) {
    return next(badRequest('patient_id, clinic_id and copay_amount are required.'));
  }

  const client = await pg.connect();
  try {
    const before = await client.query(
      'SELECT hsa_balance FROM patients WHERE id = $1',
      [patient_id]
    );
    if (!before.rows.length) throw notFound('Patient');

    await client.query('BEGIN');
    await client.query('CALL create_appointment_atomic($1, $2, $3)', [
      patient_id, clinic_id, copay_amount,
    ]);
    await client.query('COMMIT');

    // Read back what the procedure and the trigger produced.
    const { rows: [appointment] } = await client.query(
      `SELECT id, status, copay_amount, created_at
         FROM appointments
        WHERE patient_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [patient_id]
    );
    const { rows: [audit] } = await client.query(
      `SELECT id, action_type, amount_changed, balance_after, timestamp
         FROM wallet_audit_logs
        WHERE patient_id = $1
        ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [patient_id]
    );

    res.status(201).json({
      appointment,
      balance_before: before.rows[0].hsa_balance,
      balance_after: audit.balance_after,
      audit_entry: audit,
    });
  } catch (err) {
    // A raised exception leaves the connection in an aborted
    // transaction. Without this rollback the NEXT request on this
    // pooled connection fails for unrelated reasons.
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// --- status transitions (A2 addition C10) ---------------------------
//
// Lets the partial unique index be demonstrated: discharge an
// appointment, then book the same patient again.

router.patch('/appointments/:id/status', async (req, res, next) => {
  const { status } = req.body ?? {};
  if (!status) return next(badRequest('status is required.'));

  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    await client.query('CALL advance_appointment_status($1, $2)', [
      req.params.id, status,
    ]);
    await client.query('COMMIT');

    const { rows } = await client.query(
      `SELECT a.id, a.patient_id, p.name AS patient_name,
              a.clinic_id, c.name AS clinic_name,
              a.copay_amount, a.status, a.created_at, a.discharged_at
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN clinics  c ON c.id = a.clinic_id
        WHERE a.id = $1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// --- audit trail ----------------------------------------------------
//
// balance_after is written by the trigger on every movement, so the
// running balance already exists in the table. Nothing is computed here.

router.get('/patients/:id/audit', async (req, res, next) => {
  try {
    const rawPage = Number(req.query.page);
    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 25;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const { rows: patient } = await pg.query(
      'SELECT id, name, hsa_balance FROM patients WHERE id = $1',
      [req.params.id]
    );
    if (!patient.length) throw notFound('Patient');

    const where = `
       WHERE patient_id = $1
         AND ($2::date IS NULL OR timestamp >= $2::date)
         AND ($3::date IS NULL OR timestamp <  $3::date + INTERVAL '1 day')`;

    const { rows } = await pg.query(
      `SELECT id, action_type, amount_changed, balance_after, timestamp
         FROM wallet_audit_logs ${where}
        ORDER BY timestamp DESC, id DESC
        LIMIT $4 OFFSET $5`,
      [req.params.id, from, to, limit, (page - 1) * limit]
    );

    const { rows: [summary] } = await pg.query(
      `SELECT count(*)::int AS total,
              COALESCE(SUM(amount_changed) FILTER (WHERE action_type = 'CREDIT'), 0) AS total_credit,
              COALESCE(SUM(amount_changed) FILTER (WHERE action_type = 'DEBIT'),  0) AS total_debit
         FROM wallet_audit_logs ${where}`,
      [req.params.id, from, to]
    );

    res.json({
      patient: patient[0],
      summary: { total_credit: summary.total_credit, total_debit: summary.total_debit },
      data: rows,
      page, limit, total: summary.total,
    });
  } catch (err) { next(err); }
});

export default router;
