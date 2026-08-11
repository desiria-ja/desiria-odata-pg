#!/bin/bash
# 開発 → 試験 → 本番。ゲートを飛ばせない形にする（絶対ルール25）
set -euo pipefail
STAGE="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf "\n\033[1m── %s\033[0m\n" "$1"; }

case "$STAGE" in
  test)
    step "① テスト"; npm test
    step "② 文書の数字と実測の照合"; node scripts/check-claims.mjs
    ;;
  gate)
    step "③ 敵対的レビュー（絶対ルール25。飛ばせない・黙って通らない）"
    bash "$ROOT/scripts/gate.sh"
    ;;
  staging)
    bash "$0" test
    step "④ 試験環境へデプロイ"
    vercel deploy 2>&1 | tail -3
    echo "→ 試験URLで実測してから prod へ"
    ;;
  prod)
    bash "$0" test
    if ! ls REVIEW-*.md >/dev/null 2>&1; then
      echo "✗ REVIEW-*.md が無い。公開ゲート（release.sh gate）を通していない。"
      echo "  2026-08-09、ゲートを飛ばして5件を公開し、実装バグ1件と商標違反3件を出した。"
      exit 1
    fi
    step "⑤ 本番へデプロイ"
    vercel deploy --prod 2>&1 | grep -iE "Production|Aliased|error"
    step "⑥ 公開URLでの実測（「デプロイした」で終わらせない）"
    ;;
  *)
    echo "使い方: bash scripts/release.sh [test|gate|staging|prod]"
    echo "  順番: test → gate → staging → prod。gateを飛ばした本番デプロイは規約違反"
    exit 1
    ;;
esac
