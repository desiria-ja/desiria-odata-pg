# Line C Fix Report

## 修正した内容

- 増分同期の基準を `__system/submissionDate` 単独から `__system/updatedAt` と `__system/submissionDate` の併用に変更した。
  - ODK Docs では `submissionDate` は `createdAt`、`updatedAt` は `__system/updatedAt` とされているため、編集済み submission を拾うには `updatedAt` が必要。
  - ODK Docs では Submission の `updatedAt` は初回作成時 `null` と説明されているため、新規 submission を拾うには `submissionDate` も必要。
  - 次回同期用 checkpoint は、取り込んだ行の最大 `updatedAt`、または `updatedAt` が空の行では `submissionDate` を `last_updated_at` として保存する。
  - フィルタは `__system/updatedAt ge ... or __system/submissionDate ge ...` を使う。境界行は二重取得され得るが、`__id` 主キーの UPSERT で冪等に処理できる。`gt` は同一タイムスタンプ精度の更新を取りこぼす可能性があるため使わない。
  - repeat table では ODK Docs の記載に合わせ、`$root/Submissions/__system/updatedAt ... or $root/Submissions/__system/submissionDate ...` を使う。

- ページごとの checkpoint SQL を累積最大 `updatedAt` で保存するよう修正した。
  - 後続ページの最大 `updatedAt` が前ページより古い場合でも、状態が巻き戻らない。

- 添付の扱いを README と実装で揃えた。
  - OData feed 上のメディア値は、ODK Docs 上でファイル名として見える説明とメディアURLとして扱う説明が併存しているため、実装は既存URLを保存し、ファイル名らしい値は `baseUrl`、`projectId`、`formId`、`__id`、`filename` から `/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}` を組み立てる。
  - 実ファイルのダウンロードは引き続き範囲外。

- README に OIDC SSO 環境の制約を明記した。
  - 現実装は `/v1/sessions` のセッション認証のみ。
  - OIDC SSO が有効な ODK Central では Basic 認証と `POST /v1/sessions` が使えないため、動作対象外と明記した。

- 商標・非提携表示を修正した。
  - `package.json` の `name` を `desiria-odata-pg` に変更した。
  - `package.json` の `bin` と CLI Usage に残っていた旧名 `odk-central-pg-lite` を `desiria-odata-pg` に変更した。
  - README 冒頭に非提携表示を追加した。

- AI開示を README 冒頭に追加した。
  - `Built by an AI agent operating on behalf of Desiria LLC. We say so up front because some organisations restrict AI-assisted work.`

- 旧state名からのマイグレーションSQLを追加した。
  - `buildPaidSyncStateMigrationSql()` は `odk_paid_sync_state.last_updated_at`、`next_link`、`page_count`、`updated_at` を追加し、旧 `last_submission_date` 列が存在する場合は `last_updated_at` が空の行だけバックフィルする。
  - 旧列は削除しない。既存DBの情報を破壊せず、次回同期の状態SQLが新列を使える状態にする。
  - `buildPaidSyncStateSql()` にも同じマイグレーションSQLを含めた。

## 追加・更新したテスト

- `buildIncrementalODataUrl()` が `__system/updatedAt ge ... or __system/submissionDate ge ...` を使うことを検証。
- `runPaidSyncDryRun()` が最大 `updatedAt` を `lastUpdatedAt` として返し、SQLでは `last_updated_at` に保存することを検証。
- OData 上の添付ファイル名から公式API形式の添付URLを組み立てることを検証。
- 1回目同期後に同じ `__id` の submission が編集され、`submissionDate` は古いまま `updatedAt` だけ進んだ場合、2回目同期で取得されることを検証。
- `updatedAt` が `null` の新規 submission を `submissionDate` 条件で取得対象にすることを検証。
- repeat table の増分同期では `$root/Submissions/` prefix を使うことを検証。
- ページ別 checkpoint SQL が累積最大 `updatedAt` を保持し、後続ページで巻き戻らないことを検証。
- 旧 `last_submission_date` 列から `last_updated_at` へ非破壊でバックフィルするSQLを生成し、通常の状態保存SQLにも含まれることを文字列検証。

## まだ直っていないもの

- OIDC SSO 環境向けの代替認証実装は未実装。README に制約として明記したのみ。
- 添付ファイルの実体ダウンロード、保存、ETag 管理は未実装。現状は添付ダウンロードURLの保存用SQL生成まで。
- OData メタデータを読んでメディア型フィールドを厳密判定する処理は未実装。現状は既存URLと一般的な添付ファイル拡張子に見える文字列を対象にするため、非添付URLや拡張子付きテキストを誤検出する可能性がある。
- 削除済みsubmissionの反映は未実装。`__system/deletedAt` は同期条件にも状態計算にも含めていない。

## 参照した一次出典

- https://docs.getodk.org/central-api-odata-endpoints/
- https://docs.getodk.org/central-api-changelog/
- https://docs.getodk.org/central-submissions/
- https://docs.getodk.org/central-api-submission-management/
- https://docs.getodk.org/central-api-authentication/
- https://getodk.org/legal/brand/

## 検証

- `npm test`
- 結果: 17件すべて成功。
