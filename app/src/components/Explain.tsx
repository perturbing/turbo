import { useState } from 'react';
import { GLOSSARY, type MetricKey } from '../ui/glossary';

// A "?" next to a metric that opens its plain-language explanation inline.
// Every training number in the app gets one: a first-time rider should never
// meet an unexplained acronym.
export function Explain({ term }: { term: MetricKey }) {
  const [open, setOpen] = useState(false);
  const g = GLOSSARY[term];
  return (
    <>
      <button
        type="button"
        className="explain-toggle"
        aria-expanded={open}
        aria-label={`What is ${g.name}?`}
        title={g.short}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open ? (
        <div className="explain-popover" role="note">
          <div className="row between">
            <strong>{g.name}</strong>
            <button type="button" className="small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <p>{g.short}</p>
          <p>
            <span className="muted">How it is computed. </span>
            {g.how}
          </p>
          <p>
            <span className="muted">How to read it. </span>
            {g.read}
          </p>
          <p>
            <span className="muted">What it does not tell you. </span>
            {g.caveat}
          </p>
          <p className="muted small">Source: {g.source}</p>
        </div>
      ) : null}
    </>
  );
}

// A metric tile with the explainer built in.
export function ExplainedTile({
  term,
  label,
  value,
  unit,
  decimals = 0,
  sub,
}: {
  term: MetricKey;
  label: string;
  value: number | null | undefined;
  unit?: string;
  decimals?: number;
  sub?: string;
}) {
  return (
    <div className="metric-tile explained">
      <div className="label">
        {label} <Explain term={term} />
      </div>
      <div className="value">
        {value === null || value === undefined ? '—' : value.toFixed(decimals)}
        {unit ? <span className="unit"> {unit}</span> : null}
      </div>
      {sub ? <div className="unit">{sub}</div> : null}
    </div>
  );
}

// Full glossary, one section per metric.
export function Glossary({ terms }: { terms?: MetricKey[] }) {
  const keys = terms ?? (Object.keys(GLOSSARY) as MetricKey[]);
  return (
    <div className="stack">
      {keys.map((k) => {
        const g = GLOSSARY[k];
        return (
          <details key={k} className="glossary-entry">
            <summary>
              <strong>{g.name}</strong> <span className="muted">— {g.short}</span>
            </summary>
            <p>
              <span className="muted">How it is computed. </span>
              {g.how}
            </p>
            <p>
              <span className="muted">How to read it. </span>
              {g.read}
            </p>
            <p>
              <span className="muted">What it does not tell you. </span>
              {g.caveat}
            </p>
            <p className="muted small">Source: {g.source}</p>
          </details>
        );
      })}
    </div>
  );
}
