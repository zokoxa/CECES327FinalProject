using System;
using System.Collections.Generic;

namespace Cecs475.BoardGames.Chess.Model {
	/// <summary>
	/// Represents a direction of movement on a rectangular game board grid.
	/// </summary>
	public readonly struct BoardDirection : IEquatable<BoardDirection> {
		/// <summary>
		/// Negative means "up", positive means "down".
		/// </summary>
		public sbyte RowOffset { get; init; } = 0;
		/// <summary>
		/// Negative means "left", positive means "right".
		/// </summary>
		public sbyte ColumnOffset { get; init; } = 0;

		/// <summary>
		/// Constructs a board direction representing the given row and column offset.
		/// </summary>
		public BoardDirection(sbyte rowOffset, sbyte colOffset) {
			RowOffset = rowOffset;
			ColumnOffset = colOffset;
		}

		/// <summary>
		/// Constructs a board direction for "no movement", i.e., an offset of (0, 0).
		/// </summary>
		public BoardDirection() {
		}

		/// <summary>
		/// An overridden ToString makes debugging easier.
		/// </summary>
		public override string ToString() =>
			$"<{RowOffset}, {ColumnOffset}>";


		#region Equality methods and operators.
		/// <summary>
		/// True if the two objects have the same offsets.
		/// </summary>
		public bool Equals(BoardDirection other) =>
			RowOffset == other.RowOffset && ColumnOffset == other.ColumnOffset;

		/// <summary>
		/// True if the two objects have the same offsets.
		/// </summary>
		public override bool Equals(object? obj) => obj is BoardDirection rhs && Equals(rhs);

		/// <summary>
		/// True if the two objects have the same offsets.
		/// </summary>
		public static bool operator ==(BoardDirection left, BoardDirection right) => left.Equals(right);

		/// <summary>
		/// True if the two objects have the same offsets.
		/// </summary>
		public static bool operator !=(BoardDirection left, BoardDirection right) => !left.Equals(right);

		/// <summary>
		/// Returns the hash code for this instance.
		/// </summary>
		public override int GetHashCode() {
			unchecked {
				return (RowOffset.GetHashCode() * 397) ^ ColumnOffset.GetHashCode();
			}
		}
		#endregion

		/// <summary>
		/// Reverses a BoardDirection so that it points in the opposite direction.
		/// </summary>
		public BoardDirection Reverse() => new BoardDirection((sbyte)-RowOffset, (sbyte)-ColumnOffset);

		/// <summary>
		/// Reverses a BoardDirection so that it points in the opposite direction.
		/// </summary>
		public static BoardDirection operator -(BoardDirection rhs) => rhs.Reverse();

		/// <summary>
		/// A sequence of 1-square movements in the eight cardinal directions: 
		/// north-west, north, north-east, west, east, south-west, south, south-east.
		/// </summary>
		public static IReadOnlyList<BoardDirection> CardinalDirections { get; } =
			[
				new BoardDirection(-1, -1),
				new BoardDirection(-1, 0),
				new BoardDirection(-1, 1),
				new BoardDirection(0, -1),
				new BoardDirection(0, 1),
				new BoardDirection(1, -1),
				new BoardDirection(1, 0),
				new BoardDirection(1, 1),
			];
	}
}
