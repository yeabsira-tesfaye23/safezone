import { Loading, usePageTitle, useAsync } from '../components/ui.jsx';
import { get } from '../lib/api.js';
import { categoryLabel, fmtTime } from '../lib/format.js';

export default function GuardianReports() {
  usePageTitle('Shared reports');
  const list = useAsync(() => get('/reports'), []);
  return (
    <div className="stack">
      <h1>Reports shared with you</h1>
      <p className="muted">These are reports a young person chose to show to her guardians. Private reports never appear here. Please respond with care: she chose to tell you.</p>
      {list.loading ? <Loading /> : list.data.length === 0 ? <p>Nothing has been shared with you.</p> : (
        <ul className="list card">
          {list.data.map((r) => (
            <li key={r.id}>
              <strong>{categoryLabel[r.category]}</strong> from {r.childName} <span className="muted small">· {fmtTime(r.createdAt)}</span>
              <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
