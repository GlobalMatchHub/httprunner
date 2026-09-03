#!/usr/bin/env bash
# Assemble the VS Code extension. The engine lives in src/ and is the same code
# the CLI and CI run, so it is copied in rather than duplicated.
set -euo pipefail
cd "$(dirname "$0")"

rm -rf ext/core
mkdir -p ext/core
for f in parse.js vars.js run.js snapshot.js report.js license.js init.js; do
  cp "src/$f" "ext/core/$f"
done
cp LICENSE ext/LICENSE 2>/dev/null || true
# ext/README.md is the marketplace listing and is written in English on purpose:
# the audience is the 7.5M people using REST Client, and they do not read Korean.
# The Korean README at the repository root is for us.

node -e "
const p=require('./ext/package.json');
if(!p.activationEvents || !p.activationEvents.length) { console.error('activationEvents 가 비었습니다'); process.exit(1); }
if(!p.main) { console.error('main 이 없습니다'); process.exit(1); }
console.log('  ' + p.displayName + ' ' + p.version + ' / ' + p.publisher);
"
echo "  ext/core 로 코어 $(ls ext/core | wc -l | tr -d ' ') 개 복사"
echo "빌드 완료. 패키징: cd ext && npx @vscode/vsce package"
