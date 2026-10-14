import { useState } from 'react';
import { useApi, send } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, Field, Input, Button, Banner,
  Money, StatusBadge, Stamp, Spinner, EmptyState,
} from '../../components';

/**
 * A searchable picker. 25,000 patients cannot go in a <select>, so this
 * queries the server as you type — the same server-side paging rule that
 * applies to Browse.
 */
function Picker({ label, resource, selected, onSelect, render }) {
  const [q, setQ] = useState('');
  const { data, loading } = useApi(
    `/${resource}?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`
  );

  if (selected) {
    return (
      <Field label={label}>
        <div className="row row--between" style={{
          border: '1px solid var(--line-strong)', borderRadius: 'var(--r)',
          padding: 'var(--s-2) var(--s-3)', background: 'var(--surface)',
        }}>
          <span>{render(selected)}</span>
          <Button variant="quiet" small onClick={() => { onSelect(null); setQ(''); }}>
            Change
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} hint={loading ? 'Searching…' : undefined}>
      <Input
        placeholder={`Search ${resource}…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div style={{
        marginTop: 'var(--s-2)', maxHeight: 180, overflowY: 'auto',
        border: '1px solid var(--line)', borderRadius: 'var(--r)',
      }}>
        {(data?.data ?? []).map((row) => (
          <button
            key={row.id}
            onClick={() => onSelect(row)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
              fontSize: 'var(--t-sm)', padding: 'var(--s-2) var(--s-3)',
              background: 'transparent', border: 0, borderBottom: '1px solid var(--line)',
              cursor: 'pointer', color: 'var(--ink)',
            }}
          >
            {render(row)}
          </button>
        ))}
        {!loading && (data?.data ?? []).length === 0 && (
          <div style={{ padding: 'var(--s-3)', fontSize: 'var(--t-sm)', color: 'var(--ink-faint)' }}>
            No matches.
          </div>
        )}
      </div>
    </Field>
  );
}

export default function Transaction() {
  const [patient, setPatient] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [copay, setCopay] = useState('250.00');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Full patient record, so we know whether a consultation is already open.
  const { data: detail, refetch: refetchPatient } = useApi(
    patient ? `/patients/${patient.id}` : null,
    { skip: !patient }
  );

  const blocked = Boolean(detail?.open_appointment);
  const closed = clinic && clinic.is_accepting_patients === false;

  async function book(e) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      // Calls create_appointment_atomic(). No part of its logic — the
      // balance check, the deduction, the audit row — is repeated here.
      const body = await send('/appointments', 'POST', {
        patient_id: patient.id,
        clinic_id: clinic.id,
        copay_amount: copay,
      });
      setResult(body);
      refetchPatient();
    } catch (err) {
      setError(err);
      refetchPatient();
    } finally {
      setBusy(false);
    }
  }

  const ready = patient && clinic && Number(copay) > 0;

  return (
    <>
      <PageHeader
        title="Book an appointment"
        subtitle="Workflow 1 — calls create_appointment_atomic(). The balance deduction, the appointment and the audit row are one transaction."
      />

      <div className="grid grid--side">
        <Card title="New appointment">
          <form onSubmit={book}>
            <Picker
              label="Patient"
              resource="patients"
              selected={patient}
              onSelect={(p) => { setPatient(p); setResult(null); setError(null); }}
              render={(p) => (
                <>{p.name} — <Money amount={p.hsa_balance} /></>
              )}
            />

            <Picker
              label="Clinic"
              resource="clinics"
              selected={clinic}
              onSelect={(c) => { setClinic(c); setResult(null); setError(null); }}
              render={(c) => (
                <>
                  {c.name}
                  {c.is_accepting_patients === false && ' (closed)'}
                </>
              )}
            />

            <Field
              label="Copay"
              hint="Deducted from the patient's HSA balance."
              error={Number(copay) <= 0 ? 'Copay must be greater than zero.' : undefined}
            >
              <Input
                mono
                value={copay}
                onChange={(e) => setCopay(e.target.value)}
                inputMode="decimal"
              />
            </Field>

            {blocked && (
              <Banner variant="info">
                {detail.name} is already at {detail.open_appointment.clinic_name}. Discharge that
                appointment from Browse before booking another — or submit anyway to see the
                partial unique index reject it.
              </Banner>
            )}
            {closed && (
              <Banner variant="info">
                This clinic is not accepting patients. The stored procedure will reject the booking.
              </Banner>
            )}

            <Button type="submit" disabled={!ready || busy}>
              {busy ? 'Booking…' : 'Book appointment'}
            </Button>
          </form>
        </Card>

        <Card title="Result">
          {!result && !error && !busy && (
            <EmptyState
              title="No booking yet"
              text="Submit the form and the balance change plus the audit entry appear here."
            />
          )}

          {busy && <Spinner label="Calling the stored procedure" />}

          {error && <Banner variant="error">{error.message}</Banner>}

          {result && (
            <>
              <Banner variant="success">
                Appointment booked and the audit trigger fired.
              </Banner>

              <div className="grid grid--2 mb-4">
                <div>
                  <div className="stat__value"><Money amount={result.balance_before} /></div>
                  <div className="stat__label">Balance before</div>
                </div>
                <div>
                  <div className="stat__value"><Money amount={result.balance_after} /></div>
                  <div className="stat__label">Balance after</div>
                </div>
              </div>

              <div className="field__label">
                Audit entry — written by the trigger, not by the application
              </div>
              <Table columns={['Type', { label: 'Amount', align: 'right' },
                               { label: 'Balance after', align: 'right' }, 'When']}>
                <tr>
                  <td><StatusBadge status={result.audit_entry.action_type} /></td>
                  <td className="num">
                    <Money
                      amount={result.audit_entry.amount_changed}
                      kind={result.audit_entry.action_type.toLowerCase()}
                    />
                  </td>
                  <td className="num num--balance">
                    <Money amount={result.audit_entry.balance_after} kind="balance" />
                  </td>
                  <td><Stamp value={result.audit_entry.timestamp} /></td>
                </tr>
              </Table>

              <div className="field__hint" style={{ marginTop: 'var(--s-3)' }}>
                Appointment created as <StatusBadge status={result.appointment.status} /> at{' '}
                <Stamp value={result.appointment.created_at} />
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
