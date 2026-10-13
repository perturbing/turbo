import { Explain } from './Explain';

const LABELS: Record<number, string> = {
  1: 'a stroll',
  3: 'easy',
  5: 'comfortably hard',
  7: 'hard',
  8: 'very hard',
  10: 'all out',
};

// Borg CR10 effort rating, one tap. The trend over rides is what the form
// verdict looks at; the value is stored on the recording so it exports.
export function EffortRating({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="label">
        How hard did that feel? <Explain term="rpe" />
      </div>
      <div className="row effort-scale" role="radiogroup" aria-label="Effort rating 1 to 10">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={`effort-btn${value === n ? ' selected' : ''}`}
            onClick={() => onChange(n)}
            title={LABELS[n]}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="muted small">
        {value ? `${value}: ${LABELS[value] ?? (value < 5 ? 'easy' : value < 8 ? 'hard' : 'very hard')}` : '1 is a stroll, 5 is comfortably hard, 10 is all out.'}
      </div>
    </div>
  );
}
