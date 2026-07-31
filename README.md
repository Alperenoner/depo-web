# DEPOLAMA — Truck Load Planner

A web app that calculates how to pack boxes into a truck trailer as efficiently as
possible, then shows the result in 2D (top view, side section) and 3D.

Built with **no frameworks** — no Express, no React, no bundler, no ORM. The only
runtime dependency is the Postgres driver. Every HTTP route, every pixel of the
canvas drawing and the entire placement engine is hand-written.

**[Live site](https://depo-test-deniz-zkbp.onrender.com)** · login required —
the app manages real load data, so it is not open to the public. The screenshots
below show the full interface.

> The codebase, UI and documentation are in Turkish — it was built for a Turkish
> logistics workflow. Turkish README: **[README.tr.md](README.tr.md)**

---

## What it does

You define a trailer and a set of box types, say how many of each you want to
ship, and the engine works out the arrangement — which box goes where, in which
orientation, in what loading order.

![3D view](docs/gorsel/uc-boyut.png)

*3D view — 1,112 boxes in 3 blocks, 94.8% volume fill. The numbered labels are the
loading order.*

![Top view](docs/gorsel/kusbakisi.png)

*Top view with a layer slider — drag it to see one layer at a time instead of the
whole stack.*

![Strategy comparison](docs/gorsel/karsilastirma.png)

*The same load computed under all three arrangement strategies, side by side, with
the best one marked.*

---

## The interesting part: blocks, not boxes

The naive approach places boxes one at a time. Packing 900,000 cigarette cartons
that way means 900,000 placement decisions.

This engine never places a box. It places **blocks** — an `nx × ny × nz` grid of
identical boxes in the same orientation. One block describes 900,000 boxes, so the
whole plan is computed in milliseconds and the 3D scene draws a handful of meshes
instead of a million.

The loop is:

1. Keep a list of free spaces, starting with the empty trailer.
2. For each box type, generate its distinct orientations — 6 permutations of
   `length × width × height`, deduplicated (a cube has 1, not 6), or just 2 if the
   box is marked *cannot be laid on its side*.
3. For every (space, orientation) pair, work out how many boxes fit as a grid, and
   score it — by volume filled or by box count, depending on strategy.
4. Place the best block, split the leftover space into new free spaces, discard
   slivers thinner than 1 mm, repeat.

Three strategies are exposed: **horizontal** (shortest edge up — more layers),
**vertical** (longest edge up), and **optimum**, which runs 9 orientation/scoring
combinations and keeps whichever seated the most boxes. All three are computed on
every change, so the comparison tab is free.

`motor/yerlesim.js` knows nothing about the screen. It takes `{trailer, boxes}` and
returns `{blocks}`. That is why the 2D and 3D views can never disagree — they are
two renderers over one result. The same file runs unmodified in the browser and in
Node, which is what makes the test suite possible.

---

## Design decisions worth explaining

**No framework, one dependency.** `package.json` lists exactly one runtime
dependency: `pg`. The HTTP router in `sunucu/server.js` is a chain of
`if (path === ... && method === ...)` checks — 589 lines covering static files,
sessions, and 11 API endpoints. For an app this size a framework would have added
more concepts than it removed.

**Plans store the recipe, not the result.** A saved plan records *which trailer,
which boxes, how many, which strategy* — never the computed positions. Loading a
plan recalculates it. So when the engine improves, every plan saved last year gets
the better answer for free.

**Two units, on purpose.** Boxes are entered in millimetres, trailers in
centimetres. That is how the people using it already think about the two things;
forcing one unit would have meant fighting the habit.

**Nothing is pre-seeded.** The trailer and box tables start empty. No stock
"14 m trailer", no factory box sizes. Every measurement in the system was entered
by someone who verified it.

**Security.** Passwords are scrypt hashes (N=16384, r=8, p=1) with per-user salt —
plaintext is never stored or logged. Sessions are random tokens kept in Postgres so
a redeploy does not sign everyone out, delivered as HttpOnly cookies. Eight failed
logins from one IP triggers a 10-minute lockout. TLS to the database verifies the
certificate (`sslmode=verify-full`, no `rejectUnauthorized: false`).

---

## Layout

```
motor/yerlesim.js      844 lines   the placement engine — browser + Node, no DOM
sunucu/                1,862       HTTP router, validation, security, Postgres
  server.js              589       routing, static files, 11 API endpoints
  guvenlik.js                      scrypt, sessions, brute-force lockout
  veritabani/sema.sql              schema, idempotent (safe to re-run)
public/                5,344       the interface
  uygulama.js          2,009       state, forms, live recalculation
  3boyut.js              993       three.js scene, 4 camera modes, load animation
  cizim.js               523       2D canvas — top view and side section
testler/               1,307       82 tests, node:test, no test framework
```

## Running it

```bash
npm install
cp .env.ornek .env        # fill in DATABASE_URL and SESSION_SECRET
npm run db:kur            # create schema + first account
npm start                 # http://localhost:5180
```

```bash
npm test                  # 82 tests
npm run db:dene           # check the database connection
npm run db:kullanici -- liste
```

Requires Node 18+ and a Postgres database. Runs on [Neon](https://neon.tech)
(Postgres 18, Frankfurt) and deploys to [Render](https://render.com) via
`render.yaml`.

---

## Status

Complete and in production. 82 tests passing. Built over two days in July 2026.
