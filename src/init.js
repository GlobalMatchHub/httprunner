'use strict';
const fs = require('fs');
const path = require('path');

// Monitoring without a server. Postman Monitors and Checkly sell this by the
// month; the same job runs for free inside the user's own repository, and the
// alert lands where they already look: a GitHub issue.

function ciWorkflow({ dir, env }) {
  return `name: API tests

on:
  push:
  pull_request:

jobs:
  http:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx @sellerkit/httprunner ${dir} ${env ? `--env ${env} ` : ''}--reporter junit --out reports/http.xml
        env:
          HTTPRUNNER_KEY: \${{ secrets.HTTPRUNNER_KEY }}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: http-report
          path: reports/http.xml
`;
}

function monitorWorkflow({ dir, env, cron }) {
  return `name: API monitor

on:
  schedule:
    - cron: '${cron}'
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - id: run
        continue-on-error: true
        run: npx @sellerkit/httprunner ${dir} ${env ? `--env ${env} ` : ''}--reporter pretty --out reports/monitor.txt
        env:
          HTTPRUNNER_KEY: \${{ secrets.HTTPRUNNER_KEY }}

      - name: Open an issue when the API changed
        if: steps.run.outcome == 'failure'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('reports/monitor.txt', 'utf8');
            const title = 'API monitor: response changed';
            const open = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo,
              state: 'open', labels: 'api-monitor',
            });
            const text = ['The monitored requests no longer match the recorded responses.',
              '', '\`\`\`', body.slice(0, 60000), '\`\`\`',
              '', 'Run \`npx @sellerkit/httprunner ${dir} --update\` to accept the new responses.'].join('\\n');
            if (open.data.length) {
              await github.rest.issues.createComment({
                owner: context.repo.owner, repo: context.repo.repo,
                issue_number: open.data[0].number, body: text,
              });
            } else {
              await github.rest.issues.create({
                owner: context.repo.owner, repo: context.repo.repo,
                title, body: text, labels: ['api-monitor'],
              });
            }

      - name: Fail the run so the badge turns red
        if: steps.run.outcome == 'failure'
        run: exit 1
`;
}

function init(cwd, opts = {}) {
  const dir = opts.dir || '.';
  const written = [];
  const wf = path.join(cwd, '.github', 'workflows');
  fs.mkdirSync(wf, { recursive: true });

  const targets = [
    ['http-tests.yml', ciWorkflow({ dir, env: opts.env })],
    ['http-monitor.yml', monitorWorkflow({ dir, env: opts.monitorEnv || opts.env, cron: opts.cron || '*/30 * * * *' })],
  ];
  for (const [name, body] of targets) {
    const p = path.join(wf, name);
    if (fs.existsSync(p) && !opts.force) { written.push([name, 'skipped, already there']); continue; }
    fs.writeFileSync(p, body);
    written.push([name, 'created']);
  }
  return written;
}

module.exports = { init, ciWorkflow, monitorWorkflow };
