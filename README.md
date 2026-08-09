# odk-central-pg-lite

ODK Central の OData JSON を PostgreSQL に冪等ロードするための SQL に変換する最小CLIです。

無料OSSの範囲は、ローカルでの JSON -> SQL 変換、カラム正規化、`__id` を主キーにした UPSERT、`@odata.nextLink` の同期状態SQL生成までです。ODK Central の認証情報、定期実行、通知、GUI、失敗時の差分再実行は有償版の境界に置きます。

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

無料OSS:

- OData JSON ファイルから SQL を生成
- ODK の `__system/...` と通常フィールド名を PostgreSQL 向けに正規化
- `__id` による冪等UPSERT
- 同期状態テーブル用SQL
- サンプルデータとテスト

有償版:

- ODK Central からの認証付き取得
- `$filter` / `$skiptoken` による増分同期の自動化
- cron不要のホスト型スケジューラ
- 失敗通知、再試行、差分レポート
- Metabase/Superset/Power BI 用の接続テンプレート

## Kill Criteria

公開から6週間で有効化ユーザー10人、または有料1件。未達なら停止します。
