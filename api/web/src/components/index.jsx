// Shared components. Every screen composes from these so six screens
// built in one week still look like one application.

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div className="row row--between">
        <h1 className="page-header__title">{title}</h1>
        {actions}
      </div>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </header>
  );
}

export function Card({ title, children, ...rest }) {
  return (
    <section className="card" {...rest}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({ variant = 'primary', small, children, ...rest }) {
  const base = {
    primary: 'btn',
    secondary: 'btn btn--secondary',
    danger: 'btn btn--danger',
    quiet: 'btn btn--quiet',
  }[variant];
  return (
    <button className={small ? `${base} btn--sm` : base} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <div className="field">
      {label && <label className="field__label">{label}</label>}
      {children}
      {hint && !error && <div className="field__hint">{hint}</div>}
      {error && <div className="field__error">{error}</div>}
    </div>
  );
}

export function Input({ mono, invalid, ...rest }) {
  return (
    <input
      className={mono ? 'input input--mono' : 'input'}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Select({ options = [], placeholder, ...rest }) {
  return (
    <select className="select" {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Table({ columns, children }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={typeof c === 'string' ? c : c.label}
                scope="col"
                style={typeof c === 'object' && c.align === 'right'
                  ? { textAlign: 'right' } : undefined}
              >
                {typeof c === 'string' ? c : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * The house style for every amount in the app.
 * Amounts arrive from PostgreSQL as strings (DECIMAL), deliberately —
 * they are not parsed into floats anywhere except here, for display.
 */
export function Money({ amount, kind, currency = '₹' }) {
  if (amount === null || amount === undefined) return <span className="num">—</span>;
  const n = Number(amount);
  const cls = kind ? `num num--${kind}` : 'num';
  const sign = kind === 'debit' ? '−' : kind === 'credit' ? '+' : '';
  return (
    <span className={cls}>
      {sign}{currency}
      {n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export function Uuid({ value, short = true }) {
  if (!value) return null;
  return <span className="uuid" title={value}>{short ? value.slice(0, 8) : value}</span>;
}

export function Stamp({ value, dateOnly }) {
  if (!value) return <span className="stamp">—</span>;
  const d = new Date(value);
  return (
    <time className="stamp" dateTime={value}>
      {dateOnly ? d.toLocaleDateString('en-IN') : d.toLocaleString('en-IN')}
    </time>
  );
}

const BADGE = {
  WAITING:         ['badge badge--waiting',    'Waiting'],
  IN_CONSULTATION: ['badge badge--consulting', 'In consultation'],
  DISCHARGED:      ['badge badge--discharged', 'Discharged'],
  CREDIT:          ['badge badge--credit',     'Credit'],
  DEBIT:           ['badge badge--debit',      'Debit'],
};

export function StatusBadge({ status }) {
  const [cls, label] = BADGE[status] ?? ['badge badge--discharged', status];
  return <span className={cls}>{label}</span>;
}

export function Stat({ value, label }) {
  return (
    <div>
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" />
      <div style={{ marginTop: 'var(--s-3)' }}>{label}</div>
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', text, action }) {
  return (
    <div className="state">
      <div className="state__title">{title}</div>
      {text && <div>{text}</div>}
      {action && <div style={{ marginTop: 'var(--s-4)' }}>{action}</div>}
    </div>
  );
}

export function Banner({ variant = 'error', children }) {
  return <div className={`banner banner--${variant}`} role="alert">{children}</div>;
}

export function ErrorBanner({ message }) {
  return <Banner variant="error">{message}</Banner>;
}

export function Pagination({ page, limit, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </Button>
      <span>{from}–{to} of {Number(total).toLocaleString('en-IN')}</span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

/**
 * Loading / empty / error in one place, so no screen can forget a state.
 * "No blank pages" is an explicit requirement.
 */
export function AsyncBlock({ loading, error, isEmpty, empty, children }) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error.message} />;
  if (isEmpty) return empty ?? <EmptyState />;
  return children;
}
