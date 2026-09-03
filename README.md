# HTTP Runner

Run, test and monitor the `.http` files you already have.

Your existing REST Client files work unchanged. Nothing to migrate, nothing to rewrite.

![Send a request from the editor](https://raw.githubusercontent.com/GlobalMatchHub/httprunner/main/ext/media/01-send.png)

## You never write a test

Send a request once and the response becomes the baseline. From then on you are
told only what changed.

Comparison is by **structure, not value**. Ids that increment, tokens that rotate
and timestamps that move are all silent. You hear about it when a field
disappears, a type changes or a status code moves.

![What changed](https://raw.githubusercontent.com/GlobalMatchHub/httprunner/main/ext/media/04-changed.png)

That is the whole reason API tests get written and then deleted a week later:
false alarms. There are none here.

## Three places, one engine

**In the editor.** A `Send` action sits above every request. The response opens
beside it as a normal editor tab, so it is searchable and diffable.

![Response opens beside the request](https://raw.githubusercontent.com/GlobalMatchHub/httprunner/main/ext/media/02-response.png)

**In CI.** The same files become a regression suite.

```
npx @sellerkit/httprunner ./api --reporter junit --out reports/http.xml
```

Exits non-zero when something changed, so a pull request can be blocked.

**As a monitor, with no server to host.**

```
npx @sellerkit/httprunner init ./api --cron '*/30 * * * *'
```

This writes two GitHub Actions workflows. The scheduled one replays your
requests and opens an issue in your repository when a response stops matching.
No infrastructure, no third-party dashboard, no monthly platform bill.

## Everything you already use keeps working

- `# @name login`, and `{{login.response.body.$.token}}` to chain auth
- `{{$guid}}` `{{$timestamp}}` `{{$randomInt}}` `{{$processEnv}}` `{{$dotenv}}`
- `< ./payload.json` to load a body from disk
- `http-client.env.json` and `http-client.private.env.json`, the same shape
  IntelliJ uses, so a team can share one set of files across both editors
- `.env`

Add `# @expect status 201` or `# @expect body $.id exists` when you want to say
something explicitly.

## What costs money

**Sending one request stays free.** That is not going to change.

Running a whole file, recording and comparing responses, CI and monitoring are
the paid part. There is a 14 day trial.

Two promises, because plenty of tools have broken them:

1. **Nothing you already made gets locked.** When a trial or license ends, your
   `.http` files and everything under `__http__/` stay readable and usable.
2. **Our outage is not your outage.** If the license server cannot be reached,
   the run continues. Your build never fails because of us.

## Commands

| | |
|---|---|
| `--env <name>` | environment from `http-client.env.json` |
| `--update` | accept the current responses as the new baseline |
| `--assert shape\|exact\|off` | how to compare |
| `--only <text>` | run matching requests only |
| `--bail` | stop at the first failure |
| `--reporter pretty\|json\|junit` | |

The extension is 40 KB. It does not embed a browser, a desktop app or a sign-in.
