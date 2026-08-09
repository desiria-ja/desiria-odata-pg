import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildDiffReport,
  buildFailureNotificationPayload,
  buildIncrementalODataUrl,
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

test("builds an incremental OData URL from last submission date and resumes from nextLink", () => {
  const url = buildIncrementalODataUrl({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird survey",
    lastSubmissionDate: "2026-08-01T00:00:00.000Z"
  });

  assert.match(url, /forms\/bird%20survey\.svc\/Submissions/);
  assert.match(decodeURIComponent(url).replaceAll("+", " "), /\$filter=__system\/submissionDate ge 2026-08-01T00:00:00.000Z/);

  const resumed = buildIncrementalODataUrl({
    baseUrl: "https://central.example.test",
    projectId: 1,
    formId: "bird",
    nextLink: "https://central.example.test/odata?$skiptoken=abc"
  });
  assert.equal(resumed, "https://central.example.test/odata?$skiptoken=abc");
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
  assert.equal(result.state.lastSubmissionDate, "2026-08-02T05:00:00.000Z");
  assert.equal(result.state.nextLink, null);
  assert.equal(result.attachments.length, 3);
  assert.match(result.checkpointSql[0], /\$skiptoken=page-2/);
  assert.match(result.finalStateSql, /"odk_paid_sync_state"/);
  assert.match(result.attachmentSql, /"odk_attachment_refs"/);
  assert.match(result.attachmentSql, /url_saved_only/);
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
    lastSubmissionDate: "2026-08-02T05:00:00.000Z",
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

test("classifies insert and update counts for the sync diff report", () => {
  const report = buildDiffReport({
    rows: [{ __id: "a" }, { __id: "b" }, { __id: "b" }, { __id: "c" }],
    knownSubmissionIds: ["b"]
  });

  assert.deepEqual(report, { inserted: 2, updated: 1, total: 3 });
});
