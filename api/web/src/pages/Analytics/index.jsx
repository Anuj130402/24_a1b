import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useApi, send } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, AsyncBlock, EmptyState, Banner,
  Money, Input, Button, Field, Select,
} from '../../components';

export default function Analytics() {
  const [q, setQ] = useState('');
  const [clinic, setClinic] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rankDate, setRankDate] = useState('');   // '' = server default
  const [month, setMonth] = useState('');         // '' = latest in the view
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);

  const { data: search } = useApi(
    `/clinics?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`
  );

  const params = new URLSearchParams();
  if (clinic) params.set('clinic_id', clinic.id);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  // clinic_moving_average() is sql/06 parameterised by date. The clinic
  // filter is applied on the function's RESULT, server-side, because
  // DENSE_RANK() partitions by date across all clinics.
  const series = useApi(clinic ? `/analytics/moving-average?${params}` : null, { skip: !clinic });
  const ranking = useApi(
    `/analytics/ranking?limit=10${rankDate ? `&date=${rankDate}` : ''}`
  );
  const summary = useApi(
    `/analytics/summary${month ? `?month=${month}` : ''}`
  );

  const points = (series.data?.data ?? []).map((r) => ({
    date: r.revenue_date?.slice(0, 10),
    avg: Number(r.moving_avg_7day),
    daily: Number(r.daily_revenue),
  }));

  async function refresh() {
    setRefreshing(true); setNotice(null);
    try {
      await send('/analytics/refresh', 'POST');
      await summary.refetch();
      setNotice({ variant: 'success', text: 'Materialized view refreshed.' });
    } catch (err) {
      setNotice({ variant: 'error', text: err.message });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Workflow 2 — 7-day moving average of copay revenue, with DENSE_RANK() ranking and the materialized view summary."
      />

      {notice && <Banner variant={notice.variant}>{notice.text}</Banner>}

      <Card title="Revenue trend">
        <div className="row mb-4">
          <div className="grow">
            <Field label="Clinic">
              {clinic ? (
                <div className="row row--between" style={{
                  border: '1px solid var(--line-strong)', borderRadius: 'var(--r)',
                  padding: 'var(--s-2) var(--s-3)', background: 'var(--surface)',
                }}>
                  <span>{clinic.name}</span>
                  <Button variant="quiet" small onClick={() => { setClinic(null); setQ(''); }}>
                    Change
                  </Button>
                </div>
              ) : (
                <Input placeholder="Search clinics…" value={q}
                       onChange={(e) => setQ(e.target.value)} />
              )}
            </Field>
          </div>
          <div>
            <label className="field__label">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field__label">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {!clinic && (
          <>
            <div className="table-wrap mb-4">
              <table className="table">
                <tbody>
                  {(search?.data ?? []).map((c) => (
                    <tr key={c.id} className="is-clickable" onClick={() => setClinic(c)}>
                      <td>{c.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <EmptyState title="Choose a clinic" text="Pick one above to plot its 7-day moving average." />
          </>
        )}

        {clinic && (
          <AsyncBlock
            loading={series.loading}
            error={series.error}
            isEmpty={points.length === 0}
            empty={<EmptyState title="No revenue in this range" text="Widen the dates or pick another clinic." />}
          >
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
                         stroke="var(--line-strong)" minTickGap={28} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--ink-muted)' }}
                         stroke="var(--line-strong)" width={64}
                         tickFormatter={(v) => `₹${(v / 1000).toFixed(1)}k`} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)', border: '1px solid var(--line)',
                      borderRadius: 'var(--r)', fontSize: 13,
                    }}
                    formatter={(v, n) => [
                      `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
                      n === 'avg' ? '7-day average' : 'That day',
                    ]}
                  />
                  <Line type="monotone" dataKey="daily" stroke="var(--line-strong)"
                        strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="avg" stroke="var(--series-1)"
                        strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="field__hint">
              Thin line is that day's revenue; thick line is the 7-day moving average.
              Missing days are padded with ₹0.00 so the window spans 7 calendar days.
            </div>
          </AsyncBlock>
        )}
      </Card>

      <div className="grid grid--side">
        <Card title="Ranking">
          <div className="row mb-4">
            <div>
              <label className="field__label">Date</label>
              <Input
                type="date"
                value={rankDate || ranking.data?.date || ''}
                min={ranking.data?.bounds?.min_date}
                max={ranking.data?.bounds?.max_date}
                onChange={(e) => setRankDate(e.target.value)}
              />
            </div>
            {rankDate && (
              <Button variant="quiet" onClick={() => setRankDate('')}>
                Latest active day
              </Button>
            )}
          </div>

          <AsyncBlock
            loading={ranking.loading}
            error={ranking.error}
            isEmpty={(ranking.data?.data ?? []).length === 0}
            empty={<EmptyState title="No ranking available" />}
          >
            <Table columns={['Rank', 'Clinic', { label: '7-day avg', align: 'right' }]}>
              {(ranking.data?.data ?? []).map((r) => {
                // The leaderboard stays collective — ranking one clinic
                // against itself would make every rank 1. Highlighting
                // shows where the selected clinic sits instead.
                const isSelected = clinic && r.clinic_id === clinic.id;
                return (
                  <tr
                    key={r.clinic_id}
                    style={isSelected ? { background: 'var(--pine-tint)' } : undefined}
                  >
                    <td className="num">{r.clinic_rank}</td>
                    <td style={isSelected ? { fontWeight: 600 } : undefined}>
                      {r.clinic_name}
                    </td>
                    <td className="num"><Money amount={r.moving_avg_7day} /></td>
                  </tr>
                );
              })}
            </Table>
            <div className="field__hint">
              All {ranking.data?.data?.length ? '250' : ''} clinics compete on this date.
              DENSE_RANK: tied clinics share a rank and the next still gets the next number.
            </div>
          </AsyncBlock>
        </Card>

        <Card title="Summary">
          <div className="row mb-4">
            <div style={{ width: 180 }}>
              <label className="field__label">Month</label>
              <Select
                value={month || summary.data?.month || ''}
                onChange={(e) => setMonth(e.target.value)}
                options={(summary.data?.months ?? []).map((m) => ({
                  value: m, label: m,
                }))}
              />
            </div>
            <span className="field__hint" style={{ margin: 0 }}>
              From the materialized view
            </span>
          </div>

          <AsyncBlock
            loading={summary.loading}
            error={summary.error}
            isEmpty={!summary.data?.totals}
            empty={<EmptyState title="Materialized view is empty" text="Refresh it to populate." />}
          >
            <div className="grid grid--2 mb-4">
              <div>
                <div className="stat__value">
                  {Number(summary.data?.totals?.total_discharges ?? 0).toLocaleString('en-IN')}
                </div>
                <div className="stat__label">Discharges</div>
              </div>
              <div>
                <div className="stat__value">{summary.data?.totals?.clinics_reporting ?? 0}</div>
                <div className="stat__label">Clinics reporting</div>
              </div>
            </div>

            <div className="row">
              <Button variant="secondary" onClick={refresh} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh view'}
              </Button>
              <span className="field__hint" style={{ margin: 0 }}>
                {summary.data?.last_refreshed
                  ? `Refreshed ${new Date(summary.data.last_refreshed).toLocaleString('en-IN')}`
                  : 'Never refreshed'}
              </span>
            </div>
          </AsyncBlock>
        </Card>
      </div>
    </>
  );
}