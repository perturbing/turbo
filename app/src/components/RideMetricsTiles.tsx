import type { RideMetrics } from '../engine/metrics';
import { ExplainedTile } from './Explain';

// The per-ride training numbers, each with its explainer. Null values render
// as a dash with the reason in the sub line, never as zero.
export function RideMetricsTiles({ metrics: m }: { metrics: RideMetrics }) {
  return (
    <div className="row">
      <ExplainedTile term="np" label="Normalized power" value={m.normalizedPowerW} unit="W" />
      <ExplainedTile term="if" label="Intensity" value={m.intensityFactor} decimals={2} sub={m.ftpUsed ? `of FTP ${m.ftpUsed} W` : 'no FTP'} />
      <ExplainedTile term="tss" label="Training stress" value={m.tss} sub="1 h at FTP = 100" />
      <ExplainedTile
        term="ef"
        label="Efficiency"
        value={m.efficiencyFactor}
        decimals={2}
        unit="W/bpm"
        sub={m.efficiencyFactor === null ? 'needs heart rate' : undefined}
      />
      <ExplainedTile
        term="decoupling"
        label="Decoupling"
        value={m.decouplingPct}
        decimals={1}
        unit="%"
        sub={m.decouplingPct === null ? 'needs a 20 min steady block with HR' : m.decouplingPct < 5 ? 'solid base' : 'drifted'}
      />
      {m.compliancePct !== null ? <ExplainedTile term="compliance" label="On target" value={m.compliancePct} unit="%" /> : null}
    </div>
  );
}
