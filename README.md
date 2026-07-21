# ArcadeX — Next.js Frontend

A multi-game arcade shell for Unity WebGL games, built with Next.js + TypeScript + Firebase.

## Internal Guides

- UI guide: `docs/arcadex-ui-guide.md`
- Firebase optimization guide: `docs/arcadex-firebase-optimization-guide.md`

## File Structure

```
arcadex/
├── app/
│   ├── layout.tsx              # Root layout + global CSS import
│   ├── globals.css             # All styles (arcade dark theme)
│   ├── page/
│   │   └── page.tsx            # Home page → rename folder to root (app/page.tsx)
│   ├── game/
│   │   └── id/
│   │       └── page.tsx        # Game page → rename 'id' folder to '[id]'
│   └── admin/
│       └── page.tsx            # Admin portal
├── components/
│   ├── GameCard.tsx            # Card shown in the home grid
│   ├── GameClient.tsx          # Full-screen iframe + postMessage bridge
│   └── Leaderboard.tsx        # Bottom-sheet leaderboard
├── lib/
│   ├── firebase.ts             # All Firebase reads/writes (games + leaderboard)
│   └── bridge.ts               # sendToUnity() + UnityMessage types
└── types/
    └── index.ts                # Game + LeaderboardEntry TypeScript types
```

## Setup

### 1. Copy files into your existing repo

Drop these files into your `packages/react-app/` folder (or wherever your Next.js app lives).

**Important:** Rename these two folders after copying:
- `app/page/` → `app/` (i.e. `app/page.tsx` at root)
- `app/game/id/` → `app/game/[id]/`

### 2. Environment variables

Add to `.env.local`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

### 3. Firebase collections

The app expects two Firestore collections:

**`games`** (one document per game):
```json
{
  "name": "Arrow Out",
  "thumbnail": "https://...",
  "url": "https://arrowoutb1.trenchverse.com/index.html",
  "plays": "1.2m",
  "emoji": "🏹",
  "active": true,
  "createdAt": 1700000000000
}
```

**`games/{gameId}/leaderboard`** (subcollection, one doc per score):
```json
{
  "name": "PlayerName",
  "score": 98240,
  "walletAddress": "0x...",
  "createdAt": 1700000000000
}
```

### 4. Install dependencies

```bash
npm install firebase
```

### 5. Bridge integration

`GameClient.tsx` already handles:
- `MINIPAY_BOOTSTRAP` → sends snapshot to Unity
- `MINIPAY_GET_LEADERBOARD` → fetches from Firebase → `OnLeaderboardReceived`
- `MINIPAY_SUBMIT_SCORE` → writes to Firebase → `OnScoreSubmitted`

To add payments, copy your existing `MINIPAY_PURCHASE_GAME` / `MINIPAY_BUY_HINTS` handler
from `GameClient.tsx` in the Arrow Out repo into the switch statement in
`components/GameClient.tsx`.

## Admin Portal

Visit `/admin` to:
- Add a game (name + thumbnail URL + WebGL URL + plays label + emoji)
- Toggle games visible/hidden on the home page
- Delete games

No auth is set up — add a simple middleware or password check before production.

## Adding a New Game

1. Go to `/admin`
2. Paste the Unity WebGL URL (e.g. `https://yourgame.com/index.html`)
3. Add a thumbnail image URL and display name
4. Click **Add Game** — it appears instantly on the home page

Each Unity game only needs a `MiniPayBridge` GameObject that:
- Sends `MINIPAY_*` messages to `window.parent`
- Listens for `UNITY_CALLBACK` messages and calls the matching C# method
