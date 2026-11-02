import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Status values live in shared/api.ts (JOB_STATUSES); the column is plain text. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    workflowId: text("workflow_id").notNull(),
    /** sha256 of the workflow file the job ran with, so an old image can say what made it. */
    workflowHash: text("workflow_hash").notNull(),
    /** The resolved values snapshot (random seed filled in, image parameters as stored image ids). */
    params: text("params", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    status: text("status").notNull(),
    progress: real("progress"),
    promptId: text("prompt_id"),
    sourceImageId: text("source_image_id"),
    error: text("error"),
    /** Times boot recovery has put a running job back on the queue. */
    recoveries: integer("recoveries").notNull().default(0),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
  },
  (table) => ({
    ownerCreatedIdx: index("jobs_owner_created_idx").on(table.ownerId, table.createdAt),
    statusCreatedIdx: index("jobs_status_created_idx").on(table.status, table.createdAt),
  }),
);

export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(),
    /** Null for an upload: no job made it. Deleting a job deletes the images it made. */
    jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    /** "generated" (a job's output) or "upload" (a reference the user added). Uploads never sweep. */
    source: text("source").notNull().default("generated"),
    /** Relative to DATA_DIR/media. Server-generated, never client input. */
    fileKey: text("file_key").notNull(),
    /** Relative to DATA_DIR/thumbs; null when no thumbnail could be made (e.g. mp4). */
    thumbKey: text("thumb_key"),
    width: integer("width"),
    height: integer("height"),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    seed: integer("seed"),
    nsfw: integer("nsfw", { mode: "boolean" }).notNull().default(false),
    favourite: integer("favourite", { mode: "boolean" }).notNull().default(false),
    parentImageId: text("parent_image_id"),
    promptSummary: text("prompt_summary").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    ownerCreatedIdx: index("images_owner_created_idx").on(table.ownerId, table.createdAt),
    ownerSourceCreatedIdx: index("images_owner_source_created_idx").on(
      table.ownerId,
      table.source,
      table.createdAt,
    ),
    jobIdx: index("images_job_idx").on(table.jobId),
  }),
);

export const userSettings = sqliteTable("user_settings", {
  ownerId: text("owner_id").primaryKey(),
  nsfwVisible: integer("nsfw_visible", { mode: "boolean" }).notNull().default(false),
});
