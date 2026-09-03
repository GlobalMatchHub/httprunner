# Changelog

## 0.3.0

- `--docs <file>` writes a Markdown API reference generated from the requests
  and the responses that were recorded, so the document cannot drift away from
  the API
- Secrets are redacted before anything is written: auth headers, key-shaped
  header names, bearer-shaped values, and JSON fields named like credentials
- The generated monitor workflow keeps `API.md` current alongside the badge

## 0.2.0

- `--badge <file>` writes a shields.io endpoint document describing the last run
- The generated monitor workflow keeps `.http-status.json` up to date in your
  repository, so a README badge can show whether your API still matches what
  was recorded

## 0.1.0

First release.

- Send a single request from the editor, response opens beside it
- Run every request in a file, in order, carrying named results forward
- Responses are recorded on first run and compared by structure afterwards
- `# @expect` for explicit checks on status, body and headers
- JUnit, JSON and terminal reports, non-zero exit on change
- `httprunner init` writes GitHub Actions workflows for CI and scheduled monitoring
- Reads `http-client.env.json`, `http-client.private.env.json` and `.env`
