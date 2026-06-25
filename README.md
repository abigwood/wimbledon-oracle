# Wimbledon Oracle

A separate Wimbledon 2026 set-score predictor inspired by Kickoff Oracle. It does not modify or replace the World Cup app.

## Prediction scope

- 29–30 June, first round: three featured gentlemen's and three featured ladies' matches per day.
- 1–2 July, second round: three featured gentlemen's and three featured ladies' matches per day.
- From the last 32 on 3 July: every gentlemen's and ladies' singles match.
- Gentlemen: predict 3–0, 3–1 or 3–2 to either player.
- Ladies: predict 2–0 or 2–1 to either player.
- Scoring: exact set score 5 points; correct winner with the wrong set score 2; otherwise 0.

## Public architecture

- Static PWA: GitHub Pages at `https://abigwood.github.io/wimbledon-oracle/`
- Shared leagues: separate Cloudflare Worker and KV namespace
- Official data: `scripts/sync_official.py` reads Wimbledon's public
  order-of-play/results service every five minutes through GitHub Actions
- Cost: GitHub Pages/Actions public-repository allowance plus Cloudflare Free;
  no paid API key or chargeable fallback

The app deliberately stays draw-pending until official singles matches are
released. It never invents players. Each production fixture has this shape:

```json
{
  "id": "2026-06-29-men-1",
  "date": "2026-06-29",
  "startAt": "2026-06-29T12:30:00Z",
  "lockAt": null,
  "court": "Centre Court",
  "round": "First round",
  "tour": "men",
  "coverage": "featured",
  "player1": "Player One",
  "player2": "Player Two",
  "seed1": 1,
  "seed2": null,
  "status": "upcoming",
  "result": null,
  "officialDay": 8,
  "officialMatchId": "12345"
}
```

For matches listed as "followed by" without an exact start time, the Worker
checks the official Wimbledon match status before every pick. If that check
cannot be completed, it fails closed and does not save the pick.

Walkovers, retirements, cancellations and abandoned matches are void.

## Run

```bash
python3 server.py
```

Open `http://127.0.0.1:8899/`.

## Test

```bash
python3 -m unittest -v test_app.py
node --check app.js
cd worker && npm test
```

Official sources:

- <https://www.wimbledon.com/en_GB/scores/schedule>
- <https://www.wimbledon.com/en_GB/scores/results>
