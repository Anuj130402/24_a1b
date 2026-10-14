# Conventions

One page. Read it once, follow it for ten days.

## Ports

| Service | Port |
|---|---|
| web (Vite) | 5173 |
| api (Express) | 3001 |
| PostgreSQL | 5432 |
| MongoDB | 27017 |

## Branches

- One branch per person: `m1-browse`, `m2-transaction`, `m3-analytics`, `m4-mongo`
- Nobody pushes to `main`. Every merge is a PR reviewed by one other person.
- **Pull `main` into your branch every morning.** A ten-line conflict daily is
  nothing; a four-hundred-line conflict on 13 Oct costs the team a day.
- Push at least once a day even if the work is incomplete.

PR review is not ceremony. The viva examiner can ask any member about any part,
including the inherited A1 database code, so reviewing someone else's slice is how
you learn it.

## File ownership — do not edit a file you do not own

```
api/app.js, api/db.js, api/middleware/   → M1
api/routes/browse.js                     → M1
api/routes/transactions.js               → M2
api/routes/analytics.js                  → M3
api/routes/mongo.js, api/pipelines/      → M4

web/src/routes.jsx                       → M1 (written once, in Phase 1)
web/src/components/, web/src/styles/     → M1
web/src/lib/                             → M1
web/src/pages/Browse/                    → M1
web/src/pages/Transaction/, Audit/       → M2
web/src/pages/Analytics/                 → M3
web/src/pages/Map/, Reviews/             → M4

sql/01–06, mongo/01–03                   → nobody. These are the inherited A1
                                           files. Never edit in place.
sql/07_a2_additions.sql                  → M2 (procedure, columns) + M1 (indexes)
mongo/04_a2_additions.js                 → M4
data_generation/postgres_seeder.py       → M1
data_generation/mongo_seeder.py          → M4
```

All A2 database changes go in the `07_` and `04_` files so the README can document
exactly what we changed. A reviewer should be able to see our work as a clean diff
against the inherited submission.

## Starting a screen

```bash
cp -r web/src/pages/_TEMPLATE web/src/pages/YourScreen
```

The template already handles loading, empty and error. Keep all three branches —
the brief marks "no blank pages" under Front-End Quality. If a state cannot happen
on your screen, leave the branch in with a comment saying why.

## Starting a route

```bash
cp api/routes/_TEMPLATE.js api/routes/yours.js
```

Three patterns in there: paginated list, detail, stored-procedure call. Keep the
list response shape (`{ data, page, limit, total }`) identical everywhere so the
shared table component works on every screen.

## The one styling rule

**If you need a colour or a spacing value and it is not in `web/src/styles/tokens.css`,
ask in the group chat. Do not invent one.**

That single rule is what makes four people's screens look like one application.
Design is worth 15 marks and the brief says consistency matters more than
sophistication.

Specifics:

- Compose from `web/src/components`. Need a variant? Add a prop there, don't
  restyle in your page folder.
- Any cell holding money, a count or a distance gets `numeric: true` (tables) or
  the `.num` class. Tabular figures keep digits aligned down a column.
- Appointment status always renders through `<StatusBadge>`, never as raw text.
- Wrap wide tables and charts in `.scroll-x` so the page body never scrolls
  sideways on a phone.
- Don't remove the `:focus-visible` outline.

## Writing interface copy

- Name things as a user understands them, not as the database does. "Appointments",
  not "appointment records".
- Buttons say what happens: "Book appointment", not "Submit".
- An empty state says what would appear here and how to make it appear. Not
  "No data found".
- An error says what went wrong and what to do next. It does not apologise and it
  never shows a stack trace.
- Sentence case everywhere. No ALL-CAPS labels.

## The API contract is frozen

`docs/api_endpoints.md` is the agreement between four people working in parallel.
If you need a shape changed, say so in the group chat and **update the document
first, write the code second**. This is the one discipline that keeps us from
drifting apart.

## Everyone runs their own database

`docker compose up`. Nobody shares an instance. Both seeders are deterministic
after our Phase 1 fix, so we all hold identical rows and screenshots match.

## Known traps from the inherited repo

Hit during the A1 evaluation — see `docs/handover_note.md` for detail.

1. Their README's setup sequence omits `04_stored_procedures.sql`. Run it, or
   Workflow 1 will not exist.
2. The seeder's `verify()` stalls on check 8 (missing index on
   `wallet_audit_logs.patient_id`). Safe to interrupt — the data is already
   committed by then.
3. Run `pip install --upgrade pip setuptools wheel` before installing
   `requirements.txt`, or `psycopg2-binary` will try to compile from source.
4. `mongo_seeder.py` writes naive local timestamps. Until Phase 1 fixes it, ping
   timestamps are offset by your UTC offset and the TTL fires at the wrong time.

## Formatting

Prettier and ESLint are committed. Let them run on save. Don't reformat a file you
don't own — a formatter diff of 200 lines hides the 3 that matter.
