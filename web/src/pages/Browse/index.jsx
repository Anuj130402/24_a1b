import { useState } from 'react';
import { useApi, send } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, Pagination, AsyncBlock, EmptyState,
  Money, StatusBadge, Uuid, Stamp, Input, Select, Button, Banner,
} from '../../components';

const TABS = [
  { key: 'patients', label: 'Patients' },
  { key: 'clinics', label: 'Clinics' },
  { key: 'appointments', label: 'Appointments' },
];

const NEXT_STATUS = {
  WAITING: 'IN_CONSULTATION',
  IN_CONSULTATION: 'DISCHARGED',
};

export default function Browse() {
  const [tab, setTab] = useState('patients');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [accepting, setAccepting] = useState('');
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (q) params.set('q', q);
  if (tab === 'clinics' && accepting) params.set('accepting', accepting);

  const path =
    tab === 'appointments'
      ? `/appointments?${new URLSearchParams({
          page: String(page), limit: '25', ...(status ? { status } : {}),
        })}`
      : `/${tab}?${params}`;

  const { data, loading, error, refetch } = useApi(path);
  const rows = data?.data ?? [];

  function switchTab(key) {
    setTab(key); setPage(1); setQ(''); setStatus(''); setAccepting('');
    setDetail(null); setNotice(null);
  }

  async function openDetail(row) {
    setNotice(null);
    if (tab === 'appointments') { setDetail({ kind: 'appointment', ...row }); return; }
    try {
      const body = await send(`/${tab}/${row.id}`, 'GET');
      setDetail({ kind: tab, ...body });
    } catch (err) {
      setNotice({ variant: 'error', text: err.message });
    }
  }

  // Moving an appointment through its statuses is how the partial
  // unique index gets demonstrated: discharge, then book again.
  async function advance(appointment) {
    const next = NEXT_STATUS[appointment.status];
    if (!next) return;
    setBusy(appointment.id);
    setNotice(null);
    try {
      const updated = await send(`/appointments/${appointment.id}/status`, 'PATCH', { status: next });
      setNotice({
        variant: 'success',
        text: `Appointment moved to ${updated.status.replace('_', ' ').toLowerCase()}.`,
      });
      setDetail(null);
      refetch();
    } catch (err) {
      setNotice({ variant: 'error', text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Browse"
        subtitle="Patients, clinics and appointments. 25 records per page, fetched from the server."
      />

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'tab is-active' : 'tab'}
            onClick={() => switchTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && <Banner variant={notice.variant}>{notice.text}</Banner>}

      <Card>
        <div className="row mb-4">
          {tab !== 'appointments' && (
            <div className="grow" style={{ minWidth: 220 }}>
              <Input
                placeholder={`Search ${tab} by name…`}
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
              />
            </div>
          )}
          {tab === 'clinics' && (
            <div style={{ width: 220 }}>
              <Select
                placeholder="All clinics"
                value={accepting}
                onChange={(e) => { setAccepting(e.target.value); setPage(1); }}
                options={[
                  { value: 'true', label: 'Accepting patients' },
                  { value: 'false', label: 'Not accepting patients' },
                ]}
              />
            </div>
          )}
          {tab === 'appointments' && (
            <div style={{ width: 220 }}>
              <Select
                placeholder="All statuses"
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                options={[
                  { value: 'WAITING', label: 'Waiting' },
                  { value: 'IN_CONSULTATION', label: 'In consultation' },
                  { value: 'DISCHARGED', label: 'Discharged' },
                ]}
              />
            </div>
          )}
        </div>

        <AsyncBlock
          loading={loading}
          error={error}
          isEmpty={rows.length === 0}
          empty={<EmptyState title="No records match" text="Try clearing the search or filter." />}
        >
          {tab === 'patients' && (
            <Table columns={['ID', 'Name', { label: 'HSA balance', align: 'right' }, 'Location']}>
              {rows.map((r) => (
                <tr key={r.id} className="is-clickable" onClick={() => openDetail(r)}>
                  <td><Uuid value={r.id} /></td>
                  <td>{r.name}</td>
                  <td className="num"><Money amount={r.hsa_balance} /></td>
                  <td className="stamp">
                    {r.latitude ? `${Number(r.latitude).toFixed(3)}, ${Number(r.longitude).toFixed(3)}` : '—'}
                  </td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'clinics' && (
            <Table columns={['ID', 'Name', 'Accepting', 'Location']}>
              {rows.map((r) => (
                <tr key={r.id} className="is-clickable" onClick={() => openDetail(r)}>
                  <td><Uuid value={r.id} /></td>
                  <td>{r.name}</td>
                  <td>
                    <span className={r.is_accepting_patients ? 'badge badge--credit' : 'badge badge--debit'}>
                      {r.is_accepting_patients ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="stamp">
                    {Number(r.latitude).toFixed(3)}, {Number(r.longitude).toFixed(3)}
                  </td>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'appointments' && (
            <Table columns={['Patient', 'Clinic', 'Status', { label: 'Copay', align: 'right' }, 'Created', '']}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.patient_name}</td>
                  <td>{r.clinic_name}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num"><Money amount={r.copay_amount} /></td>
                  <td><Stamp value={r.created_at} /></td>
                  <td>
                    {NEXT_STATUS[r.status] && (
                      <Button
                        variant="secondary"
                        small
                        disabled={busy === r.id}
                        onClick={() => advance(r)}
                      >
                        {busy === r.id
                          ? 'Working…'
                          : r.status === 'WAITING' ? 'Start consult' : 'Discharge'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}

          <Pagination page={page} limit={data?.limit ?? 25} total={data?.total ?? 0} onChange={setPage} />
        </AsyncBlock>
      </Card>

      {detail && (
        <Card title={detail.name ?? 'Appointment'}>
          <div className="row row--between mb-4">
            <Uuid value={detail.id} short={false} />
            <Button variant="quiet" onClick={() => setDetail(null)}>Close</Button>
          </div>

          {detail.kind === 'patients' && (
            <>
              <div className="grid grid--3 mb-4">
                <div>
                  <div className="stat__value"><Money amount={detail.hsa_balance} /></div>
                  <div className="stat__label">HSA balance</div>
                </div>
                <div>
                  <div className="stat__value">{detail.appointment_count}</div>
                  <div className="stat__label">Appointments</div>
                </div>
                <div>
                  <div className="stat__value">{detail.open_appointment ? '1' : '0'}</div>
                  <div className="stat__label">Open consultation</div>
                </div>
              </div>
              {detail.open_appointment ? (
                <Banner variant="info">
                  Currently at {detail.open_appointment.clinic_name} (
                  {detail.open_appointment.status.replace('_', ' ').toLowerCase()}). The partial
                  unique index blocks a second booking until this one is discharged.
                </Banner>
              ) : (
                <Banner variant="success">No open consultation — this patient can be booked.</Banner>
              )}
            </>
          )}

          {detail.kind === 'clinics' && (
            <div className="grid grid--3">
              <div>
                <div className="stat__value">{detail.appointment_count}</div>
                <div className="stat__label">Appointments</div>
              </div>
              <div>
                <div className="stat__value">{detail.discharged_count}</div>
                <div className="stat__label">Discharged</div>
              </div>
              <div>
                <div className="stat__value"><Money amount={detail.total_revenue} /></div>
                <div className="stat__label">Copay revenue</div>
              </div>
            </div>
          )}

          {detail.kind === 'appointment' && (
            <div className="grid grid--3">
              <div>
                <div className="stat__value"><Money amount={detail.copay_amount} /></div>
                <div className="stat__label">Copay</div>
              </div>
              <div>
                <div className="stat__label">Status</div>
                <StatusBadge status={detail.status} />
              </div>
              <div>
                <div className="stat__label">Discharged</div>
                <Stamp value={detail.discharged_at} />
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
