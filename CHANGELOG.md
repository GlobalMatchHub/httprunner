# Changelog

## 0.1.0

First release.

- Send a single request from the editor, response opens beside it
- Run every request in a file, in order, carrying named results forward
- Responses are recorded on first run and compared by structure afterwards
- `# @expect` for explicit checks on status, body and headers
- JUnit, JSON and terminal reports, non-zero exit on change
- `httprunner init` writes GitHub Actions workflows for CI and scheduled monitoring
- Reads `http-client.env.json`, `http-client.private.env.json` and `.env`
