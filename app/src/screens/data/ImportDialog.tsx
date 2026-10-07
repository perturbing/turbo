import type { ImportPreview } from '../../data/exportImport';

// Shows what an import will add before anything is written (design doc §9).
export function ImportDialog({
  preview,
  onClose,
  onCommit,
}: {
  preview: ImportPreview;
  onClose: () => void;
  onCommit: () => Promise<void>;
}) {
  const adds = (items: { action: string }[]) => items.filter((i) => i.action !== 'skip').length;
  const skips = (items: { action: string }[]) => items.filter((i) => i.action === 'skip').length;
  const copies = preview.recipes.filter((i) => i.action === 'copy');
  const totalAdds =
    adds(preview.recipes) + adds(preview.recordings) + adds(preview.ftpObservations) + adds(preview.plans);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog stack" onClick={(e) => e.stopPropagation()}>
        <h1>Import data</h1>
        <table className="data">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Will add</th>
              <th className="num">Already present</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Workouts</td>
              <td className="num">{adds(preview.recipes)}</td>
              <td className="num">{skips(preview.recipes)}</td>
            </tr>
            <tr>
              <td>Ride recordings</td>
              <td className="num">{adds(preview.recordings)}</td>
              <td className="num">{skips(preview.recordings)}</td>
            </tr>
            <tr>
              <td>FTP observations</td>
              <td className="num">{adds(preview.ftpObservations)}</td>
              <td className="num">{skips(preview.ftpObservations)}</td>
            </tr>
            <tr>
              <td>Planned workouts</td>
              <td className="num">{adds(preview.plans)}</td>
              <td className="num">{skips(preview.plans)}</td>
            </tr>
          </tbody>
        </table>
        {preview.ftpToApply ? (
          <div className="banner small">
            Your FTP will be set to <strong>{preview.ftpToApply.currentFtpW} W</strong> (from{' '}
            {preview.ftpToApply.source}).
          </div>
        ) : null}
        {copies.length > 0 ? (
          <div className="banner small">
            {copies.length} workout(s) exist with the same ID but different content — they will be imported as
            copies, keeping both versions.
          </div>
        ) : null}
        {preview.errors.length > 0 ? (
          <div className="banner danger small">
            {preview.errors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        ) : null}
        <div className="row">
          <button
            className="primary"
            onClick={() => void onCommit()}
            disabled={totalAdds === 0 && !preview.ftpToApply}
          >
            Import {totalAdds} item{totalAdds === 1 ? '' : 's'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
