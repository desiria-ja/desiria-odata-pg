# Line C Fix Report

## 修正した内容

- 増分同期の基準を `__system/submissionDate` から `__system/updatedAt` に変更した。
  - ODK Docs では `submissionDate` は `createdAt`、`updatedAt` は `__system/updatedAt` とされているため、編集済み submission を拾うには `updatedAt` を使う。
  - 次回同期用 checkpoint は、取り込んだ行の最大 `updatedAt` を `last_updated_at` として保存する。
  - `updatedAt` が無い行は checkpoint 計算時のみ `submissionDate` にフォールバックする。これは古い/不完全な行で状態更新が止まらないようにするため。
  - フィルタは `__system/updatedAt ge ...` を使う。境界行は二重取得され得るが、`__id` 主キーの UPSERT で冪等に処理できる。`gt` は同一タイムスタンプ精度の更新を取りこぼす可能性があるため使わない。

- ページごとの checkpoint SQL を累積最大 `updatedAt` で保存するよう修正した。
  - 後続ページの最大 `updatedAt` が前ページより古い場合でも、状態が巻き戻らない。

- 添付の扱いを README と実装で揃えた。
  - OData feed 上のメディア値は URL ではなくファイル名として出るため、`baseUrl`、`projectId`、`formId`、`__id`、`filename` から `/v1/projects/{projectId}/forms/{xmlFormId}/submissions/{instanceId}/attachments/{filename}` を組み立てる。
  - 実ファイルのダウンロードは引き続き範囲外。

- README に OIDC SSO 環境の制約を明記した。
  - 現実装は `/v1/sessions` のセッション認証のみ。
  - OIDC SSO が有効な ODK Central では Basic 認証と `POST /v1/sessions` が使えないため、動作対象外と明記した。

- 商標・非提携表示を修正した。
  - `package.json` の `name` を `desiria-odata-pg` に変更した。
  - README 冒頭に非提携表示を追加した。

- AI開示を README 冒頭に追加した。
  - `Built by an AI agent operating on behalf of Desiria LLC. We say so up front because some organisations restrict AI-assisted work.`

## 追加・更新したテスト

- `buildIncrementalODataUrl()` が `__system/updatedAt ge ...` を使うことを検証。
- `runPaidSyncDryRun()` が最大 `updatedAt` を `lastUpdatedAt` として返し、SQLでは `last_updated_at` に保存することを検証。
- OData 上の添付ファイル名から公式API形式の添付URLを組み立てることを検証。
- 1回目同期後に同じ `__id` の submission が編集され、`submissionDate` は古いまま `updatedAt` だけ進んだ場合、2回目同期で取得されることを検証。
- ページ別 checkpoint SQL が累積最大 `updatedAt` を保持し、後続ページで巻き戻らないことを検証。

## まだ直っていないもの

- OIDC SSO 環境向けの代替認証実装は未実装。README に制約として明記したのみ。
- 添付ファイルの実体ダウンロード、保存、ETag 管理は未実装。現状は添付ダウンロードURLの保存用SQL生成まで。
- OData メタデータを読んでメディア型フィールドを厳密判定する処理は未実装。現状は一般的な添付ファイル拡張子に見える文字列を対象にする。
- 既存DBに `odk_paid_sync_state.last_submission_date` が作成済みの場合のマイグレーションSQLは未実装。コードは旧 state 名を入力として読む互換は残したが、生成SQLは `last_updated_at` に切り替えた。

## 参照した一次出典

- https://docs.getodk.org/central-api-odata-endpoints/
- https://docs.getodk.org/central-api-changelog/
- https://docs.getodk.org/central-submissions/
- https://docs.getodk.org/central-api-submission-management/
- https://docs.getodk.org/central-api-authentication/
- https://getodk.org/legal/brand/

## 検証

- `npm test`
- 結果: 14件すべて成功。
