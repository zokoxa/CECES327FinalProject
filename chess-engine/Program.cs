using Cecs475.BoardGames.Chess.Model;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// POST /validate — check if a proposed move is legal given the move history.
// If valid, also returns game-over state after the move is applied.
app.MapPost("/validate", (ValidateRequest req) =>
{
    var board = new ChessBoard();

    foreach (var mv in req.History)
        board.ApplyMove(ToChessMove(mv));

    var legalMoves = board.GetPossibleMoves().ToList();
    var proposed = ToChessMove(req.Move);
    bool valid = legalMoves.Any(m => MovesMatch(m, proposed));

    if (valid)
        board.ApplyMove(proposed);

    return Results.Ok(new
    {
        valid,
        isCheckmate  = valid && board.IsCheckmate,
        isStalemate  = valid && board.IsStalemate,
        isDraw       = valid && board.IsDraw,
        currentPlayer = board.CurrentPlayer,
        advantage    = new { player = board.CurrentAdvantage.Player, amount = board.CurrentAdvantage.Advantage },
    });
});

// POST /moves — return all legal moves for the current board state.
// Used by the client to highlight valid squares.
app.MapPost("/moves", (HistoryRequest req) =>
{
    var board = new ChessBoard();

    foreach (var mv in req.History)
        board.ApplyMove(ToChessMove(mv));

    var moves = board.GetPossibleMoves().Select(m => new
    {
        fromRow    = m.StartPosition.Row,
        fromCol    = m.StartPosition.Column,
        toRow      = m.EndPosition.Row,
        toCol      = m.EndPosition.Column,
        type       = (int)m.MoveType,
        promotion  = m is PawnPromotionChessMove p ? (int?)p.SelectedPromotion : null,
    });

    return Results.Ok(new
    {
        moves,
        isCheck    = board.IsCheck,
        isCheckmate = board.IsCheckmate,
        isDraw     = board.IsDraw,
        currentPlayer = board.CurrentPlayer,
    });
});

app.Run();

// ─── Helpers ──────────────────────────────────────────────────────────────────

static ChessMove ToChessMove(MoveDto mv)
{
    var from = new BoardPosition(mv.FromRow, mv.FromCol);
    var to   = new BoardPosition(mv.ToRow,   mv.ToCol);
    var type = (ChessMoveType)mv.Type;

    if (type == ChessMoveType.PawnPromote && mv.Promotion.HasValue)
        return new PawnPromotionChessMove(from, to, (ChessPieceType)mv.Promotion.Value);

    return new ChessMove(from, to, type);
}

static bool MovesMatch(ChessMove legal, ChessMove proposed)
{
    if (legal.StartPosition != proposed.StartPosition) return false;
    if (legal.EndPosition   != proposed.EndPosition)   return false;
    if (legal.MoveType      != proposed.MoveType)      return false;

    if (legal is PawnPromotionChessMove lp && proposed is PawnPromotionChessMove pp)
        return lp.SelectedPromotion == pp.SelectedPromotion;

    return true;
}

// ─── Request / Response DTOs ──────────────────────────────────────────────────

record MoveDto(int FromRow, int FromCol, int ToRow, int ToCol, int Type, int? Promotion);
record ValidateRequest(List<MoveDto> History, MoveDto Move);
record HistoryRequest(List<MoveDto> History);
