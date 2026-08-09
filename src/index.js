const SYSTEM_PREFIX = "__system/";

export function normalizeODataDocument(document) {
  if (!document || typeof document !== "object") {
    throw new TypeError("ODK OData document must be an object");
  }

  const rows = Array.isArray(document.value) ? document.value : [];
  return {
    rows: rows.map(normalizeRow),
    nextLink: document["@odata.nextLink"] ?? null,
    count: document["@odata.count"] ?? rows.length
  };
}

export function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new TypeError("ODK OData row must be an object");
  }

  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("@odata.")) continue;
    normalized[normalizeColumnName(key)] = normalizeValue(value);
  }

  if (!normalized.__id || typeof normalized.__id !== "string") {
    throw new Error("ODK OData row is missing string __id");
  }

  return normalized;
}

export function normalizeColumnName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("Column name must be a non-empty string");
  }

  if (name.startsWith(SYSTEM_PREFIX)) {
    return `__system_${name.slice(SYSTEM_PREFIX.length)}`;
  }

  return name
    .replaceAll("/", "_")
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

export function normalizeValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildSql({ schema = "public", table, document }) {
  if (!table) throw new Error("table is required");

  const normalized = normalizeODataDocument(document);
  const columns = collectColumns(normalized.rows);
  if (!columns.includes("__id")) columns.unshift("__id");

  const qualifiedTable = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const statements = [
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`,
    createTableStatement(qualifiedTable, columns),
    createSyncStateStatement(schema)
  ];

  for (const row of normalized.rows) {
    statements.push(upsertStatement(qualifiedTable, columns, row));
  }

  statements.push(syncStateUpsertStatement(schema, table, normalized));
  return `${statements.join("\n\n")}\n`;
}

export function collectColumns(rows) {
  const seen = new Set(["__id"]);
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen].sort((a, b) => {
    if (a === "__id") return -1;
    if (b === "__id") return 1;
    return a.localeCompare(b);
  });
}

export function quoteIdent(identifier) {
  if (typeof identifier !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function quoteLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createTableStatement(qualifiedTable, columns) {
  const columnDefs = columns.map((column) => {
    if (column === "__id") return `${quoteIdent(column)} text PRIMARY KEY`;
    return `${quoteIdent(column)} text`;
  });

  return `CREATE TABLE IF NOT EXISTS ${qualifiedTable} (\n  ${columnDefs.join(",\n  ")}\n);`;
}

function createSyncStateStatement(schema) {
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema)}."odk_sync_state" (\n  "table_name" text PRIMARY KEY,\n  "row_count" integer NOT NULL,\n  "next_link" text,\n  "updated_at" timestamptz NOT NULL DEFAULT now()\n);`;
}

function upsertStatement(qualifiedTable, columns, row) {
  const columnSql = columns.map(quoteIdent).join(", ");
  const valueSql = columns.map((column) => quoteLiteral(row[column] ?? null)).join(", ");
  const updates = columns
    .filter((column) => column !== "__id")
    .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
    .join(", ");

  const updateClause = updates ? `DO UPDATE SET ${updates}` : "DO NOTHING";
  return `INSERT INTO ${qualifiedTable} (${columnSql})\nVALUES (${valueSql})\nON CONFLICT ("__id") ${updateClause};`;
}

function syncStateUpsertStatement(schema, table, normalized) {
  return `INSERT INTO ${quoteIdent(schema)}."odk_sync_state" ("table_name", "row_count", "next_link", "updated_at")\nVALUES (${quoteLiteral(table)}, ${Number(normalized.count)}, ${quoteLiteral(normalized.nextLink)}, now())\nON CONFLICT ("table_name") DO UPDATE SET\n  "row_count" = EXCLUDED."row_count",\n  "next_link" = EXCLUDED."next_link",\n  "updated_at" = now();`;
}
