using System;
using System.Collections.Generic;
using System.Linq;

namespace Cecs475.BoardGames.Chess.Model {
	/// <summary>
	/// Represents a row/column position on a 2D grid board.
	/// </summary>
	public readonly struct BoardPosition : IEquatable<BoardPosition> {
		/// <summary>
		/// The row of the position.
		/// </summary>
		public int Row { get; init; } = 0;
		/// <summary>
		/// The column of the position.
		/// </summary>
		public int Column { get; init; } = 0;

		/// <summary>
		/// Constructs the board position (0, 0).
		/// </summary>
		public BoardPosition() {
		}

		/// <summary>
		/// Constructs a board position at the given row and column.
		/// </summary>
		public BoardPosition(int row, int col) {
			Row = row;
			Column = col;
		}

		/// <summary>
		/// Translates the BoardPosition by the given amount in the row and column directions, returning a new
		/// position.
		/// </summary>
		/// <param name="rowOffset">the amount to change the new position's row by</param>
		/// <param name="columnOffset">the amount to change the new position's column by</param>
		/// <returns>a new BoardPosition object that has been translated from the source</returns>
		public BoardPosition Translate(int rowOffset, int columnOffset) =>
			new BoardPosition(Row + rowOffset, Column + columnOffset);

		/// <summary>
		/// Translates the BoardPosition by the given amount in the row and column directions, returning a new
		/// position.
		/// </summary>
		/// <param name="direction">a BoardDirection object giving the amount to change the new position's row and column by</param>
		/// <returns>a new BoardPosition object that has been translated from the source</returns>
		public BoardPosition Translate(BoardDirection direction) =>
			Translate(direction.RowOffset, direction.ColumnOffset);

		/// <summary>
		/// An overridden ToString makes debugging easier.
		/// </summary>
		/// <returns></returns>
		public override string ToString() => $"({Row}, {Column})";

		#region Equality methods and operators
		/// <summary>
		/// Two board positions are equal if they have the same row and column.
		/// </summary>
		public bool Equals(BoardPosition other) => Row == other.Row && Column == other.Column;

		/// <summary>
		/// Two board positions are equal if they have the same row and column.
		/// </summary>
		public override bool Equals(object? obj) => obj is BoardPosition rhs && Equals(rhs);

		/// <summary>
		/// Two board positions are equal if they have the same row and column.
		/// </summary>
		public static bool operator ==(BoardPosition left, BoardPosition right) => left.Equals(right);

		/// <summary>
		/// Two board positions are equal if they have the same row and column.
		/// </summary>
		public static bool operator !=(BoardPosition left, BoardPosition right) => !left.Equals(right);

		/// <summary>
		/// Returns the hash code for this instance.
		/// </summary>
		public override int GetHashCode() {
			unchecked {
				return (Row * 397) ^ Column;
			}
		}
		#endregion

		/// <summary>
		/// Returns a sequence of BoardPosition objects representing each square on a given rectangular
		/// game board, in row-major order.
		/// </summary>
		/// <param name="rows">the number of horizontal rows on the board</param>
		/// <param name="cols">the number of vertical columns on the board</param>
		public static IEnumerable<BoardPosition> GetRectangularPositions(int rows, int cols) {
			return Enumerable.Range(0, rows).SelectMany(
				r => Enumerable.Range(0, cols),
				(r, c) => new BoardPosition(r, c));
		}
	}
}
