#!/bin/bash
# 公開ゲート（絶対ルール25）を、失敗が黙って通らない形で実行する。
#
# ⚠️ 2026-08-11、buildチームがこう報告した:
#    「Codexの別プロセスREDTEAMは実行したが、ネットワーク到達性の問題で
#      レビュー本文が生成されていない」
#    最も重要な制御が黙って実行されなかった。人が報告を読んで気づいただけで、
#    仕組みは何も止めなかった。
#
# → このスクリプトは、レビューが「本当に走って、本当に中身のある出力を出した」
#   ことを検証し、そうでなければ非ゼロで落ちる。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="REVIEW-$(date +%Y%m%d-%H%M%S).md"
MIN_BYTES=800   # これ未満は「レビューされていない」とみなす

fail() { printf "\n\033[1;31m✗ 公開ゲート失敗: %s\033[0m\n" "$1"; exit 1; }

[ -f REDTEAM.md ] || fail "REDTEAM.md が無い。レビュー用プロンプトを置くこと"

printf "\033[1m── 敵対的レビューを実行\033[0m\n"
if ! codex exec --cd "$ROOT" --skip-git-repo-check -s read-only \
       -c tools.web_search=true -o "$OUT" - < REDTEAM.md; then
  fail "codex exec が非ゼロで終了した。レビューは行われていない"
fi

[ -f "$OUT" ] || fail "レビュー出力 $OUT が生成されていない。ネットワーク到達性を疑え"

SIZE=$(wc -c < "$OUT" | tr -d ' ')
[ "$SIZE" -ge "$MIN_BYTES" ] || fail "レビュー出力が $SIZE bytes しかない（下限 $MIN_BYTES）。中身が無い"

# レビューが所定の項目を出しているか。形式が崩れていれば、読んでいない可能性が高い。
for KEY in "ブロッカー" "崩れなかった"; do
  grep -q "$KEY" "$OUT" || fail "レビュー出力に「$KEY」の節が無い。指示どおりに実行されていない"
done

printf "\033[1m── 結果\033[0m\n"
if grep -qE "ブロッカー[^\n]{0,20}(無し|なし|無い)" "$OUT"; then
  printf "\033[1;32m✓ ブロッカー無しと報告された: %s (%s bytes)\033[0m\n" "$OUT" "$SIZE"
  printf "  ⚠️ 「無し」を鵜呑みにしない。指摘の節も読むこと。\n"
  printf "  ⚠️ 2026-08-11、1製品で5周とも新しい指摘が出た。1周で終わらせない。\n"
else
  printf "\033[1;33m▲ ブロッカーが報告されている可能性がある: %s (%s bytes)\033[0m\n" "$OUT" "$SIZE"
  printf "  読んで、直してから、もう一度このゲートを通すこと。\n"
  exit 2
fi
