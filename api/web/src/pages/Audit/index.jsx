import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, Pagination, AsyncBlock, EmptyState,
  Money, StatusBadge, Stamp, Input, Field, Button,
} from '../../components';

export default function Audit() {
  const [q, setQ] = useState('');
  const [patient, setPatient] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data: search } = useApi(
    `/patients?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`
  );

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, loading, error } = useApi(
    patient ? `/patients/${patient.id}/audit?${params}` : null,
    { skip: !patient }
  );

  const rows = data?.data ?? [];

  if (!patient) {
    return (
      <>
        <PageHeader
          title="Audit trail"
          subtitle="Every movement of a patient's HSA balance, written by the audit trigger."
        />
        <Card title="Choose a patient">
          <Field label="Patient">
            <Input
              placeholder="Search patients…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {(search?.data ?? []).map((p) => (
                  <tr key={p.id} className="is-clickable" onClick={() => setPatient(p)}>
                    <td>{p.name}</td>
                    <td className="num"><Money amount={p.hsa_balance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle={`${patient.name} — read only. The ledger is append-only by design.`}
        actions={
          <Button variant="secondary" onClick={() => { setPatient(null); setPage(1); }}>
            Change patient
          </Button>
        }
      />

      <Card>
        <div className="row mb-4">
          <div>
            <label className="field__label">From</label>
            <Input type="date" value={from}
                   onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label className="field__label">To</label>
            <Input type="date" value={to}
                   onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          {(from || to) && (
            <Button variant="quiet" onClick={() => { setFrom(''); setTo(''); setPage(1); }}>
              Clear dates
            </Button>
          )}
        </div>

        {data && (
          <div className="grid grid--3 mb-4">
            <div>
              <div className="stat__value">
                <Money amount={data.patient.hsa_balance} kind="balance" />
              </div>
              <div className="stat__label">Current balance</div>
            </div>
            <div>
              <div className="stat__value">
                <Money amount={data.summary.total_credit} kind="credit" />
              </div>
              <div className="stat__label">Credits in range</div>
            </div>
            <div>
              <div className="stat__value">
                <Money amount={data.summary.total_debit} kind="debit" />
              </div>
              <div className="stat__label">Debits in range</div>
            </div>
          </div>
        )}

        <AsyncBlock
          loading={loading}
          error={error}
          isEmpty={rows.length === 0}
          empty={<EmptyState title="No movements" text="Nothing recorded between those dates." />}
        >
          <Table columns={['Type', { label: 'Amount', align: 'right' },
                           { label: 'Balance after', align: 'right' }, 'When']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><StatusBadge status={r.action_type} /></td>
                <td className="num">
                  <Money amount={r.amount_changed} kind={r.action_type.toLowerCase()} />
                </td>
                {/* balance_after is written by the trigger on every row —
                    the running balance already exists, nothing is computed here */}
                <td className="num num--balance">
                  <Money amount={r.balance_after} kind="balance" />
                </td>
                <td><Stamp value={r.timestamp} /></td>
              </tr>
            ))}
          </Table>

          <Pagination page={page} limit={data?.limit ?? 25} total={data?.total ?? 0} onChange={setPage} />
        </AsyncBlock>
      </Card>
    </>
  );
}
