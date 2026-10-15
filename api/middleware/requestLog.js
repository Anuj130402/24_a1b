/**
 * Request logger.
 *
 * Prints one line per request naming the Part A database object it exercises,
 * so the terminal reads as a live trace of the UI: click "Book appointment"
 * and the line that appears says `create_appointment_atomic()`.
 *
 * Set DEMO_LOG=off to silence it.
 */

const OFF = process.env.DEMO_LOG === 'off';

// ANSI colours. Kept legible on a dark terminal at recording resolution.
const C = {
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  green: '\x1b[32m',
  amber: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

/**
 * Which Part A (or Assignment 2) database object each route drives.
 * Order matters — the first matching pattern wins.
 */
const EXERCISES = [
  [/^POST \/appointments$/,                 'create_appointment_atomic()  →  audit trigger'],
  [/^PATCH \/appointments\/[^/]+\/status$/, 'advance_appointment_status()'],
  [/^GET \/patients\/[^/]+\/audit/,         'wallet_audit_logs  (written by the trigger)'],
  [/^GET \/analytics\/moving-average/,      'clinic_moving_average()  —  window functions'],
  [/^GET \/analytics\/ranking/,             'clinic_moving_average()  —  DENSE_RANK()'],
  [/^GET \/analytics\/summary/,             'clinic_monthly_discharges  (materialized view)'],
  [/^POST \/analytics\/refresh$/,           'REFRESH MATERIALIZED VIEW CONCURRENTLY'],
  [/^GET \/nurses\/near/,                   '$geoNear  on NursePings  (2dsphere)'],
  [/^GET \/clinics\/[^/]+\/reviews\/stats/, '$facet  on PatientReviews'],
  [/^GET \/clinics\/[^/]+\/reviews/,        'PatientReviews'],
  [/^GET \/clinics\/[^/]+\/catalog/,        'MedicalCatalogs  (flexible documents)'],
  [/^GET \/patients\/[^/]+$/,               'patients  +  open-appointment check'],
  [/^GET \/patients/,                       'patients  (LIMIT / OFFSET)'],
  [/^GET \/clinics/,                        'clinics'],
  [/^GET \/appointments/,                   'appointments  JOIN patients, clinics'],
  [/^GET \/health$/,                        ''],
];

function describe(method, path) {
  const key = `${method} ${path}`;
  for (const [pattern, label] of EXERCISES) {
    if (pattern.test(key)) return label;
  }
  return '';
}

function colourFor(status) {
  if (status >= 500) return C.red;
  if (status >= 400) return C.amber;
  return C.green;
}

export function requestLog(req, res, next) {
  if (OFF) return next();

  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const target = describe(req.method, req.path);
    const colour = colourFor(res.statusCode);

    const method = req.method.padEnd(6);
    const url = (req.originalUrl.length > 52
      ? `${req.originalUrl.slice(0, 49)}...`
      : req.originalUrl).padEnd(52);

    let line =
      `${C.cyan}${method}${C.reset}${url}` +
      `${colour}${C.bold}${res.statusCode}${C.reset}` +
      `${C.dim} ${ms.toFixed(0).padStart(5)}ms${C.reset}`;

    if (target) line += `${C.dim}   ${target}${C.reset}`;

    console.log(line);
  });

  next();
}
