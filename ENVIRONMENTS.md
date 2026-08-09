# 環境（費用0円で成立させる）

| 環境 | 実体 | 用途 | 費用 |
|---|---|---|---|
| **開発 (dev)** | ローカル。DBは `embedded-postgres`（**本物のPostgreSQLバイナリ。Dockerも管理者権限も不要**） | 実装と単体・結合テスト | 0円 |
| **試験 (staging)** | **Vercel のプレビューデプロイ**（コミットごとに固有URL） | 本番相当の配信で実測 | 0円 |
| **本番 (prod)** | Vercel の production alias（`byrdhq.com`） | 公開 | 0円 |
| **CI** | GitHub Actions（**公開リポジトリは無料**） | pushごとにテストと文書照合 | 0円 |

⚠️ **既知の制約**: Vercelのプレビューは Deployment Protection により匿名アクセスが302になる（2026-08-09に実測）。
**試験環境で匿名の実測が必要な場合は、本番の別サブドメインを使うか、保護の解除をオーナー決裁で行う。**

## 手順（飛ばせない順番）

```bash
bash scripts/release.sh test      # ① テスト ② 文書の数字と実測の照合
bash scripts/release.sh gate      # ③ 敵対的レビュー（絶対ルール25）
bash scripts/release.sh staging   # ④ 試験環境へ
bash scripts/release.sh prod      # ⑤ 本番へ ⑥ 公開URLで実測
```

**`gate` を飛ばした本番デプロイは規約違反。** 2026-08-09に実際に飛ばし、実装バグ1件と商標違反3件を公開した。

## テストの原則

- **「動いたはず」で完了にしない。** 公開後は必ず公開URLに対して実測する
- **文書に数字を書いたら、その場でコマンドを実行して照合する**（`scripts/check-claims.mjs` がCIで強制する）
- **外部サービスに繋がるコードは、fixtureとスタブで検証する**（CIで動くこと）
- **認証情報が漏れないことを検証するテストを必ず1件入れる**
