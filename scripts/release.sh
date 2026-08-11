#!/bin/bash
# 公開前に走らせるもの。この製品はどこにもデプロイされないので、配信の段は無い。
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

case "${1:-}" in
  test) npm test; node scripts/check-claims.mjs ;;
  *)
    echo "使い方: release.sh test"
    echo "  test  テストと、文書に書いた数字の照合"
    echo
    echo "デプロイの段はありません。この製品は配信されないためです。"
    echo "公開前にはこのほかに敵対的レビューを行っていますが、その工程は"
    echo "私たちの手元のツールに依存するため、クローンからは実行できません。"
    exit 1 ;;
esac
