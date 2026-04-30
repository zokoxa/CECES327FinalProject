const FILES = 'abcdefgh';

function toUci({ fromRow, fromCol, toRow, toCol, promotion }) {
  const from = `${FILES[fromCol]}${8 - fromRow}`;
  const to = `${FILES[toCol]}${8 - toRow}`;
  const promo = promotion ? ['', 'p', 'r', 'n', 'b', 'q', 'k'][promotion] : '';
  return `${from}${to}${promo}`;
}

export default function ReplayPanel({
  moves,
  replayIndex,
  isReplayMode,
  replayEnabled,
  onJumpStart,
  onStepBack,
  onStepForward,
  onJumpEnd,
  onJumpToMove,
}) {
  return (
    <>
      {replayEnabled && (
        <div className="replay-controls">
          <div className="replay-header">
            <strong>Replay</strong>
            <span>Step {replayIndex} of {moves.length}</span>
            {isReplayMode && <span className="replay-badge">Replay mode</span>}
          </div>
          <div className="replay-buttons">
            <button onClick={onJumpStart} disabled={replayIndex === 0}>{'<<'}</button>
            <button onClick={onStepBack} disabled={replayIndex === 0}>{'<'}</button>
            <button onClick={onStepForward} disabled={replayIndex === moves.length}>{'>'}</button>
            <button onClick={onJumpEnd} disabled={replayIndex === moves.length}>{'>>'}</button>
          </div>
        </div>
      )}

      <aside className="move-list">
        <h3>Moves</h3>
        <ol>
          {moves.map((m, i) => (
            <li
              key={i}
              className={replayIndex === i + 1 ? 'active' : ''}
              onClick={replayEnabled ? () => onJumpToMove(i + 1) : undefined}
              title={replayEnabled ? `Jump to move ${i + 1}` : undefined}
              style={replayEnabled ? { cursor: 'pointer' } : { cursor: 'default' }}
            >
              {toUci(m)}
            </li>
          ))}
        </ol>
      </aside>
    </>
  );
}
