# Environments

This is a plain Node.js CLI. It reads an ODK Central-shaped submission export and writes rows into a PostgreSQL database you point it at. There is no server, no database, no hosted component, and
nothing is deployed anywhere.

| Environment | What it is | Cost |
|---|---|---|
| **Local** | Your machine. Node 22+. `npm test` covers the transform and the incremental sync against a real PostgreSQL started by `embedded-postgres` (a real server binary; no Docker, no admin rights). | none |
| **CI** | GitHub Actions on every push: the test suite, plus a check that the numbers quoted in the docs match what the tools actually print. | free on public repos |

There is no staging or production environment, because nothing here is served to anyone.

## Running it

```bash
npm install
npm test                          # the suite
node scripts/check-claims.mjs     # documented numbers vs. actual tool output
```

## Before publishing a change

```bash
bash scripts/release.sh test      # tests + claim check
bash scripts/release.sh gate      # adversarial review; fails loudly if it doesn't run
```

`gate` exists because a review that silently doesn't happen is worse than no review: it
leaves you believing something was checked. It fails if the reviewer process errors, if it
produces no output, if the output is too short to be a real review, or if the expected
sections are missing.

## What this project deliberately has no story for

- **Hosting.** Nobody runs this for you. It connects to your database, from your machine.
- **Your data.** Nothing is sent anywhere except the PostgreSQL connection string you supply.
- **Secrets.** The one credential is your database URL. It is read from the environment and never written to disk or logged.
