#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildSql } from "./index.js";

function usage() {
  return [
    "Usage: desiria-odata-pg <odata-json-file> --schema <schema> --table <table>",
    "",
    "Example:",
    "  node src/cli.js test/fixtures/submissions.json --schema submissions_stage --table bird_survey"
  ].join("\n");
}

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const args = { file, schema: "public", table: null };

  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key === "--schema") {
      args.schema = value;
      index += 1;
    } else if (key === "--table") {
      args.table = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  if (!args.file || !args.table) {
    throw new Error(usage());
  }

  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const document = JSON.parse(await readFile(args.file, "utf8"));
  process.stdout.write(buildSql({ schema: args.schema, table: args.table, document }));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
