# Environments

This is a plain Node.js command-line tool with **no dependencies**. It reads an ODK
Central-shaped submission export and writes SQL to standard output. It does not connect to
PostgreSQL — you pipe the SQL into `psql` yourself, or read it first and decide not to.
There is no server, no hosted component, and nothing is deployed anywhere.

That separation is deliberate: the tool never holds your database credentials, and you can
see exactly what would be executed before anything runs.

| Environment | What it is | Cost |
|---|---|---|
| **Local** | Your machine. Node 20 or newer (CI runs 22). `npm test` runs `node --test` against fixtures — it checks the generated SQL (identifiers, quoting, types, the incremental-sync predicate), not a live database. | none |
| **CI** | GitHub Actions on pushes and pull requests to `main`: the same suite, plus a check that the numbers quoted in the docs match what the tools actually print. | free on public repos |

There is no staging or production environment, because nothing here is served to anyone.

## Running it

```bash
npm test                          # the suite
npm run check                     # documented numbers vs. actual tool output
npm run demo                      # generate SQL from the bundled fixture
```

## What the tests do not cover

They do not execute the generated SQL against a real PostgreSQL server. If your column
names, types, or extensions differ from the fixtures, the SQL may still be rejected by your
database. **Read the output before you run it.**

## Credentials

The free path needs none: it reads a file you already have.

The paid path is a library function that talks to an ODK Central instance. You pass it the
credentials that instance requires — an account email and password, which it exchanges for
a session token. **It does not read environment variables or configuration files**: the
caller decides where the credentials come from. Passwords and tokens are redacted from its
debug output rather than logged.

## Before we publish a change

We run an adversarial review of the repository before pushing anything public. It runs on
our own machines and is not part of this package, so nothing here depends on it.

## What this project deliberately has no story for

- **Hosting.** Nobody runs this for you.
- **Your data.** It reads a local file and writes text to standard output. Nothing leaves
  your machine on the free path.
- **Migrations.** It emits `CREATE TABLE IF NOT EXISTS` for the table you name plus a small
  state table it uses to track incremental syncs (`odk_sync_state`; the paid path adds
  `odk_attachment_refs` and `odk_paid_sync_state`). It does not manage schema history, and
  it will not alter a table that already exists with different columns.
