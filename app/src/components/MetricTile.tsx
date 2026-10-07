interface Props {
  label: string;
  value?: number | null;
  unit?: string;
  // Pre-formatted value (e.g. a duration); takes precedence over value.
  text?: string;
  // waiting: source never produced data; stale: signal lost. A real 0 renders as 0.
  state?: 'value' | 'waiting' | 'stale';
  big?: boolean;
  decimals?: number;
  sub?: string;
}

export function MetricTile({ label, value, unit = '', text, state = 'value', big, decimals = 0, sub }: Props) {
  let body;
  if (text !== undefined) {
    body = <div className={`value${big ? ' big' : ''}`}>{text}</div>;
  } else if (state === 'waiting' || value === null || value === undefined) {
    body = <div className="value placeholder">{state === 'stale' ? 'Signal lost' : 'Waiting for data'}</div>;
  } else if (state === 'stale') {
    body = <div className="value placeholder">Signal lost</div>;
  } else {
    body = (
      <div className={`value${big ? ' big' : ''}`}>
        {value.toFixed(decimals)} <span className="unit">{unit}</span>
      </div>
    );
  }
  return (
    <div className="metric-tile">
      <div className="label">{label}</div>
      {body}
      {sub ? <div className="unit">{sub}</div> : null}
    </div>
  );
}
