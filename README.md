# odk-central-pg-lite

ODK Central の OData JSON を PostgreSQL に冪等ロードするための SQL に変換する最小CLIです。

無料OSSの範囲は、ローカルでの JSON -> SQL 変換、カラム正規化、`__id` を主キーにした UPSERT、`@odata.nextLink` の同期状態SQL生成までです。有償版は、顧客自身の実行環境で ODK Central から認証付き取得を行い、増分同期の状態、添付URL、通知ペイロード、差分レポートを扱う境界です。

当社はこの製品のために新しいサーバーやDBを借りません。同期処理は顧客のPC、社内サーバー、既存CI、既存バッチ環境などで実行する前提です。

## Demo

```bash
npm test
npm run demo
```

出力されるSQLは次を含みます。

- `CREATE SCHEMA IF NOT EXISTS`
- OData の表に対応する `CREATE TABLE IF NOT EXISTS`
- `__id` 主キー
- `ON CONFLICT ("__id") DO UPDATE`
- `odk_sync_state` への `@odata.nextLink` 保存

## CLI

```bash
node src/cli.js test/fixtures/submissions.json --schema odk_stage --table bird_survey > load.sql
psql "$DATABASE_URL" -f load.sql
```

## Free / Paid Boundary

| 領域 | 無料OSS | 有償版 |
|---|---|---|
| OData JSON 変換 | 対応 | 対応 |
| 列名正規化 | 対応 | 対応 |
| `INSERT ... ON CONFLICT` | 対応 | 対応 |
| 状態SQL生成 | `odk_sync_state` への `nextLink` 保存 | `odk_paid_sync_state` への `last_submission_date` / `nextLink` 保存 |
| ODK Central 認証付き取得 | 範囲外 | セッション認証で取得。トークンはログ、例外、SQLに出さない |
| 増分同期 | 範囲外 | `$filter` の `__system/submissionDate` 以降、または保存済み `nextLink` から再開 |
| ページング | 1ファイル変換のみ | `@odata.nextLink` を最後まで追跡 |
| 添付ファイル | OData JSON 内の値として扱うのみ | 添付URLを `odk_attachment_refs` 用SQLとして保存。実ファイルのダウンロードは範囲外 |
| 失敗通知 | 範囲外 | Webhook/メール向けペイロード生成とdry-runのみ。送信はしない |
| 差分レポート | 範囲外 | 今回同期分の insert / update / total を出力 |
| ホスティング | なし | なし。当社サーバー・当社DBは使わない |
| 課金コード | なし | なし。Paddle / Stripe Managed Payments のMoR契約後に別途実装 |

有償版価格: 月額¥9,800 / 組織。

支払い導線はまだありません。Merchant of Record 契約前のため、README には購入リンクや課金コードを置いていません。

## 有償版で自動化されること

| 手作業 | 有償版 |
|---|---|
| ODK Central にログインして OData URL を取得する | `createOdkSession()` でセッション認証を行う |
| 前回どこまで同期したかをメモする | `odk_paid_sync_state` 用SQLで `last_submission_date` と `nextLink` を保存する |
| OData の次ページURLを手で追う | `fetchAllPaidPages()` が `@odata.nextLink` を完走する |
| 添付ファイルURLを各行から探す | `collectAttachmentReferences()` が添付URLを抽出し、保存用SQLを生成する |
| 失敗時に通知文面を手で作る | `buildFailureNotificationPayload()` がWebhook/メール向けdry-runペイロードを作る |
| 今回何件増えたかを目視確認する | `buildDiffReport()` が insert / update / total を返す |

有償版は `src/paid.js` に分離しています。HTTP処理は `fetchImpl` を注入する設計なので、CIでは実サーバーに接続せず fixture とスタブで検証できます。

## Kill Criteria

公開から6週間で有効化ユーザー10人、または有料1件。未達なら停止します。
