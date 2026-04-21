using System;
using System.Collections.Generic;
using System.Text;
#pragma warning disable 1591 // disable warning about missing XML documentation.
namespace Cecs475.BoardGames.Chess.Model {
	/// <summary>
	/// Represents a chess piece owned by a particular player.
	/// </summary>
	public readonly struct ChessPiece {
		/// <summary>
		/// The type of the piece.
		/// </summary>
		public ChessPieceType PieceType { get; }

		/// <summary>
		/// The player that controls the piece.
		/// </summary>
		public sbyte Player { get; }

		public ChessPiece(ChessPieceType pieceType, int player) {
			PieceType = pieceType;
			Player = (sbyte)player;
		}

		/// <summary>
		/// A ChessPiece that is equal to any empty position on a chess board.
		/// </summary>
		public static ChessPiece Empty { get; } = new ChessPiece(ChessPieceType.Empty, 0);
	}
}
