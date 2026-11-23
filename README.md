# Customer Experience Library

An internal library of why JET customers stop ordering, the hypotheses proposed to tackle each reason, the impact sizing, and the technical necessities to build them.

## The experience flywheel

Every churn reason maps to one of six drivers on the JET experience flywheel, grouped around the Trigger -> Session -> Order cycle: 1 Off-platform incentives (pre-session), 2 Supply, 3 App experience, 4 Price and discounts (in session), 5 Delivery, 6 Customer & partner service (post-order). The front page shows the wheel with live counts; clicking a driver filters the library and reveals its sub-drivers (per the JET driver breakdown: Marketing, Vouchers, Fees, Absolute delivery time, ...), each of which can have a deeper layer (e.g. Fees -> Delivery Fee, Service Fee, Minimum Order Fee).

## How it works

- Members submit hypotheses in the format: *If we [do X], then [metric] will [move] for [segment], because [mechanism]*
- On submission two automatic screenings run:
  - **Overlap** — near-duplicate detection against published and pending hypotheses, with links to the similar entries
  - **Validity** — a 0–100 score on structure, measurability, falsifiability, actionability and non-circular reasoning, with fix-it notes
- Owners review the queue and accept, reject (with feedback) or merge duplicates. Accepted entries are published to the library. The checks flag — owners decide.

## Running locally

```
npm install
DATABASE_URL=postgres://… npm start   # listens on $PORT or 8080
```

## Layout

- `server.js` — Express entry point
- `lib/routes.js` — pages and actions
- `lib/checks.js` — the overlap and validity engines (pure functions, tested in `test/checks.test.js`)
- `lib/auth.js` — accounts, Postgres-backed sessions, roles
- `migrations/001_init.sql` — schema (applied to the managed database with `db migrate`)
- `seed/` — clearly-labelled example content; `seed/generate-sql.js` computes its check results with the real engine

## Sign-in

Opening the app from the Toqan Apps section signs you in automatically: the platform injects your Toqan account id (`x-forwarded-user`), which the app uses to find or create your account — no registration. The first person to open the app becomes the owner. Email/password sign-in remains only as a fallback for accounts created before automatic sign-in; those link themselves to the Toqan account with the same email on first open. If Toqan's token does not carry a name, the account gets a "Set your name" chip linking to a one-time profile page.
