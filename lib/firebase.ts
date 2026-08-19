"use client";

/**
 * Browser Firebase surface. Catalog, scores, and progress go through
 * `/api/games/*` — this module must not import firebase/firestore.
 */
export {
  getLeaderboard,
  getUserBestScore,
  submitScore,
  savePersonalBest,
  submitPaidScore,
  fetchLeaderboardData,
} from "@/lib/leaderboard-client";
