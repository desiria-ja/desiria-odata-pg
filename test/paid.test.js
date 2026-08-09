import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildDiffReport,
  buildFailureNotificationPayload,
  buildIncrementalODataUrl,
  buildPaidSyncStateMigrationSql,
  buildPaidSyncStateSql,
  createOdkSession,
  fetchAllPaidPages,
  runPaidSyncDryRun
} from "../src/paid.js";

const page1 = JSON.parse(await readFile(new URL("./fixtures/paid-page-1.json", import.meta.url), "utf8"));
const page2 = JSON.parse(await readFile(new URL("./fixtures/paid-page-2.json", import.meta.url), "utf8"));

function jsonResponse(document, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return document;
    },
    async text() {
      return JSON.stringify(document);
    }
  };
}

test("creates an ODK Central session with injected fetch and does not log the password or token", async () => {
  const logs = [];
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    return jsonResponse({ token: "session-token-123" });
  };

  const session = await createOdkSession({
    baseUrl: "https://central.example.test",
    email: "sync@example.test",
    password: "password-123",
    fetchImpl,
    logger: {
      debug(event, payload) {
        logs.push({ event, payload });
      }
    }
  });

  assert.equal(session.token, "session-token-123");
  assert.equal(fetchCalls[0].url, "https://central.example.test/v1/sessions");
  assert.equal(JSON.parse(fetchCalls[0].options.body).password, "password-123");
  const logText = JSON.stringify(logs);
  assert.doesNotMatch(logText, /password-123/);
  assert.doesNotMatch(logText, /session-token-123/);
});

test("builds an incremental OData URL from last updatedAt and resumes from nextLink", () => {
  const url = buildIncrementalODataUrl({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird survey",
    lastUpdatedAt: "2026-08-01T00:00:00.000Z"
  });

  assert.match(url, /forms\/bird%20survey\.svc\/Submissions/);
  assert.match(
    decodeURIComponent(url).replaceAll("+", " "),
    /\$filter=__system\/updatedAt ge 2026-08-01T00:00:00.000Z or __system\/submissionDate ge 2026-08-01T00:00:00.000Z/
  );

  const resumed = buildIncrementalODataUrl({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    nextLink: "https://central.example.test/odata?$skiptoken=abc"
  });
  assert.equal(resumed, "https://central.example.test/odata?$skiptoken=abc");
});

test("includes newly created submissions whose updatedAt is null", async () => {
  const newSubmissionPage = {
    value: [
      {
        "__id": "uuid:new-001",
        "__system/submissionDate": "2026-08-03T10:00:00.000Z",
        "__system/updatedAt": null,
        "species": "egret"
      }
    ]
  };
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(decodeURIComponent(url).replaceAll("+", " "));
    return jsonResponse(newSubmissionPage);
  };

  const result = await runPaidSyncDryRun({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    targetTable: "bird_survey",
    state: { lastUpdatedAt: "2026-08-02T00:00:00.000Z" },
    session: { token: "session-token-123" },
    fetchImpl
  });

  assert.match(requestedUrls[0], /__system\/updatedAt ge 2026-08-02T00:00:00.000Z/);
  assert.match(requestedUrls[0], /__system\/submissionDate ge 2026-08-02T00:00:00.000Z/);
  assert.equal(result.rows[0].species, "egret");
  assert.equal(result.state.lastUpdatedAt, "2026-08-03T10:00:00.000Z");
});

test("prefixes root submission metadata when filtering repeat tables", () => {
  const url = buildIncrementalODataUrl({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    tableName: "Submissions.children.child",
    lastUpdatedAt: "2026-08-02T00:00:00.000Z"
  });
  const decoded = decodeURIComponent(url).replaceAll("+", " ");

  assert.match(decoded, /forms\/bird\.svc\/Submissions\.children\.child/);
  assert.match(
    decoded,
    /\$filter=\$root\/Submissions\/__system\/updatedAt ge 2026-08-02T00:00:00.000Z or \$root\/Submissions\/__system\/submissionDate ge 2026-08-02T00:00:00.000Z/
  );
});

test("follows @odata.nextLink until the final page", async () => {
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return decodeURIComponent(url).includes("$skiptoken=page-2") ? jsonResponse(page2) : jsonResponse(page1);
  };

  const pages = await fetchAllPaidPages({
    initialUrl: "https://central.example.test/v1/projects/1/forms/bird.svc/Submissions",
    session: { token: "session-token-123" },
    fetchImpl
  });

  assert.equal(pages.length, 2);
  assert.equal(pages[0].normalized.rows.length, 2);
  assert.equal(pages[1].normalized.rows.length, 1);
  assert.deepEqual(requestedUrls, [
    "https://central.example.test/v1/projects/1/forms/bird.svc/Submissions",
    "https://central.example.test/v1/projects/1/forms/bird.svc/Submissions?$skiptoken=page-2"
  ]);
});

test("runs paid sync dry-run with checkpoint state, attachment URLs, and diff report", async () => {
  const fetchImpl = async (url) =>
    decodeURIComponent(url).includes("$skiptoken=page-2") ? jsonResponse(page2) : jsonResponse(page1);

  const result = await runPaidSyncDryRun({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    schema: "odk_stage",
    targetTable: "bird_survey",
    state: { lastSubmissionDate: "2026-08-01T00:00:00.000Z" },
    knownSubmissionIds: ["uuid:paid-002"],
    session: { token: "session-token-123" },
    fetchImpl
  });

  assert.equal(result.dryRun, true);
  assert.deepEqual(result.report, { inserted: 2, updated: 1, total: 3 });
  assert.equal(result.state.lastUpdatedAt, "2026-08-02T06:00:00.000Z");
  assert.equal(result.state.nextLink, null);
  assert.equal(result.attachments.length, 3);
  assert.equal(
    result.attachments[0].url,
    "https://central.example.test/v1/projects/1/forms/bird/submissions/uuid%3Apaid-001/attachments/photo-001.jpg"
  );
  assert.match(result.checkpointSql[0], /\$skiptoken=page-2/);
  assert.match(result.checkpointSql[0], /CREATE SCHEMA IF NOT EXISTS "odk_stage";/);
  assert.match(result.checkpointSql[1], /2026-08-02T06:00:00.000Z/);
  assert.match(result.finalStateSql, /"odk_paid_sync_state"/);
  assert.match(result.finalStateSql, /"last_updated_at"/);
  assert.match(result.attachmentSql, /CREATE SCHEMA IF NOT EXISTS "odk_stage";/);
  assert.match(result.attachmentSql, /"odk_attachment_refs"/);
  assert.match(result.attachmentSql, /url_saved_only/);
});

test("picks up an edited submission on the second incremental sync", async () => {
  const firstPage = {
    value: [
      {
        "__id": "uuid:edited-001",
        "__system/submissionDate": "2026-08-01T00:00:00.000Z",
        "__system/updatedAt": "2026-08-01T00:00:00.000Z",
        "species": "sparrow"
      }
    ]
  };
  const editedPage = {
    value: [
      {
        "__id": "uuid:edited-001",
        "__system/submissionDate": "2026-08-01T00:00:00.000Z",
        "__system/updatedAt": "2026-08-03T09:30:00.000Z",
        "species": "sparrow edited"
      }
    ]
  };
  const documentsByCall = [firstPage, editedPage];
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(decodeURIComponent(url).replaceAll("+", " "));
    return jsonResponse(documentsByCall.shift());
  };

  const first = await runPaidSyncDryRun({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    targetTable: "bird_survey",
    session: { token: "session-token-123" },
    fetchImpl
  });
  const second = await runPaidSyncDryRun({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    targetTable: "bird_survey",
    state: first.state,
    knownSubmissionIds: ["uuid:edited-001"],
    session: { token: "session-token-123" },
    fetchImpl
  });

  assert.match(requestedUrls[1], /\$filter=__system\/updatedAt ge 2026-08-01T00:00:00.000Z/);
  assert.match(requestedUrls[1], /__system\/submissionDate ge 2026-08-01T00:00:00.000Z/);
  assert.equal(second.rows[0].species, "sparrow edited");
  assert.equal(second.state.lastUpdatedAt, "2026-08-03T09:30:00.000Z");
  assert.deepEqual(second.report, { inserted: 0, updated: 1, total: 1 });
});

test("redacts credentials from errors, generated SQL, attachment URLs, and dry-run notifications", async () => {
  const fetchImpl = async () =>
    jsonResponse({ error: "bad token session-token-123 password=password-123" }, 401);

  await assert.rejects(
    () =>
      fetchAllPaidPages({
        initialUrl: "https://central.example.test/odata?token=session-token-123",
        session: { token: "session-token-123" },
        fetchImpl
      }),
    (error) => {
      assert.doesNotMatch(error.message, /session-token-123/);
      assert.doesNotMatch(error.message, /password-123/);
      return true;
    }
  );

  const sql = buildPaidSyncStateSql({
    schema: "odk_stage",
    table: "bird_survey",
    lastUpdatedAt: "2026-08-02T05:00:00.000Z",
    nextLink: "https://central.example.test/odata?token=session-token-123&$skiptoken=abc"
  });
  assert.doesNotMatch(sql, /session-token-123/);
  assert.match(decodeURIComponent(sql), /\$skiptoken=abc/);

  const notification = buildFailureNotificationPayload({
    table: "bird_survey",
    error: new Error("failed with Bearer session-token-123 and password=password-123"),
    state: { nextLink: "https://central.example.test/odata?token=session-token-123" },
    secrets: ["session-token-123", "password-123"]
  });
  assert.equal(notification.dryRun, true);
  assert.doesNotMatch(JSON.stringify(notification), /session-token-123/);
  assert.doesNotMatch(JSON.stringify(notification), /password-123/);
});

test("builds a non-destructive migration from last_submission_date to last_updated_at", () => {
  const sql = buildPaidSyncStateMigrationSql({ schema: "odk_stage" });

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "odk_stage";/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "odk_stage"\."odk_paid_sync_state"/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "last_updated_at" timestamptz/);
  assert.match(sql, /column_name = 'last_submission_date'/);
  assert.match(sql, /SET "last_updated_at" = "last_submission_date"/);
  assert.doesNotMatch(sql, /DROP COLUMN/);

  const stateSql = buildPaidSyncStateSql({
    schema: "odk_stage",
    table: "bird_survey",
    lastUpdatedAt: "2026-08-02T05:00:00.000Z"
  });
  assert.match(stateSql, /column_name = 'last_submission_date'/);
  assert.match(stateSql, /INSERT INTO "odk_stage"\."odk_paid_sync_state"/);
});

test("classifies insert and update counts for the sync diff report", () => {
  const report = buildDiffReport({
    rows: [{ __id: "a" }, { __id: "b" }, { __id: "b" }, { __id: "c" }],
    knownSubmissionIds: ["b"]
  });

  assert.deepEqual(report, { inserted: 2, updated: 1, total: 3 });
});
