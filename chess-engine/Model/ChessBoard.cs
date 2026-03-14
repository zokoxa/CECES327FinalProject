using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Linq;
using Cecs475.BoardGames.Chess.Model;

#pragma warning disable 1591 // disable warning about missing XML documentation.

namespace Cecs475.BoardGames.Chess.Model
{
	/// <summary>
	/// Represents the board state of a game of chess. Tracks which squares of the 8x8 board are occupied
	/// by which player's pieces.
	/// </summary>
	public class ChessBoard
	{
		#region Member fields.

		public const int BoardSize = 8;
		// The history of moves applied to the board.
		private List<ChessMove> mMoveHistory = new List<ChessMove>();

		// TODO: Add fields to implement bitboards for the black and white pieces.
		private byte[,] mBoard = new byte[BoardSize, BoardSize / 2];
		// TODO: Add a means of tracking miscellaneous board state, like captured pieces and the 50-move rule.
		private bool p0kingMoved;
		private bool p1kingMoved;
		private bool p0leftRookMoved;
		private bool p0rightRookMoved;
		private bool p1leftRookMoved;
		private bool p1rightRookMoved;
		private BoardPosition? enPassantTarget;
		private int turnCounter;

		private int materialAdvantage;

		private struct Moves
		{
			public ChessMove Move;
			public ChessPiece CapturedPiece;
			public bool WhiteKingMoved;
			public bool BlackKingMoved;
			public bool WhiteRookKingsideMoved;
			public bool WhiteRookQueensideMoved;
			public bool BlackRookKingsideMoved;
			public bool BlackRookQueensideMoved;
			public BoardPosition? EnPassantPosition;
			public int DrawCounter;
			public int Advantage;
		}


		private Stack<Moves> undoStack = new Stack<Moves>();

		#endregion

		#region Auto properties.
		public int CurrentPlayer { get; private set; }

		public GameAdvantage CurrentAdvantage { get; private set; }
		#endregion

		#region Computed properties
		public bool IsFinished
		{
			get { return IsCheckmate || IsDraw; }
		}

		public IReadOnlyList<ChessMove> MoveHistory => mMoveHistory;

		public bool IsCheck
		{
			get {
				var kings = GetPositionsOfPiece(ChessPieceType.King, CurrentPlayer).ToList();
				int opp = CurrentPlayer == 1 ? 2 : 1;
				return kings.Count > 0 && IsPositionAttackedBy(kings[0], opp);
    		}
		}

		public bool IsCheckmate
		{
			get { return IsCheck && !GetPossibleMoves().Any(); }
		}

		public bool IsStalemate
		{
			get { return !IsCheck && !GetPossibleMoves().Any(); }
		}

		public bool IsDraw
		{
			get { return IsStalemate || turnCounter >= 100; }
		}

		public int DrawCounter
		{
			get { return turnCounter; }
		}
		#endregion


		#region Constructors.
		public ChessBoard()
		{
			CurrentPlayer = 1;
			SetPieceAtPosition(new BoardPosition(0, 0), new ChessPiece(ChessPieceType.Rook, 2));
			SetPieceAtPosition(new BoardPosition(0, 1), new ChessPiece(ChessPieceType.Knight, 2));
			SetPieceAtPosition(new BoardPosition(0, 2), new ChessPiece(ChessPieceType.Bishop, 2));
			SetPieceAtPosition(new BoardPosition(0, 3), new ChessPiece(ChessPieceType.Queen, 2));
			SetPieceAtPosition(new BoardPosition(0, 4), new ChessPiece(ChessPieceType.King, 2));
			SetPieceAtPosition(new BoardPosition(0, 5), new ChessPiece(ChessPieceType.Bishop, 2));
			SetPieceAtPosition(new BoardPosition(0, 6), new ChessPiece(ChessPieceType.Knight, 2));
			SetPieceAtPosition(new BoardPosition(0, 7), new ChessPiece(ChessPieceType.Rook, 2));
			for (int i = 0; i < 8; i++)
			{
				SetPieceAtPosition(new BoardPosition(1, i), new ChessPiece(ChessPieceType.Pawn, 2));
			}
				
			
			for (int i = 0; i < 8; i++)
			{
				SetPieceAtPosition(new BoardPosition(6, i), new ChessPiece(ChessPieceType.Pawn, 1));
			}
			SetPieceAtPosition(new BoardPosition(7, 0), new ChessPiece(ChessPieceType.Rook, 1));
			SetPieceAtPosition(new BoardPosition(7, 1), new ChessPiece(ChessPieceType.Knight, 1));
			SetPieceAtPosition(new BoardPosition(7, 2), new ChessPiece(ChessPieceType.Bishop, 1));
			SetPieceAtPosition(new BoardPosition(7, 3), new ChessPiece(ChessPieceType.Queen, 1));
			SetPieceAtPosition(new BoardPosition(7, 4), new ChessPiece(ChessPieceType.King, 1));
			SetPieceAtPosition(new BoardPosition(7, 5), new ChessPiece(ChessPieceType.Bishop, 1));
			SetPieceAtPosition(new BoardPosition(7, 6), new ChessPiece(ChessPieceType.Knight, 1));
			SetPieceAtPosition(new BoardPosition(7, 7), new ChessPiece(ChessPieceType.Rook, 1));

			CurrentAdvantage = new GameAdvantage(0, 0);
		}

		public ChessBoard(IEnumerable<Tuple<BoardPosition, ChessPiece>> pieces)
		{
			CurrentPlayer = 1;
			foreach (var (pos, piece) in pieces)
				SetPieceAtPosition(pos, piece);
			CurrentAdvantage = new GameAdvantage(0, 0);
		}
 
		#endregion

		#region Public methods.
		public IEnumerable<ChessMove> GetPossibleMoves()
		{
			var moves = new List<ChessMove>();

			foreach (var pos in BoardPosition.GetRectangularPositions(BoardSize, BoardSize))
			{
				var piece = GetPieceAtPosition(pos);
				if (piece.PieceType == ChessPieceType.Empty || piece.Player != CurrentPlayer)
					continue;

				switch (piece.PieceType)
				{
					case ChessPieceType.Pawn:   moves.AddRange(GetPawnMoves(pos)); break;
					case ChessPieceType.Rook:   moves.AddRange(GetSlidingMoves(pos, RookDirections)); break;
					case ChessPieceType.Knight: moves.AddRange(GetKnightMoves(pos)); break;
					case ChessPieceType.Bishop: moves.AddRange(GetSlidingMoves(pos, BishopDirections)); break;
					case ChessPieceType.Queen:  moves.AddRange(GetSlidingMoves(pos, QueenDirections)); break;
					case ChessPieceType.King:   moves.AddRange(GetKingMoves(pos)); break;
				}
			}

			return moves.Where(m => !MoveLeavesKingInCheck(m)).ToList();
		}

		public IEnumerable<BoardPosition> GetAttackedPositions(int player)
		{
			return BoardPosition.GetRectangularPositions(BoardSize, BoardSize)
				.Where(pos => IsPositionAttackedBy(pos, player));
		}

		public void ApplyMove(ChessMove m)
		{
			ApplyMoveInternal(m);
			mMoveHistory.Add(m);
		}

		public void UndoLastMove()
		{
			if (undoStack.Count == 0) return;
			UndoMoveInternal();
			mMoveHistory.RemoveAt(mMoveHistory.Count - 1);
		}

		/// <summary>
		/// Returns whatever chess piece is occupying the given position.
		/// </summary>
		public ChessPiece GetPieceAtPosition(BoardPosition pos)
		{
			//left side even, right side odd
			int materialCol = pos.Column / 2;
			byte val = mBoard[pos.Row, materialCol];
			//use a mask to get the correct 4 bits
			//we need to shift the bits by 4 if it's an even column
			//then we AND to isolate the 4 bits we care about
			int bits = (pos.Column % 2 == 0) ? (val >> 4) & 0x0F : val & 0x0F;
			//mask last 3 bits to get piece type
			int pieceType = bits & 0x7;
			if (pieceType == 0) return ChessPiece.Empty;
			//mask 1 bit to get player
			int player = (bits & 0x8) != 0 ? 2 : 1;
			//cast and return
			return new ChessPiece((ChessPieceType)pieceType, player);
		}

		/// <summary>
		/// Retruns whatever player is occupying the given position.
		/// </summary>
		public int GetPlayerAtPosition(BoardPosition pos)
		{
			return GetPieceAtPosition(pos).Player;
		}

		/// <summary>
		/// Returns all board positions where the given piece can be found.
		/// </summary>
		public IEnumerable<BoardPosition> GetPositionsOfPiece(ChessPiece piece)
		{
			return BoardPosition.GetRectangularPositions(BoardSize, BoardSize)
				.Where(pos => GetPieceAtPosition(pos).Equals(piece));
		}

		/// <summary>
		/// Returns all board positions where the given piece can be found.
		/// </summary>
		public IEnumerable<BoardPosition> GetPositionsOfPiece(ChessPieceType pieceType, int player)
		{
			return GetPositionsOfPiece(new ChessPiece(pieceType, player));
		}

		/// <summary>
		/// Returns true if the given position has no piece on it.
		/// </summary>
		public bool PositionIsEmpty(BoardPosition position)
		{
			return GetPieceAtPosition(position).PieceType == ChessPieceType.Empty;
		}

		/// <summary>
		/// Returns true if the given position contains a piece that is the enemy of the given player.
		/// </summary>
		/// <remarks>returns false if the position is not in bounds</remarks>
		public bool PositionIsEnemy(BoardPosition pos, int player)
		{
			if (pos.Row < 0 || pos.Row >= BoardSize || pos.Column < 0 || pos.Column >= BoardSize)
			{
				return false;
			}
			ChessPiece piece = GetPieceAtPosition(pos);
			return piece.Player != 0 && piece.Player != player;
		}
		#endregion

		#region Private methods.
		/// <summary>
		/// Mutates the board state so that the given piece is at the given position.
		/// </summary>
		private void SetPieceAtPosition(BoardPosition pos, ChessPiece piece)
		{
			int materialCol = pos.Column / 2;
			byte val = mBoard[pos.Row, materialCol];

			byte newVal = (byte)(((piece.Player == 2 ? 1 : 0) << 3) | ((byte)piece.PieceType));

			if (pos.Column % 2 == 0)
			{
				//even column, shift newVal to the left and OR with the right 4 bits of val
				newVal = (byte)(newVal << 4);
				newVal = (byte)(newVal | (val & 0x0F));
			}
			else
			{
				//odd column, OR with the left 4 bits of val
				newVal = (byte)(newVal | (val & 0xF0));
			}
			mBoard[pos.Row, materialCol] = newVal;
		}

		private static bool IsInBounds(BoardPosition pos)
		{
			return pos.Row >= 0 && pos.Row < BoardSize && pos.Column >= 0 && pos.Column < BoardSize;
		}

		private static readonly BoardDirection[] KnightDirections = new BoardDirection[] {
			new BoardDirection(-2, -1), new BoardDirection(-2, 1), new BoardDirection(-1, -2), new BoardDirection(-1, 2),
			new BoardDirection(1, -2), new BoardDirection(1, 2), new BoardDirection(2, -1), new BoardDirection(2, 1)
		};

		private static readonly BoardDirection[] KingDirections = new BoardDirection[] {
			new BoardDirection(-1, -1), new BoardDirection(-1, 0), new BoardDirection(-1, 1),
			new BoardDirection(0, -1),  new BoardDirection(0, 1),
			new BoardDirection(1, -1),  new BoardDirection(1, 0), new BoardDirection(1, 1)
		};

		private static readonly BoardDirection[] RookDirections = new BoardDirection[] {
			new BoardDirection(-1, 0), new BoardDirection(0, -1), new BoardDirection(0, 1), new BoardDirection(1, 0)
		};

		private static readonly BoardDirection[] BishopDirections = new BoardDirection[] {
			new BoardDirection(-1, -1), new BoardDirection(-1, 1), new BoardDirection(1, -1), new BoardDirection(1, 1)
		};

		private static readonly BoardDirection[] QueenDirections = new BoardDirection[] {
			new BoardDirection(-1, -1), new BoardDirection(-1, 0), new BoardDirection(-1, 1),
			new BoardDirection(0, -1),  new BoardDirection(0, 1),
			new BoardDirection(1, -1),  new BoardDirection(1, 0), new BoardDirection(1, 1)
		};

		private bool IsPositionAttackedBy(BoardPosition pos, int attackingPlayer)
		{
			foreach (var dir in RookDirections)
			{
				var cur = pos.Translate(dir);
				while (IsInBounds(cur))
				{
					var piece = GetPieceAtPosition(cur);
					if (piece.Player == attackingPlayer &&
						(piece.PieceType == ChessPieceType.Rook || piece.PieceType == ChessPieceType.Queen))
						return true;
					if (piece.PieceType != ChessPieceType.Empty) break;
					cur = cur.Translate(dir);
				}
			}
			foreach (var dir in BishopDirections)
			{
				var cur = pos.Translate(dir);
				while (IsInBounds(cur))
				{
					var piece = GetPieceAtPosition(cur);
					if (piece.Player == attackingPlayer &&
						(piece.PieceType == ChessPieceType.Bishop || piece.PieceType == ChessPieceType.Queen))
						return true;
					if (piece.PieceType != ChessPieceType.Empty) break;
					cur = cur.Translate(dir);
				}
			}
			foreach (var dir in KnightDirections)
			{
				var cur = pos.Translate(dir);
				if (IsInBounds(cur))
				{
					var piece = GetPieceAtPosition(cur);
					if (piece.Player == attackingPlayer && piece.PieceType == ChessPieceType.Knight)
						return true;
				}
			}
			foreach (var dir in KingDirections)
			{
				var cur = pos.Translate(dir);
				if (IsInBounds(cur))
				{
					var piece = GetPieceAtPosition(cur);
					if (piece.Player == attackingPlayer && piece.PieceType == ChessPieceType.King)
						return true;
				}
			}
			int pawnDir = attackingPlayer == 1 ? 1 : -1;
			foreach (int colOff in new[] { -1, 1 })
			{
				var pawnPos = new BoardPosition(pos.Row + pawnDir, pos.Column + colOff);
				if (IsInBounds(pawnPos))
				{
					var piece = GetPieceAtPosition(pawnPos);
					if (piece.Player == attackingPlayer && piece.PieceType == ChessPieceType.Pawn)
						return true;
				}
			}
			return false;
		}

		/// <summary>
		/// Returns true if applying the move would leave the current player's king in check.
		/// </summary>
		private bool MoveLeavesKingInCheck(ChessMove move)
		{
			ApplyMoveInternal(move);
			int movingPlayer = 3 - CurrentPlayer;
			var kings = GetPositionsOfPiece(ChessPieceType.King, movingPlayer).ToList();
			bool inCheck = kings.Count > 0 && IsPositionAttackedBy(kings[0], CurrentPlayer);
			UndoMoveInternal();
			return inCheck;
		}

		private IEnumerable<ChessMove> GetSlidingMoves(BoardPosition pos, BoardDirection[] dirs)
		{
			var moves = new List<ChessMove>();
			foreach (var dir in dirs)
			{
				var cur = pos.Translate(dir);
				while (IsInBounds(cur))
				{
					if (PositionIsEmpty(cur))
					{
						moves.Add(new ChessMove(pos, cur));
						cur = cur.Translate(dir);
					}
					else if (PositionIsEnemy(cur, CurrentPlayer))
					{
						moves.Add(new ChessMove(pos, cur));
						break;
					}
					else
					{
						break; // friendly piece, stop
					}
				}
			}
			return moves;
		}

		private IEnumerable<ChessMove> GetKnightMoves(BoardPosition pos)
		{
			var moves = new List<ChessMove>();

			foreach (var dir in KnightDirections)
			{
				var newPos = pos.Translate(dir);
				if (IsInBounds(newPos) && (PositionIsEnemy(newPos, CurrentPlayer) ||
					PositionIsEmpty(newPos)))
					moves.Add(new ChessMove(pos, newPos));
				else
					continue;
			}
			return moves;
		}

		private IEnumerable<ChessMove> GetKingMoves(BoardPosition pos)
		{
			var moves = new List<ChessMove>();
			int opp = CurrentPlayer == 1 ? 2 : 1;
			
			foreach(var dir in KingDirections)
			{
				var destination = pos.Translate(dir);
				if (IsInBounds(destination) && (PositionIsEmpty(destination) 
				|| PositionIsEnemy(destination, CurrentPlayer)))
				{
					moves.Add(new ChessMove(pos, destination));
				}
			}

			bool kingMoved = CurrentPlayer == 1 ? p0kingMoved : p1kingMoved;

			if(!kingMoved && !IsPositionAttackedBy(pos, opp))
			{
				bool kingsideRookMoved = CurrentPlayer == 1 ? p0rightRookMoved : p1rightRookMoved;
				if (!kingsideRookMoved)
				{
					var f = pos.Translate(0, 1);
					var g = pos.Translate(0, 2);
					if (PositionIsEmpty(f) && PositionIsEmpty(g)
						&& !IsPositionAttackedBy(f, opp) && !IsPositionAttackedBy(g, opp))
						moves.Add(new ChessMove(pos, g, ChessMoveType.CastleKingSide));
				}
				bool queensideRookMoved = CurrentPlayer == 1 ? p0leftRookMoved : p1leftRookMoved;
				if (!queensideRookMoved)
				{
					var d = pos.Translate(0, -1);
					var c = pos.Translate(0, -2);
					var b = pos.Translate(0, -3);
					if (PositionIsEmpty(d) && PositionIsEmpty(c) && PositionIsEmpty(b)
						&& !IsPositionAttackedBy(d, opp) && !IsPositionAttackedBy(c, opp))
						moves.Add(new ChessMove(pos, c, ChessMoveType.CastleQueenSide));
				}
			}
			return moves;
		}

		private IEnumerable<ChessMove> GetPawnMoves(BoardPosition pos)
		{
			var moves = new List<ChessMove>();
			int playerDirection = CurrentPlayer == 1 ? -1 : 1;
			BoardPosition forward = pos.Translate(playerDirection, 0);
			int homeRow = CurrentPlayer == 1 ? 6 : 1;
			int promRow = CurrentPlayer == 1 ? 0 : 7;

			// Move forward
			if (IsInBounds(forward) && PositionIsEmpty(forward))
			{
				if (forward.Row == promRow)
				{
					// Promotion
					AddPromotionMoves(moves, pos, forward);
				}
				else
				{
					moves.Add(new ChessMove(pos, forward));
					if (pos.Row == homeRow)
					{
						BoardPosition doubleForward = forward.Translate(playerDirection, 0);
						if (IsInBounds(doubleForward) && PositionIsEmpty(doubleForward))
						{
							moves.Add(new ChessMove(pos, doubleForward));
						}
					}
				}
			}

			//Diagonal captures
			foreach (int columnOffset in new int[] { -1, 1 })
			{
				var diagPos = pos.Translate(playerDirection, columnOffset);
				if (IsInBounds(diagPos) && PositionIsEnemy(diagPos, CurrentPlayer))
				{
					if (diagPos.Row == promRow)
					{
						AddPromotionMoves(moves, pos, diagPos);
					}
					else
					{
						moves.Add(new ChessMove(pos, diagPos));
					}
				}
				if (enPassantTarget.HasValue)
				{
					var ep = enPassantTarget.Value;
					if (ep.Row == pos.Row && ep.Column == pos.Column + columnOffset)
						moves.Add(new ChessMove(pos, new BoardPosition(ep.Row + playerDirection, ep.Column), ChessMoveType.EnPassant));
				}
			}
			return moves;
		}
		private void AddPromotionMoves(List<ChessMove> moves, BoardPosition from, BoardPosition to)
		{
			moves.Add(new PawnPromotionChessMove(from, to, ChessPieceType.Queen));
			moves.Add(new PawnPromotionChessMove(from, to, ChessPieceType.Rook));
			moves.Add(new PawnPromotionChessMove(from, to, ChessPieceType.Bishop));
			moves.Add(new PawnPromotionChessMove(from, to, ChessPieceType.Knight));
		}
		private void UndoMoveInternal()
{
			var saved = undoStack.Pop();
			var m = saved.Move;
			var movingPiece = GetPieceAtPosition(m.EndPosition);

			switch (m.MoveType)
			{
				case ChessMoveType.Normal:
					SetPieceAtPosition(m.StartPosition, movingPiece);
					SetPieceAtPosition(m.EndPosition, saved.CapturedPiece);
					break;
				case ChessMoveType.EnPassant:
					SetPieceAtPosition(m.StartPosition, movingPiece);
					SetPieceAtPosition(m.EndPosition, ChessPiece.Empty);
					var epPawn = new BoardPosition(m.StartPosition.Row, m.EndPosition.Column);
					SetPieceAtPosition(epPawn, saved.CapturedPiece);
					break;
				case ChessMoveType.CastleKingSide:
					SetPieceAtPosition(m.StartPosition, movingPiece);
					SetPieceAtPosition(m.EndPosition, ChessPiece.Empty);
					var ksRookDest = new BoardPosition(m.StartPosition.Row, 5);
					SetPieceAtPosition(new BoardPosition(m.StartPosition.Row, 7), GetPieceAtPosition(ksRookDest));
					SetPieceAtPosition(ksRookDest, ChessPiece.Empty);
					break;
				case ChessMoveType.CastleQueenSide:
					SetPieceAtPosition(m.StartPosition, movingPiece);
					SetPieceAtPosition(m.EndPosition, ChessPiece.Empty);
					var qsRookDest = new BoardPosition(m.StartPosition.Row, 3);
					SetPieceAtPosition(new BoardPosition(m.StartPosition.Row, 0), GetPieceAtPosition(qsRookDest));
					SetPieceAtPosition(qsRookDest, ChessPiece.Empty);
					break;
				case ChessMoveType.PawnPromote:
					SetPieceAtPosition(m.StartPosition, new ChessPiece(ChessPieceType.Pawn, saved.Move.Player));
					SetPieceAtPosition(m.EndPosition, saved.CapturedPiece);
					break;
			}
			p0kingMoved = saved.WhiteKingMoved;
			p1kingMoved = saved.BlackKingMoved;
			p0rightRookMoved = saved.WhiteRookKingsideMoved;
			p0leftRookMoved = saved.WhiteRookQueensideMoved;
			p1rightRookMoved = saved.BlackRookKingsideMoved;
			p1leftRookMoved = saved.BlackRookQueensideMoved;
			enPassantTarget = saved.EnPassantPosition;
			turnCounter = saved.DrawCounter;
			materialAdvantage = saved.Advantage;
			CurrentAdvantage = materialAdvantage > 0 ? new GameAdvantage(1, materialAdvantage)
				: materialAdvantage < 0 ? new GameAdvantage(2, -materialAdvantage)
				: new GameAdvantage(0, 0);

			CurrentPlayer = CurrentPlayer == 1 ? 2 : 1;
		}

		private void ApplyMoveInternal(ChessMove m)
		{
			var movingPiece = GetPieceAtPosition(m.StartPosition);
			var capturedPiece = GetPieceAtPosition(m.EndPosition);
			undoStack.Push(new Moves {
				Move = m,
				CapturedPiece = capturedPiece,
				WhiteKingMoved = p0kingMoved,
				BlackKingMoved = p1kingMoved,
				WhiteRookKingsideMoved = p0rightRookMoved,
				WhiteRookQueensideMoved = p0leftRookMoved,
				BlackRookKingsideMoved = p1rightRookMoved,
				BlackRookQueensideMoved = p1leftRookMoved,
				EnPassantPosition = enPassantTarget,
				DrawCounter = turnCounter,
				Advantage = materialAdvantage,
			});
			enPassantTarget = null;
			switch (m.MoveType)
			{
				case ChessMoveType.Normal:
					SetPieceAtPosition(m.EndPosition, movingPiece);
					SetPieceAtPosition(m.StartPosition, ChessPiece.Empty);
					if (movingPiece.PieceType == ChessPieceType.Pawn
						&& Math.Abs(m.EndPosition.Row - m.StartPosition.Row) == 2)
						enPassantTarget = m.EndPosition;
					break;

				case ChessMoveType.EnPassant:
					SetPieceAtPosition(m.EndPosition, movingPiece);
					SetPieceAtPosition(m.StartPosition, ChessPiece.Empty);
					var epPawn = new BoardPosition(m.StartPosition.Row, m.EndPosition.Column);
					capturedPiece = GetPieceAtPosition(epPawn);
					SetPieceAtPosition(epPawn, ChessPiece.Empty);
					var top = undoStack.Pop();
					top.CapturedPiece = capturedPiece;
					undoStack.Push(top);
					break;
				case ChessMoveType.CastleKingSide:
					SetPieceAtPosition(m.EndPosition, movingPiece);
					SetPieceAtPosition(m.StartPosition, ChessPiece.Empty);
					var ksRook = new BoardPosition(m.StartPosition.Row, 7);
					SetPieceAtPosition(new BoardPosition(m.StartPosition.Row, 5), GetPieceAtPosition(ksRook));
					SetPieceAtPosition(ksRook, ChessPiece.Empty);
					break;
				case ChessMoveType.CastleQueenSide:
					SetPieceAtPosition(m.EndPosition, movingPiece);
					SetPieceAtPosition(m.StartPosition, ChessPiece.Empty);
					var qsRook = new BoardPosition(m.StartPosition.Row, 0);
					SetPieceAtPosition(new BoardPosition(m.StartPosition.Row, 3), GetPieceAtPosition(qsRook));
					SetPieceAtPosition(qsRook, ChessPiece.Empty);
					break;
				case ChessMoveType.PawnPromote:
					var promo = (PawnPromotionChessMove)m;
					SetPieceAtPosition(m.EndPosition, new ChessPiece(promo.SelectedPromotion, CurrentPlayer));
					SetPieceAtPosition(m.StartPosition, ChessPiece.Empty);
					break;
			}
			if (movingPiece.PieceType == ChessPieceType.King)
			{ if (CurrentPlayer == 1) p0kingMoved = true; else p1kingMoved = true; }
			if (m.StartPosition == new BoardPosition(7, 7)) p0rightRookMoved = true;
			if (m.StartPosition == new BoardPosition(7, 0)) p0leftRookMoved = true;
			if (m.StartPosition == new BoardPosition(0, 7)) p1rightRookMoved = true;
			if (m.StartPosition == new BoardPosition(0, 0)) p1leftRookMoved = true;
	
			if (m.EndPosition == new BoardPosition(7, 7)) p0rightRookMoved = true;
			if (m.EndPosition == new BoardPosition(7, 0)) p0leftRookMoved = true;
			if (m.EndPosition == new BoardPosition(0, 7)) p1rightRookMoved = true;
			if (m.EndPosition == new BoardPosition(0, 0)) p1leftRookMoved = true;

			bool isCapture = capturedPiece.PieceType != ChessPieceType.Empty;
			bool isPawnMove = movingPiece.PieceType == ChessPieceType.Pawn;
			turnCounter = (isPawnMove || isCapture) ? 0 : turnCounter + 1;

			if (isCapture) materialAdvantage += GetPieceValue(capturedPiece) * (CurrentPlayer == 1 ? 1 : -1);
			if (m.MoveType == ChessMoveType.PawnPromote)
				materialAdvantage += (GetPieceValue(((PawnPromotionChessMove)m).SelectedPromotion) - 1) * (CurrentPlayer == 1 ? 1 : -1);
			CurrentAdvantage = materialAdvantage > 0 ? new GameAdvantage(1, materialAdvantage)
				: materialAdvantage < 0 ? new GameAdvantage(2, -materialAdvantage)
				: new GameAdvantage(0, 0);

			m.Player = CurrentPlayer;
			CurrentPlayer = CurrentPlayer == 1 ? 2 : 1;
		}

		private static int GetPieceValue(ChessPiece piece) => piece.PieceType switch {
			ChessPieceType.Pawn => 1,
			ChessPieceType.Knight => 3,
			ChessPieceType.Bishop => 3,
			ChessPieceType.Rook => 5,
			ChessPieceType.Queen => 9,
			_ => 0
		};
		
		private static int GetPieceValue(ChessPieceType t) => GetPieceValue(new ChessPiece(t, 1));
		#endregion
	}
}
