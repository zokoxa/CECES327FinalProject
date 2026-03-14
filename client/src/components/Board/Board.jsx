/**
 * Board.jsx — Placeholder for your chess board component.
 *
 * Props:
 *   color      {string}   'white' | 'black' — which side this player controls
 *   moves      {string[]} list of moves played so far (SAN or UCI)
 *   onMove     {fn}       called with a move string when the player makes a legal move
 *   onGameOver {fn}       called with (result, reason) when a terminal position is detected
 *   disabled   {bool}     true when the game is over (disables interaction)
 *
 * Swap this file with your own chess board implementation.
 * The interface above is what Game.jsx expects.
 */
export default function Board({ color, moves, onMove, onGameOver, disabled }) {
  return (
    <div
      style={{
        width: 480,
        height: 480,
        background: '#b58863',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 18,
        borderRadius: 4,
      }}
    >
      🟫 Replace this with your Board component
      <br />
      Playing as: {color}
    </div>
  );
}
