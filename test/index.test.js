import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildSql,
  collectColumns,
  normalizeColumnName,
  normalizeODataDocument,
  normalizeRow,
  quoteIdent,
  quoteLiteral
} from "../src/index.js";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/submissions.json", import.meta.url), "utf8")
);

test("normalizes ODK system columns and nested JSON values", () => {
  const row = normalizeRow(fixture.value[0]);

  assert.equal(row.__id, "uuid:11111111-1111-1111-1111-111111111111");
  assert.equal(row.__system_submissionDate, "2026-08-01T10:00:00.000Z");
  assert.equal(row.__system_submitterId, "12");
  assert.equal(row.location, '{"type":"Point","coordinates":[139.767,35.681]}');
});

test("normalizes slash, dash, and space in ordinary ODK field names", () => {
  assert.equal(normalizeColumnName("repeat-group/name field"), "repeat_group_name_field");
});

test("rejects rows without a stable ODK __id", () => {
  assert.throws(() => normalizeRow({ species: "sparrow" }), /missing string __id/);
});

test("collects deterministic columns with __id first", () => {
  const document = normalizeODataDocument(fixture);
  assert.deepEqual(collectColumns(document.rows), [
    "__id",
    "__system_submissionDate",
    "__system_submitterId",
    "count",
    "location",
    "notes_field",
    "photo",
    "species"
  ]);
});

test("quotes SQL identifiers and rejects unsafe names", () => {
  assert.equal(quoteIdent("odk_stage"), '"odk_stage"');
  assert.throws(() => quoteIdent("odk-stage"), /Unsafe SQL identifier/);
});

test("quotes SQL literals and preserves nulls", () => {
  assert.equal(quoteLiteral("O'Hara"), "'O''Hara'");
  assert.equal(quoteLiteral(null), "NULL");
});

test("builds idempotent PostgreSQL SQL with sync state", () => {
  const sql = buildSql({ schema: "odk_stage", table: "bird_survey", document: fixture });

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "odk_stage";/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "odk_stage"\."bird_survey"/);
  assert.match(sql, /"__id" text PRIMARY KEY/);
  assert.match(sql, /ON CONFLICT \("__id"\) DO UPDATE SET/);
  assert.match(sql, /"odk_sync_state"/);
  assert.match(sql, /\$skiptoken=abc/);
});
