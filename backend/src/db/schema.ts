import { bigint, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const telemetryEvents = pgTable("telemetry_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  distinctId: text("distinct_id").notNull(),
  event: text("event").notNull(),
  properties: jsonb("properties").notNull()
});

