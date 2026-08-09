import {
  normalizeColumnName,
  normalizeODataDocument,
  quoteIdent,
  quoteLiteral
} from "./index.js";

const SECRET_QUERY_KEY = /(?:authorization|bearer|cookie|password|passcode|secret|session|token|api[_-]?key|jwt)/i;
const ATTACHMENT_LINK_KEY = /(?:attachment|download|media).*url|(?:media|download).*link/i;

export class PaidSyncError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PaidSyncError";
    this.details = details;
  }
}

export function redactSecrets(value, explicitSecrets = []) {
  const secrets = explicitSecrets.filter((secret) => typeof secret === "string" && secret.length > 0);

  if (typeof value === "string") {
    return redactSecretText(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, secrets));
  }

  if (value && typeof value === "object") {
    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (isSecretKey(key)) {
        redacted[key] = "[REDACTED]";
      } else {
        redacted[key] = redactSecrets(nestedValue, secrets);
      }
    }
    return redacted;
  }

  return value;
}

export async function createOdkSession({
  baseUrl,
  email,
  password,
  fetchImpl = globalThis.fetch,
  logger
}) {
  if (!baseUrl) throw new TypeError("baseUrl is required");
  if (!email) throw new TypeError("email is required");
  if (!password) throw new TypeError("password is required");

  const url = new URL("/v1/sessions", baseUrl).toString();
  const secrets = [password];

  safeDebug(logger, "odk.session.request", { url, email }, secrets);
  const document = await requestJson({
    fetchImpl,
    url,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    secrets,
    logger
  });

  const token = document.token ?? document.sessionToken ?? document.key;
  if (typeof token !== "string" || token.length === 0) {
    throw new PaidSyncError("ODK Central session response did not include a usable session token");
  }

  safeDebug(logger, "odk.session.created", { url, token }, [password, token]);
  return {
    baseUrl: new URL(baseUrl).origin,
    token
  };
}

export function buildIncrementalODataUrl({
  baseUrl,
  projectId,
  formId,
  tableName = "Submissions",
  lastSubmissionDate,
  nextLink
}) {
  if (nextLink) return sanitizeUrl(nextLink);
  if (!baseUrl) throw new TypeError("baseUrl is required");
  if (projectId === undefined || projectId === null) throw new TypeError("projectId is required");
  if (!formId) throw new TypeError("formId is required");

  const encodedFormId = encodeURIComponent(formId);
  const encodedTableName = encodeURIComponent(tableName);
  const url = new URL(`/v1/projects/${projectId}/forms/${encodedFormId}.svc/${encodedTableName}`, baseUrl);

  if (lastSubmissionDate) {
    const since = new Date(lastSubmissionDate);
    if (Number.isNaN(since.getTime())) {
      throw new TypeError("lastSubmissionDate must be a valid date");
    }
    url.searchParams.set("$filter", `__system/submissionDate ge ${since.toISOString()}`);
  }

  return url.toString();
}

export async function fetchAllPaidPages({
  initialUrl,
  session,
  fetchImpl = globalThis.fetch,
  logger,
  maxPages = 100
}) {
  if (!initialUrl) throw new TypeError("initialUrl is required");
  if (!session?.token) throw new TypeError("session.token is required");

  const secrets = [session.token];
  const pages = [];
  const visitedUrls = new Set();
  let nextUrl = initialUrl;

  while (nextUrl) {
    if (pages.length >= maxPages) {
      throw new PaidSyncError(`ODK Central paging exceeded maxPages=${maxPages}`);
    }
    if (visitedUrls.has(nextUrl)) {
      throw new PaidSyncError(`ODK Central paging repeated nextLink: ${sanitizeUrl(nextUrl, secrets)}`);
    }
    visitedUrls.add(nextUrl);

    safeDebug(logger, "odk.odata.page.request", { url: nextUrl }, secrets);
    const document = await requestJson({
      fetchImpl,
      url: nextUrl,
      method: "GET",
      headers: { authorization: `Bearer ${session.token}` },
      secrets,
      logger
    });

    const normalized = normalizeODataDocument(document);
    pages.push({
      url: sanitizeUrl(nextUrl, secrets),
      document,
      normalized,
      nextLink: normalized.nextLink ? resolveNextLink(normalized.nextLink, nextUrl, secrets) : null
    });
    nextUrl = pages.at(-1).nextLink;
  }

  return pages;
}

export async function runPaidSyncDryRun({
  baseUrl,
  projectId,
  formId,
  tableName = "Submissions",
  schema = "public",
  targetTable,
  state = {},
  knownSubmissionIds = [],
  session,
  fetchImpl = globalThis.fetch,
  logger
}) {
  if (!targetTable) throw new TypeError("targetTable is required");

  const initialUrl = buildIncrementalODataUrl({
    baseUrl,
    projectId,
    formId,
    tableName,
    lastSubmissionDate: state.lastSubmissionDate,
    nextLink: state.nextLink
  });
  const pages = await fetchAllPaidPages({ initialUrl, session, fetchImpl, logger });
  const rows = pages.flatMap((page) => page.normalized.rows);
  const rawRows = pages.flatMap((page) => (Array.isArray(page.document.value) ? page.document.value : []));
  const attachments = collectAttachmentReferences(rawRows);
  const report = buildDiffReport({ rows, knownSubmissionIds });
  const lastSubmissionDate = latestSubmissionDate(rows, state.lastSubmissionDate ?? null);

  const checkpoints = pages.map((page) =>
    buildPaidSyncStateSql({
      schema,
      table: targetTable,
      lastSubmissionDate: latestSubmissionDate(page.normalized.rows, state.lastSubmissionDate ?? null),
      nextLink: page.nextLink,
      pageCount: 1
    })
  );

  return {
    dryRun: true,
    rows,
    attachments,
    report,
    state: {
      tableName: targetTable,
      lastSubmissionDate,
      nextLink: null,
      completed: true
    },
    checkpointSql: checkpoints,
    finalStateSql: buildPaidSyncStateSql({
      schema,
      table: targetTable,
      lastSubmissionDate,
      nextLink: null,
      pageCount: pages.length
    }),
    attachmentSql: buildAttachmentReferenceSql({ schema, table: targetTable, attachments })
  };
}

export function collectAttachmentReferences(rows) {
  const attachments = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const submissionId = typeof row.__id === "string" ? row.__id : null;
    if (!submissionId) continue;

    for (const [fieldName, value] of Object.entries(row)) {
      if (fieldName.startsWith("@odata.")) continue;
      const urls = attachmentUrlsFromValue(value);
      for (const url of urls) {
        attachments.push({
          submissionId,
          fieldName: normalizeColumnName(fieldName),
          url: sanitizeUrl(url),
          downloadStatus: "url_saved_only"
        });
      }
    }
  }

  return attachments;
}

export function buildAttachmentReferenceSql({ schema = "public", table, attachments }) {
  if (!table) throw new TypeError("table is required");

  const qualifiedTable = `${quoteIdent(schema)}."odk_attachment_refs"`;
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${qualifiedTable} (\n  "table_name" text NOT NULL,\n  "submission_id" text NOT NULL,\n  "field_name" text NOT NULL,\n  "url" text NOT NULL,\n  "download_status" text NOT NULL,\n  "discovered_at" timestamptz NOT NULL DEFAULT now(),\n  PRIMARY KEY ("table_name", "submission_id", "field_name", "url")\n);`
  ];

  for (const attachment of attachments) {
    statements.push(
      `INSERT INTO ${qualifiedTable} ("table_name", "submission_id", "field_name", "url", "download_status")\nVALUES (${quoteLiteral(table)}, ${quoteLiteral(attachment.submissionId)}, ${quoteLiteral(attachment.fieldName)}, ${quoteLiteral(sanitizeUrl(attachment.url))}, ${quoteLiteral(attachment.downloadStatus)})\nON CONFLICT ("table_name", "submission_id", "field_name", "url") DO UPDATE SET\n  "download_status" = EXCLUDED."download_status",\n  "discovered_at" = now();`
    );
  }

  return `${statements.join("\n\n")}\n`;
}

export function buildPaidSyncStateSql({
  schema = "public",
  table,
  lastSubmissionDate = null,
  nextLink = null,
  pageCount = 0
}) {
  if (!table) throw new TypeError("table is required");

  const qualifiedTable = `${quoteIdent(schema)}."odk_paid_sync_state"`;
  const cleanNextLink = nextLink ? sanitizeUrl(nextLink) : null;

  return [
    `CREATE TABLE IF NOT EXISTS ${qualifiedTable} (\n  "table_name" text PRIMARY KEY,\n  "last_submission_date" timestamptz,\n  "next_link" text,\n  "page_count" integer NOT NULL DEFAULT 0,\n  "updated_at" timestamptz NOT NULL DEFAULT now()\n);`,
    `INSERT INTO ${qualifiedTable} ("table_name", "last_submission_date", "next_link", "page_count", "updated_at")\nVALUES (${quoteLiteral(table)}, ${quoteLiteral(lastSubmissionDate)}, ${quoteLiteral(cleanNextLink)}, ${Number(pageCount)}, now())\nON CONFLICT ("table_name") DO UPDATE SET\n  "last_submission_date" = EXCLUDED."last_submission_date",\n  "next_link" = EXCLUDED."next_link",\n  "page_count" = EXCLUDED."page_count",\n  "updated_at" = now();`
  ].join("\n\n");
}

export function buildDiffReport({ rows, knownSubmissionIds = [] }) {
  const knownIds = new Set(knownSubmissionIds);
  const seen = new Set();
  let inserted = 0;
  let updated = 0;

  for (const row of rows) {
    if (!row?.__id || seen.has(row.__id)) continue;
    seen.add(row.__id);
    if (knownIds.has(row.__id)) {
      updated += 1;
    } else {
      inserted += 1;
    }
  }

  return {
    inserted,
    updated,
    total: inserted + updated
  };
}

export function buildFailureNotificationPayload({
  target = "webhook",
  table,
  error,
  state = {},
  report = null,
  secrets = []
}) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    dryRun: true,
    target,
    event: "odk_paid_sync_failed",
    table,
    subject: `ODK paid sync failed: ${table}`,
    message: redactSecrets(message, secrets),
    state: redactSecrets(state, secrets),
    report: redactSecrets(report, secrets)
  };
}

async function requestJson({ fetchImpl, url, method, headers = {}, body, secrets = [], logger }) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl is required");
  }

  let response;
  try {
    response = await fetchImpl(url, { method, headers, body });
  } catch {
    throw new PaidSyncError(`ODK Central request failed before response: ${sanitizeUrl(url, secrets)}`);
  }

  if (!response.ok) {
    const responseText = typeof response.text === "function" ? await response.text() : "";
    const cleanBody = redactSecrets(responseText.slice(0, 500), secrets);
    const cleanUrl = sanitizeUrl(url, secrets);
    safeDebug(logger, "odk.request.failed", { status: response.status, url: cleanUrl, body: cleanBody }, secrets);
    throw new PaidSyncError(`ODK Central request failed: ${response.status} ${cleanUrl} ${cleanBody}`.trim());
  }

  try {
    return await response.json();
  } catch {
    throw new PaidSyncError(`ODK Central response was not valid JSON: ${sanitizeUrl(url, secrets)}`);
  }
}

function attachmentUrlsFromValue(value) {
  if (typeof value === "string") {
    return isHttpUrl(value) ? [value] : [];
  }

  if (!value || typeof value !== "object") return [];

  const urls = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === "string" && isHttpUrl(nestedValue) && ATTACHMENT_LINK_KEY.test(key)) {
      urls.push(nestedValue);
    }
  }
  return urls;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function latestSubmissionDate(rows, fallback) {
  let latest = fallback ? new Date(fallback) : null;

  for (const row of rows) {
    const value = row.__system_submissionDate;
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date > latest) latest = date;
  }

  return latest ? latest.toISOString() : null;
}

function resolveNextLink(nextLink, currentUrl, secrets) {
  return sanitizeUrl(new URL(nextLink, currentUrl).toString(), secrets);
}

function sanitizeUrl(value, explicitSecrets = []) {
  const redactedValue = redactSecretText(String(value), explicitSecrets);
  try {
    const url = new URL(redactedValue);
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretKey(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return redactedValue;
  }
}

function redactSecretText(value, explicitSecrets) {
  let redacted = value;
  for (const secret of explicitSecrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(^|[?&\s])(password|passcode|secret|session|token|api[_-]?key|jwt)=([^&\s]+)/gi, "$1$2=[REDACTED]");
}

function safeDebug(logger, event, payload, secrets) {
  if (!logger || typeof logger.debug !== "function") return;
  logger.debug(event, redactSecrets(payload, secrets));
}

function isSecretKey(key) {
  return String(key).toLowerCase() !== "$skiptoken" && SECRET_QUERY_KEY.test(key);
}
