# 根拠台帳

**外部に出す文書で行う主張は、ここに1件ずつ記録する。**

⚠️ **当社は「URLを自分で開く」という心がけで、3回失敗している。**
- `algora.io/pricing` を一次出典として引用したが **404だった**（開かずに引用した）
- CAN-SPAMの罰則を **$517** と書いた（実際は **$53,088**。100倍の誤り）
- UK PECR の上限を **£500,000** と書いた（実際は **£17.5M または売上の4%**）

**心がけでは防げなかった。台帳にして、古くなったことを機械的に検出する。**

## 形式（`claims.json`）

```json
[
  {
    "claim": "ODK Central の OData で __system/updatedAt は編集時に更新される",
    "source": "https://docs.getodk.org/central-api-odata-endpoints/",
    "source_type": "official_documentation",
    "checked_at": "2026-08-10",
    "confidence": "high",
    "used_in": ["README.md", "https://byrdhq.com/odk-central-to-postgres.html"]
  }
]
```

| 項目 | 意味 |
|---|---|
| `claim` | 主張そのもの。**曖昧に書かない** |
| `source` | **実際に開いたURL。**開いていないなら書かない |
| `source_type` | `official_documentation` / `forum_post` / `measured_by_us` / `inference` |
| `checked_at` | **確認した日。**推測で埋めない |
| `confidence` | `high` / `medium` / `low`。**`inference` なら `low` 以下** |
| `used_in` | その主張を書いた場所。**仕様変更時に全部直すため**（絶対ルール27） |

## 検査

`scripts/check-claims.mjs` が、**90日を超えて再確認していない主張**を警告する。
**外部の仕様は変わる。「一度確認した」は「今も正しい」を意味しない。**
