import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useApi } from '../../hooks/useApi';
import {
  PageHeader, Card, Table, AsyncBlock, EmptyState,
  Input, Field, Button, Stamp,
} from '../../components';

export default function Reviews() {
  const [q, setQ] = useState('');
  const [clinic, setClinic] = useState(null);

  const { data: search } = useApi(
    `/clinics?limit=8${q ? `&q=${encodeURIComponent(q)}` : ''}`
  );

  // One $facet pipeline computes all three statistics in a single pass
  // over the collection — not three separate requests.
  const stats = useApi(clinic ? `/clinics/${clinic.id}/reviews/stats` : null, { skip: !clinic });
  const recent = useApi(clinic ? `/clinics/${clinic.id}/reviews?limit=5` : null, { skip: !clinic });
  const catalog = useApi(clinic ? `/clinics/${clinic.id}/catalog` : null, { skip: !clinic });

  const dist = stats.data?.rating_distribution ?? [];
  const tags = stats.data?.frequent_tags ?? [];
  const total = stats.data?.total_reviews ?? 0;

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="Workflow 4 — a $facet pipeline computes the rating distribution, top tags and average in one pass."
      />

      <Card>
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
            <EmptyState title="Choose a clinic" text="Pick one above to see its review analytics." />
          </>
        )}
      </Card>

      {clinic && (
        <>
          <Card title="Rating analytics">
            <AsyncBlock
              loading={stats.loading}
              error={stats.error}
              isEmpty={total === 0}
              empty={
                <EmptyState
                  title="No reviews for this clinic yet"
                  text="Reviews appear once patients rate a completed visit."
                />
              }
            >
              <div className="grid grid--side">
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dist} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="rating" stroke="var(--line-strong)"
                             tick={{ fontSize: 12, fill: 'var(--ink-muted)' }}
                             tickFormatter={(v) => `${v}★`} />
                      <YAxis stroke="var(--line-strong)" width={48}
                             tick={{ fontSize: 11, fill: 'var(--ink-muted)' }} />
                      <Tooltip
                        cursor={{ fill: 'var(--surface-hover)' }}
                        contentStyle={{
                          background: 'var(--surface)', border: '1px solid var(--line)',
                          borderRadius: 'var(--r)', fontSize: 13,
                        }}
                        formatter={(v) => [v, 'reviews']}
                        labelFormatter={(v) => `${v} star`}
                      />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {dist.map((d) => (
                          <Cell
                            key={d.rating}
                            fill={d.rating >= 4 ? 'var(--series-1)'
                                 : d.rating === 3 ? 'var(--series-2)' : 'var(--series-4)'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div>
                  <div className="grid grid--2 mb-4">
                    <div>
                      <div className="stat__value">
                        {stats.data?.average_rating
                          ? Number(stats.data.average_rating).toFixed(2) : '—'}
                      </div>
                      <div className="stat__label">Average rating</div>
                    </div>
                    <div>
                      <div className="stat__value">
                        {Number(total).toLocaleString('en-IN')}
                      </div>
                      <div className="stat__label">Reviews</div>
                    </div>
                  </div>

                  <div className="field__label">Most frequent tags</div>
                  <Table columns={['Tag', { label: 'Mentions', align: 'right' }]}>
                    {tags.map((t) => (
                      <tr key={t.tag}>
                        <td>{t.tag}</td>
                        <td className="num">{t.frequency}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </div>
            </AsyncBlock>
          </Card>

          <Card title="Recent reviews">
            <AsyncBlock
              loading={recent.loading}
              error={recent.error}
              isEmpty={(recent.data?.data ?? []).length === 0}
              empty={<EmptyState title="No reviews yet" />}
            >
              <Table columns={[{ label: 'Rating', align: 'right' }, 'Review', 'Tags', 'When']}>
                {(recent.data?.data ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="num">{'★'.repeat(r.rating)}</td>
                    <td>{r.review_text}</td>
                    <td className="stamp">{(r.bedside_manner_tags ?? []).join(', ')}</td>
                    <td><Stamp value={r.created_at} dateOnly /></td>
                  </tr>
                ))}
              </Table>
            </AsyncBlock>
          </Card>

          <Card title="Specialists and medications">
            <AsyncBlock
              loading={catalog.loading}
              error={catalog.error}
              isEmpty={(catalog.data?.data ?? []).length === 0}
              empty={<EmptyState title="No catalog for this clinic" />}
            >
              {/* availability and medications_handled are variable-length —
                  that is why they live in MongoDB rather than SQL, so they
                  are rendered as nested lists rather than flattened. */}
              {(catalog.data?.data ?? []).map((c, i) => (
                <div className="catalog" key={i}>
                  <div className="catalog__name">{c.specialist_name}</div>
                  <div className="catalog__specialty">{c.specialty}</div>

                  <div className="catalog__section">Availability</div>
                  <ul>
                    {(c.availability ?? []).map((a, j) => (
                      <li key={j}>{a.day} · {(a.slots ?? []).join(', ')}</li>
                    ))}
                  </ul>

                  <div className="catalog__section">Medications handled</div>
                  <ul>
                    {(c.medications_handled ?? []).map((m, j) => (
                      <li key={j}>
                        {m.name} — {(m.dosage_forms ?? []).join(', ')}
                        {m.requires_rx ? ' · prescription required' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </AsyncBlock>
          </Card>
        </>
      )}
    </>
  );
}
