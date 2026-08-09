# desiria-odata-pg 有償版境界 実装報告

作業日: 2026-08-09

追記: 同日、公開後の敵対的レビューで増分同期の軸が誤っていたため修正した。現行仕様は、編集検出の `__system/updatedAt` と新規検出の `__system/submissionDate` を併用する。詳細は `REPORT-fix.md` を正とする。

## 実装したもの

- `src/paid.js` を追加し、無料OSS側の `src/index.js` とは分離した。
- ODK Central セッション認証の入口 `createOdkSession()` を追加した。
  - `fetchImpl` 注入式のため、顧客環境で実行できる。
  - セッショントークンとパスワードをログ・例外に出さない秘匿処理を入れた。
- 増分同期URL生成 `buildIncrementalODataUrl()` を追加した。
  - `__system/updatedAt ge <ISO日時> or __system/submissionDate ge <ISO日時>` の `$filter` を生成する。
  - `submissionDate` 単独では編集済みsubmissionを取り逃がす。`updatedAt` 単独では `updatedAt` が空の新規submissionを取り逃がすため併用する。
  - 保存済み `nextLink` がある場合はそこから再開する。
- ページング完走 `fetchAllPaidPages()` を追加した。
  - `@odata.nextLink` を最後まで追う。
  - 重複URLと `maxPages` で無限ループを防ぐ。
- 有償同期dry-run `runPaidSyncDryRun()` を追加した。
  - 取得行、添付URL、差分レポート、チェックポイントSQL、最終状態SQLを返す。
- 状態保存SQL `buildPaidSyncStateSql()` を追加した。
  - `odk_paid_sync_state` に `last_updated_at` と `next_link` を保存する。
  - 旧 `last_submission_date` 列から `last_updated_at` へ非破壊でバックフィルするSQLを含む。
- 添付参照URL候補の保存SQL `buildAttachmentReferenceSql()` を追加した。
  - `odk_attachment_refs` に、OData上の既存URLまたはファイル名らしい値から組み立てた認証付きAPI参照URL候補を保存する。
  - 実ファイルのダウンロードは実装していない。
- 失敗通知dry-run `buildFailureNotificationPayload()` を追加した。
  - Webhook/メール向けのペイロードを生成する。
  - 実送信は実装していない。
- 差分レポート `buildDiffReport()` を追加した。
  - 今回同期分の `inserted` / `updated` / `total` を返す。
- README に無料と有償の境界表、自動化される手作業との対比を追記した。
  - 価格は未定。価格決定はCEO決裁事項のため、この実装報告では決めない。
  - 支払い導線は書いていない。

## テスト結果

実行コマンド:

```bash
npm test
```

初回実装時の結果:

- 13件 pass
- 0件 fail
- 既存7件 pass
- 新規6件 pass

修正後の結果:

- 14件 pass
- 0件 fail
- 編集済みsubmissionを2回目の増分同期で拾うテストを追加

追加修正後の結果:

- 18件 pass
- 0件 fail
- 旧state列からのマイグレーションSQL生成テストを追加
- `updatedAt` が `null` の新規submissionを `submissionDate` 条件で拾うテストを追加
- repeat table の増分同期で `$root/Submissions/` prefix を使うテストを追加

新規テストで確認したこと:

- ODK Central セッション認証は `fetchImpl` スタブで検証し、実サーバーに接続しない。
- `$filter` による増分URL生成と `nextLink` 再開ができる。
- `@odata.nextLink` を最終ページまで追う。
- 既存URLまたはファイル名らしい値から添付参照を抽出し、認証付きAPI参照URL候補の保存用SQLを生成する。
- 差分レポートで insert / update 件数を出す。
- 認証情報がログ・例外・生成SQL・通知dry-runペイロードに混入しない。
- 増分同期が `__system/updatedAt ge ... or __system/submissionDate ge ...` を使う。
- `submissionDate` が古いまま編集された同一 `__id` のsubmissionを次回同期で取得する。
- `updatedAt` が `null` の新規submissionを `submissionDate` 条件で取得対象にする。
- repeat table の増分同期では `$root/Submissions/` prefix を使う。

## 残っている未実装

- Paddle / Stripe Managed Payments の課金コード。
- Webhook / メールの実送信。
- 添付ファイル本体のダウンロードと外部ツール向け `/dl` URL生成。
- PostgreSQL へのSQL実行ラッパー。
- 顧客環境での定期実行テンプレート。
- Metabase / Superset / Power BI などBI接続テンプレート。

## 既知の制約

- 当社サーバー・当社DBは使わない。顧客が自分の環境で実行する前提。
- サポートは文書とコードで完結する。通話・訪問・個別対応はしない。
- 差分レポートの update 判定は、呼び出し側が渡す既存 `__id` 一覧に依存する。
- 添付ファイルは認証付きAPI参照URL候補の保存までで、ファイル内容の取得、保存、再試行、外部ツール向け `/dl` URL生成は範囲外。
- 失敗通知はdry-runペイロード生成までで、送信成功・失敗の管理は範囲外。

## 有償版が売れない理由

顧客が「自分の環境でNodeスクリプトとSQLを運用する」前提を重く感じる可能性があり、非エンジニア中心のODK利用組織には導入ハードルが高い。
