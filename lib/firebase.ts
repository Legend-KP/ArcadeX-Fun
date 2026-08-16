"use client";

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  orderBy,
  DocumentData,
} from "firebase/firestore";
import { Game } from "@/types";
import { sortGames } from "@/lib/games-sort";
import {
  assertFirebaseConfig,
  getFirebasePublicConfig,
} from "@/lib/firebase-config";

export {
  getLeaderboard,
  getUserBestScore,
  submitScore,
  savePersonalBest,
  submitPaidScore,
  fetchLeaderboardData,
} from "@/lib/leaderboard-client";

let app: FirebaseApp;
let db: Firestore;

function getFirebase() {
  const config = getFirebasePublicConfig();
  assertFirebaseConfig(config);

  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(config);
    db = getFirestore(app);
  }
  return { app, db };
}

// ─── Games (Firestore) ───────────────────────────────────────────────────────

export async function getGames(): Promise<Game[]> {
  const { db } = getFirebase();
  const mapDocs = (docs: { id: string; data: () => DocumentData }[]) =>
    docs.map((d) => ({ id: d.id, ...d.data() } as Game));

  try {
    const snap = await getDocs(
      query(collection(db, "games"), orderBy("createdAt", "desc"))
    );
    return sortGames(mapDocs(snap.docs));
  } catch {
    const snap = await getDocs(collection(db, "games"));
    return sortGames(mapDocs(snap.docs));
  }
}

export function isGameVisible(game: Game): boolean {
  return game.active !== false;
}

export async function getGame(id: string): Promise<Game | null> {
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, "games", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Game;
}
