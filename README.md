# desiria-odata-pg

This project is not created, endorsed by, or affiliated with ODK. ODK and ODK Central are trademarks of their respective owners. Desiria LLC is an independent third party.

Built by an AI agent operating on behalf of Desiria LLC. We say so up front because some organisations restrict AI-assisted work.

ODK Central の OData JSON を PostgreSQL に冪等ロードするための SQL に変換する最小CLIです。
ODK Central と OData の仕様は ODK 公式Docsを参照してください: https://docs.getodk.org/central-api-odata-endpoints/

無料OSSの範囲は、ローカルでの JSON -> SQL 変換、カラム正規化、`__id` を主キーにした UPSERT、`@odata.nextLink` の同期状態SQL生成までです。有償版は、顧客自身の実行環境で ODK Central から認証付き取得を行い、増分同期の状態、添付参照URL候補、通知ペイロード、差分レポートを扱う境界です。

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
node src/cli.js test/fixtures/submissions.json --schema submissions_stage --table bird_survey > load.sql
psql "$DATABASE_URL" -f load.sql
```

## Free / Paid Boundary

| 領域 | 無料OSS | 有償版 |
|---|---|---|
| OData JSON 変換 | 対応 | 対応 |
| 列名正規化 | 対応 | 対応 |
| `INSERT ... ON CONFLICT` | 対応 | 対応 |
| 状態SQL生成 | `odk_sync_state` への `nextLink` 保存 | `odk_paid_sync_state` への単一checkpoint `last_updated_at` と `nextLink` の保存。旧 `last_submission_date` 列からの非破壊バックフィルSQLを含む |
| ODK Central 認証付き取得 | 範囲外 | `/v1/sessions` のセッション認証で取得。トークンはログ、例外、SQLに出さない |
| 増分同期 | 範囲外 | `$filter` の `__system/updatedAt ge last_updated_at or __system/submissionDate ge last_updated_at` 以降、または保存済み `nextLink` から再開 |
| ページング | 1ファイル変換のみ | `@odata.nextLink` を最後まで追跡 |
| 添付ファイル | OData JSON 内の値として扱うのみ | OData 上の既存URL、またはファイル名らしい値から組み立てた認証付きAPI参照URL候補 `/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}` を `odk_attachment_refs` 用SQLとして保存。実ファイルのダウンロードと外部ツール向け `/dl` URL生成は範囲外 |
| 失敗通知 | 範囲外 | Webhook/メール向けペイロード生成とdry-runのみ。送信はしない |
| 差分レポート | 範囲外 | 今回同期分の insert / update / total を出力 |
| ホスティング | なし | なし。当社サーバー・当社DBは使わない |
| 課金コード | なし | なし。Paddle / Stripe Managed Payments のMoR契約後に別途実装 |

有償版価格は未定です。価格決定はCEO決裁事項です。Merchant of Record 契約前のため、README には購入リンクや課金コードを置いていません。

## 有償版で自動化されること

| 手作業 | 有償版 |
|---|---|
| ODK Central にログインして OData URL を取得する | `createOdkSession()` でセッション認証を行う |
| 前回どこまで同期したかをメモする | `odk_paid_sync_state` 用SQLで単一checkpointの `last_updated_at` と `nextLink` を保存する |
| OData の次ページURLを手で追う | `fetchAllPaidPages()` が `@odata.nextLink` を完走する |
| 添付ファイルURLを各行から探す | `collectAttachmentReferences()` が OData 上の既存URLまたはファイル名らしい値から認証付きAPI参照URL候補を組み立て、保存用SQLを生成する |
| 失敗時に通知文面を手で作る | `buildFailureNotificationPayload()` がWebhook/メール向けdry-runペイロードを作る |
| 今回何件増えたかを目視確認する | `buildDiffReport()` が insert / update / total を返す |

有償版は `src/paid.js` に分離しています。HTTP処理は `fetchImpl` を注入する設計なので、CIでは実サーバーに接続せず fixture とスタブで検証できます。

## 制約

OIDC SSO が有効な ODK Central 環境では、ODK Central 側で HTTP Basic 認証と `POST /v1/sessions` ログインが無効になります。この製品の有償版取得処理は現時点で `/v1/sessions` のセッション認証のみを実装しているため、OIDC SSO 有効環境では動作対象外です。

増分同期は ODK Central の `__system/updatedAt` と `__system/submissionDate` を同じ単一checkpoint `last_updated_at` に対して照合します。`updatedAt` は初回作成時に空になり得るため、新規submissionは `submissionDate`、編集済みsubmissionは `updatedAt` で拾います。取り込んだ行ごとに `updatedAt` があれば `updatedAt`、空なら `submissionDate` を候補にし、その最大値を `last_updated_at` に保存します。次回は `ge` で再取得します。同一時刻の境界行は二重取得される可能性がありますが、`__id` 主キーの UPSERT により冪等です。

repeat table の増分同期では、ODK OData の仕様に合わせて root submission metadata を `$root/Submissions/__system/...` で参照します。

削除済みsubmissionの反映は未実装です。ODK Central の `__system/deletedAt` は現時点で同期条件にも状態計算にも含めていません。

以前の有償境界コードで `odk_paid_sync_state.last_submission_date` を作った環境向けに、`buildPaidSyncStateMigrationSql()` と `buildPaidSyncStateSql()` は `last_updated_at` を追加し、旧列が存在する場合は値をバックフィルします。旧列は削除しません。

添付ファイル判定は OData メタデータを読まず、既存URLと一般的な添付ファイル拡張子に見える文字列を対象にします。生成するのは ODK Central の認証付きAPI参照URL候補であり、外部ツール向けの `/dl` URLではありません。メディア型フィールドの厳密判定は未実装です。

## Kill Criteria

公開から6週間で有効化ユーザー10人、または有料1件。未達なら停止します。
