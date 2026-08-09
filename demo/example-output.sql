CREATE SCHEMA IF NOT EXISTS "submissions_stage";

CREATE TABLE IF NOT EXISTS "submissions_stage"."bird_survey" (
  "__id" text PRIMARY KEY,
  "__system_submissionDate" text,
  "__system_submitterId" text,
  "count" text,
  "location" text,
  "notes_field" text,
  "photo" text,
  "species" text
);

CREATE TABLE IF NOT EXISTS "submissions_stage"."odk_sync_state" (
  "table_name" text PRIMARY KEY,
  "row_count" integer NOT NULL,
  "next_link" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "submissions_stage"."bird_survey" ("__id", "__system_submissionDate", "__system_submitterId", "count", "location", "notes_field", "photo", "species")
VALUES ('uuid:11111111-1111-1111-1111-111111111111', '2026-08-01T10:00:00.000Z', '12', '3', '{"type":"Point","coordinates":[139.767,35.681]}', NULL, 'sparrow.jpg', 'sparrow')
ON CONFLICT ("__id") DO UPDATE SET "__system_submissionDate" = EXCLUDED."__system_submissionDate", "__system_submitterId" = EXCLUDED."__system_submitterId", "count" = EXCLUDED."count", "location" = EXCLUDED."location", "notes_field" = EXCLUDED."notes_field", "photo" = EXCLUDED."photo", "species" = EXCLUDED."species";

INSERT INTO "submissions_stage"."bird_survey" ("__id", "__system_submissionDate", "__system_submitterId", "count", "location", "notes_field", "photo", "species")
VALUES ('uuid:22222222-2222-2222-2222-222222222222', '2026-08-02T11:00:00.000Z', '13', '1', NULL, 'seen near station', NULL, 'crow')
ON CONFLICT ("__id") DO UPDATE SET "__system_submissionDate" = EXCLUDED."__system_submissionDate", "__system_submitterId" = EXCLUDED."__system_submitterId", "count" = EXCLUDED."count", "location" = EXCLUDED."location", "notes_field" = EXCLUDED."notes_field", "photo" = EXCLUDED."photo", "species" = EXCLUDED."species";

INSERT INTO "submissions_stage"."odk_sync_state" ("table_name", "row_count", "next_link", "updated_at")
VALUES ('bird_survey', 2, 'https://central.example.org/v1/projects/2/forms/bird_survey.svc/Submissions?$skiptoken=abc', now())
ON CONFLICT ("table_name") DO UPDATE SET
  "row_count" = EXCLUDED."row_count",
  "next_link" = EXCLUDED."next_link",
  "updated_at" = now();
