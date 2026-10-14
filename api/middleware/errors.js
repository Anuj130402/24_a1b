// Translates PostgreSQL SQLSTATEs into messages the UI can display.
//
// Assignment 1 surfaces failures two ways:
//   - RAISE EXCEPTION inside create_appointment_atomic  -> P0001
//   - the partial unique index idx_active_consult       -> 23505
//
// The second is a raw constraint violation with no friendly text, so it
// is translated here rather than in every screen.

export function errorHandler(err, _req, res, _next) {
  console.error(err.message);

  if (err.code === '23505' && err.constraint === 'idx_active_consult') {
    return res.status(409).json({
      error:
        'This patient is already in an active consultation. ' +
        'Discharge the current appointment before booking another.',
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({ error: 'That record already exists.' });
  }

  if (err.code === '23514') {
    return res.status(400).json({ error: 'That change would break a database rule.' });
  }

  if (err.code === '23503') {
    return res.status(400).json({ error: 'That record refers to something that does not exist.' });
  }

  // RAISE EXCEPTION from a stored procedure. The message is already
  // written for a human, e.g. "Insufficient HSA balance. Available: ..."
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === '22P02') {
    return res.status(400).json({ error: 'That is not a valid ID.' });
  }

  res.status(err.status ?? 500).json({
    error: err.status ? err.message : 'Something went wrong on the server.',
  });
}

export function notFound(what) {
  const e = new Error(`${what} not found.`);
  e.status = 404;
  return e;
}

export function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
