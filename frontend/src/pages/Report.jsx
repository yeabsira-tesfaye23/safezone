import { useState } from 'react';
import { Banner, ErrorNote, Field, Loading, Pill, useAction, useAsync, usePageTitle } from '../components/ui.jsx';
import { get, post } from '../lib/api.js';
import { categoryLabel, fmtTime } from '../lib/format.js';

const STATUS = { submitted: ['info', 'Received'], in_review: ['warn', 'Being reviewed'], closed: ['ok', 'Review finished'] };

export default function Report() {
  usePageTitle('Report a problem');
  const mine = useAsync(() => get('/reports'), []);
  const { busy, error, run } = useAction();
  const [form, setForm] = useState({ category: 'harassment', description: '', occurredAt: '', share: false });
  const [done, setDone] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    const body = { category: form.category, description: form.description, shareWithGuardians: form.share };
    if (form.occurredAt) body.occurredAt = new Date(form.occurredAt).toISOString();
    run(async () => { await post('/reports', body); setDone(true); setForm({ category: 'harassment', description: '', occurredAt: '', share: false }); mine.reload(); });
  };

  return (
    <div className="stack">
      <h1>Report a problem</h1>
      <Banner kind="info" title="Private by default:">Only you and SafeZone administrators can read your report. Your guardians cannot see it unless you tick the box below. Reports are stored encrypted.</Banner>
      <form className="card" onSubmit={submit}>
        {done && <Banner kind="ok" live title="Received:">Your report was sent. An administrator will review it. You can see its status below.</Banner>}
        <ErrorNote error={error} />
        <fieldset style={{ border: 0, padding: 0, margin: '1rem 0 0' }}>
          <legend><strong>What happened?</strong></legend>
          {Object.entries(categoryLabel).map(([k, v]) => (
            <label key={k} className="choice"><input type="radio" name="cat" checked={form.category === k} onChange={() => setForm({ ...form, category: k })} /><span><strong>{v}</strong></span></label>
          ))}
        </fieldset>
        <Field label="Tell us in your own words" id="desc" hint={`${form.description.length}/2000 characters. Say only what you want to. You do not need to name anyone.`}>
          <textarea id="desc" required minLength={10} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="When did it happen? (optional)" id="when"><input id="when" type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} /></Field>
        <label className="choice"><input type="checkbox" checked={form.share} onChange={(e) => setForm({ ...form, share: e.target.checked })} /><span><strong>Also show this report to my connected guardians</strong>Leave this off to keep it private.</span></label>
        <button type="submit" disabled={busy || form.description.trim().length < 10}>{busy ? 'Sending…' : 'Send report'}</button>
        <p className="small muted" style={{ marginTop: '.75rem' }}>This is not an emergency line. If you are in danger now, use the SOS button or call local emergency services.</p>
      </form>

      <section className="card" aria-labelledby="my-h">
        <h2 id="my-h">My reports</h2>
        {mine.loading ? <Loading /> : mine.data?.length ? (
          <ul className="list">
            {mine.data.map((r) => (
              <li key={r.id}>
                <div className="row between"><strong>{categoryLabel[r.category]}</strong><Pill kind={STATUS[r.status][0]}>{STATUS[r.status][1]}</Pill></div>
                <p className="small muted">Sent {fmtTime(r.createdAt)} · {r.visibility === 'admin_only' ? 'Private to administrators' : 'Shared with guardians'}</p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
              </li>
            ))}
          </ul>
        ) : <p className="muted">You have not sent any reports.</p>}
      </section>
    </div>
  );
}
