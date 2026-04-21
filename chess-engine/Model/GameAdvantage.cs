using System;
using System.Collections.Generic;
using System.Text;

namespace Cecs475.BoardGames.Chess.Model {
	/// <summary>
	/// Represents an advantage in a board game, indicating which player is currently "winning", or, 
	/// if the game is finished, which player has won the game.
	/// </summary>
	public readonly struct GameAdvantage : IEquatable<GameAdvantage> {
		/// <summary>
		/// Which player is winning / has won.
		/// </summary>
		public int Player { get; }
		/// <summary>
		/// A game-specific amount indicating "how much" the player is winning / has won by.
		/// </summary>
		public int Advantage { get; }

		/// <summary>
		/// Constructs a game advantage in favor of the given player.
		/// </summary>
		public GameAdvantage(int player, int advantage) {
			Player = player;
			Advantage = advantage;
		}

		/// <summary>
		/// Two objects are equal if they are the same player with the same advantage.
		/// </summary>
		public bool Equals(GameAdvantage other) => Player == other.Player && Advantage == other.Advantage;

		/// <summary>
		/// Two objects are equal if they are the same player with the same advantage.
		/// </summary>
		public override bool Equals(object? obj) => obj is GameAdvantage rhs && Equals(rhs);

		/// <summary>
		/// Get the hash code of the instance.
		/// </summary>
		public override int GetHashCode() {
			unchecked {
				return (Player * 397) ^ Advantage;
			}
		}

		/// <summary>
		/// Two objects are equal if they are the same player with the same advantage.
		/// </summary>
		public static bool operator ==(GameAdvantage left, GameAdvantage right) =>
			left.Equals(right);

		/// <summary>
		/// Two objects are equal if they are the same player with the same advantage.
		/// </summary>
		public static bool operator !=(GameAdvantage left, GameAdvantage right) =>
			!left.Equals(right);
	
	}
}
