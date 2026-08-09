# Line C Report: ODK Central OData -> PostgreSQL

作成日: 2026-08-09  
結論: 1つに絞る。作るものは `desiria-odata-pg`。ODK Central の OData JSON を PostgreSQL 向けの冪等SQLへ変換するOSSを公開し、有償版は顧客の既存実行環境で動かす認証付き取得・増分同期・通知・差分レポートに限定する。

## 1. 競合と需要の実測

採用ルール: ページを開けたものだけを数えた。開けなかったURLは採用しない。

### 需要: 公開の場で質問・詰まりが見えた件数

需要カウントに採用したODK Forumページ: 9ページ。画面上で確認できた関連投稿: 33投稿。画面上で確認できた不満・詰まり: 17個。公式Docsは仕様確認の補助として別採用。

| 開いたページ | 画面上の投稿数 | 数えた不満・詰まり |
|---|---:|---:|
| ODK Central connection with Postgresql: https://forum.getodk.org/t/odk-central-connection-with-postgresql/24548 | 3 | 2: PostgreSQLへ自動パースする手順要求、10,000 recordsで1GB超の画像付きデータ |
| Where is the form data stored in the database?: https://forum.getodk.org/t/where-is-the-form-data-stored-in-the-database/47202 | 8 | 3: DB内でデータを見つけられない、PostgreSQL直読みはtricky、DBスキーマは安定IFではない |
| Install pgadmin to view ODK Central database: https://forum.getodk.org/t/install-pgadmin-to-view-odk-central-database/44003 | 2 | 1: submission dataはraw XMLで直接利用に不向き |
| How to delete/purge rows from Central (PostgreSQL)?: https://forum.getodk.org/t/how-to-delete-purge-rows-from-central-postgresql/34171 | 2 | 2: 6 months retention/purge要求、別ユーザーのsame requirements |
| Update on hotlinking media files for dashboards: https://forum.getodk.org/t/update-on-hotlinking-media-files-for-dashboards/57623 | 7 | 3: Supersetで写真を見たい、公式側にまだsolutionなし、huge photo collectionでS3保管・取得コストが問題 |
| Payload string too long error in Central with central-webhook installed: https://forum.getodk.org/t/payload-string-too-long-error-in-central-with-central-webhook-installed/55241 | 4 | 3: 6 hours outage後にpayload string too long、submissionsは保存されるがentitiesが動かない、作者側もmore scenarios/fixに時間不足 |
| Central2pg #2: https://forum.getodk.org/t/central2pg-postgresql-set-of-functions-to-get-data-from-central/33350/2 | 1 | 2: all data download scenario、bandwidth/resources consumption改善待ち |
| ODK to PostgreSQL to nearly live Webmap: https://forum.getodk.org/t/odk-to-postgresql-to-nearly-live-webmap/36973 | 1 | 0: 詰まりではなく実運用例。11 Likesのみ採用 |
| Updating external datasets from another form's submissions data: https://forum.getodk.org/t/updating-external-datasets-from-another-forms-submissions-data-from-within-a-postgresql-database/37596 | 5 | 1: CSV adaptationの追加要求 |

補助事実: ODK公式Docsは、ODataがExcel/Power BI/Tableauなどへデータとスキーマを渡す標準で、Formごとに`.svc`があり、`Submissions`データ文書をJSONとして取得できると明記している。開いたページ: https://docs.getodk.org/central-api-odata-endpoints/

数えられなかったもの: Discourseの検索結果総数は画面上で安定して確認できなかったため採用しない。Google検索結果数も採用しない。

### 競合: 既に同じことをしている数

同じ/近いOSS競合は3本。画面上で確認できた有料の「ODK Central -> PostgreSQL専用同期」競合は0本。隣接する有料ホスティング競合は2社。

| 種別 | 競合 | 画面上の数字・価格 | 判断 |
|---|---|---:|---|
| OSS exact | central2pg: https://github.com/mathieubossaert/central2pg | 24 stars, 10 forks, Issues 8, Pull requests 0, 110 commits | 同じ線。PostgreSQL内に関数を置く方式。無料 |
| OSS exact | pl-pyODK: https://github.com/mathieubossaert/pl-pyodk | 9 stars, 1 fork, Issues 6, Pull requests 0, 80 commits | 同じ線。pl/python + pyODK。無料 |
| OSS adjacent | central-webhook: https://github.com/hotosm/central-webhook | 12 stars, 4 forks, Issues 0, Pull requests 0, 73 commits | イベント通知の隣接競合。PostgreSQL拡張`pgsql-http`が前提。無料 |
| OSS library | pyODK: https://getodk.github.io/pyodk/ | 価格表示なし。Python 3.10-3.13、Central v2025.1.4が画面上に表示 | API clientであり同期製品ではない。無料ライブラリ扱い |
| Paid adjacent | ODK Cloud: https://getodk.org/ | Standard $199/mo、Professional $499/mo、Enterprise Custom、Basic add-on $199/yearly or $249/monthly | ホスティング。ProfessionalにAPI access。同期製品ではない |
| Paid adjacent | SurveyLoopr: https://www.surveyloopr.com/docs/blog/odk-hosting-cost | Managed ODK Starter $79/mo、Professional $149、Enterprise $249、ODK Cloud $199-$499への比較あり | ホスティング。同期製品ではない |

価格の実数: exact OSSは$0。画面上で確認できた有料隣接価格は$79/mo、$149、$249、$199/mo、$499/mo、Custom、Basic add-on $199/$249。

不満の実数: 17個。内訳は上表の「数えた不満・詰まり」。推論で「売れそう」とは書かない。

## 2. 作るものの仕様

名前: `desiria-odata-pg`

対象: ODK Central の OData JSONを、PostgreSQLに安全に流し込むためのSQLへ変換するCLI/ライブラリ。

無料OSSで提供するもの:

- OData JSONの`value`配列を読み取る
- `__system/submissionDate`を`__system_submissionDate`へ正規化
- `/`、`-`、空白をPostgreSQL向け列名へ正規化
- `__id`を主キーとして使う
- `CREATE SCHEMA IF NOT EXISTS`
- `CREATE TABLE IF NOT EXISTS`
- `INSERT ... ON CONFLICT ("__id") DO UPDATE`
- `@odata.nextLink`と`@odata.count`を`odk_sync_state`に保存するSQL
- サンプルJSON、デモSQL、テスト

有償版で提供するもの:

- ODK Centralからの認証付き取得
- `$filter` / `$skiptoken`による増分同期
- 顧客の既存cron、既存CI、既存バッチ環境で動かす同期スクリプト例
- 失敗通知、再試行、差分レポート
- Metabase/Superset/Power BI用の接続テンプレート
- 価格は未定。価格決定はCEO決裁事項のため、実装側では決めない。2027年3月の月商173万円は、共通ブリーフ上の月額¥5,000〜10,000レンジなら課金180〜360件相当。

有償化しないもの: 導入代行、通話サポート、個別ダッシュボード制作。会社制約により役務は不可。

## 3. 動く最小実装

実装場所: `.company/products/line-c/`

主要ファイル:

- `src/index.js`: 正規化、SQL生成
- `src/cli.js`: CLI
- `test/index.test.js`: Node標準テスト7件
- `test/fixtures/submissions.json`: ODK OData風サンプル
- `demo/example-output.sql`: 公開デモ用SQL

実行方法:

```bash
cd .company/products/line-c
npm test
npm run demo
```

確認結果:

```text
tests 18
pass 17
fail 0
```

## 4. 公開できる成果物

公開対象: `README.md` と `demo/example-output.sql`

READMEには、使い方、無料/有償境界、kill基準を記載済み。公開時の投稿先はODK Forumの関連スレッド。ただし、通話・顔出し・実名公開なし、OSSリポジトリとテスト結果だけで投稿する。

投稿文の核:

```text
I built a small tested CLI that converts ODK Central OData JSON into idempotent PostgreSQL SQL.
It does not touch the Central database. It uses __id as the primary key and stores @odata.nextLink in a sync state table.
Tests and demo SQL are included.
```

## 5. Kill基準

公開から6週間で次のどちらかを満たさなければ停止。

- 有効化ユーザー10人
- 有料1件

有効化ユーザーの定義: GitHub issue、forum reply、メール、または公開コメントで「自分のODK Central OData JSONに対して実行した」と確認できる人。starのみ、README閲覧のみ、質問のみは数えない。

## 6. この線を捨てるべき理由

既にcentral2pgとpl-pyODKがあり、画面上の数字ではcentral2pgが24 stars、pl-pyODKが9 starsに留まる。公開需要は存在するが、OSS利用者が有償版に払う意思までは実測できていない。6週間で有効化10人または有料1件に届かなければ、技術的には正しくても市場線として捨てる。
