# SW19 Oracle backend

Separate Cloudflare Worker and KV namespace for SW19 Oracle. It never reads
or writes Kickoff Oracle's KV data.

Scoring: exact set score 5; correct winner with a different set score 2; wrong
winner or no pick 0. Picks are checked and locked server-side at `startAt`.
Walkovers, retirements, cancellations and abandoned matches are void.

Run tests:

```bash
npm test
```
