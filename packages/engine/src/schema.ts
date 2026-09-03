import { z } from "zod";

const provenanceSchema = z.enum(["auto", "rubric", "static", "manual", "default"]);
const transformSchema = z.enum(["percentile", "inverted", "average", "rubric", "static", "none"]);
const confidenceSchema = z.enum(["high", "medium", "low"]);

const seriesStateSchema = z.object({
  id: z.string(),
  latest: z.number().nullable(),
  latestDate: z.string().nullable(),
  percentile: z.number().min(0).max(100).nullable(),
  observations: z.number().int().nonnegative(),
  windowStart: z.string().nullable(),
  source: z.enum(["FRED", "NSE", "AMFI", "RBI", "IBJA", "MANUAL"]),
  status: z.enum(["ok", "stale", "failed", "insufficient_history", "manual"]),
  staleDays: z.number().nullable(),
  error: z.string().nullable(),
});

const scoreStateSchema = z.object({
  value: z.number().min(0).max(100),
  provenance: provenanceSchema,
  derivedFrom: z.array(z.string()),
  transform: transformSchema,
  computedAt: z.string().nullable(),
  enteredAt: z.string().nullable(),
  staleDays: z.number().nullable(),
  note: z.string().nullable(),
  confidence: confidenceSchema.nullable(),
});

const vetoStateSchema = z.object({
  active: z.boolean(),
  triggeredBy: z.array(z.string()),
  provenance: z.enum(["auto", "manual"]),
  detail: z.string().nullable(),
  hadEffect: z.boolean(),
});

const warningSchema = z.object({
  severity: z.enum(["info", "warn", "error"]),
  code: z.string(),
  message: z.string(),
  affects: z.array(z.string()),
});

const fetchLogEntrySchema = z.object({
  source: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(["ok", "failed", "partial"]),
  error: z.string().nullable(),
  rowsWritten: z.number().int().nonnegative(),
});

const tiltNodeResultSchema = z.object({
  composite: z.number(),
  rawTilt: z.number(),
  tilt: z.number(),
  prelim: z.number(),
  final: z.number(),
  neutral: z.number(),
  vsNeutralRaw: z.number(),
  vsNeutralFinal: z.number(),
  vetoActive: z.boolean(),
});

const allocationSchema = z.object({
  groups: z.record(z.object({ nodes: z.record(tiltNodeResultSchema) })),
  sector: z.object({
    composites: z.record(z.number()),
    qualifying: z.array(z.string()),
    held: z.array(z.string()),
    sleeve: z.number(),
    perSector: z.number(),
  }),
  rollup: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      groupWeight: z.number(),
      withinGroup: z.number(),
      portfolioWeight: z.number(),
    })
  ),
  total: z.number(),
});

const paramsSchema = z.object({
  signalWeights: z.object({
    l1: z.record(z.number()),
    equity: z.record(z.number()),
    debt: z.record(z.number()),
    metals: z.record(z.number()),
    sector: z.record(z.number()),
  }),
  neutralWeights: z.object({
    l1: z.record(z.number()),
    equity: z.record(z.number()),
    debt: z.record(z.number()),
    metals: z.record(z.number()),
  }),
  maxTilt: z.record(z.number()),
  sector: z.object({
    sleeveCap: z.number(),
    maxSectors: z.number().int().positive(),
    threshold: z.number(),
  }),
  normalisation: z.enum(["proportional", "zero_sum"]),
  percentileWindowYears: z.number().positive(),
  percentileMinObservations: z.number().int().nonnegative(),
  respectDefinitionBreaks: z.boolean(),
});

export const snapshotSchema = z.object({
  asOf: z.string(),
  schemaVersion: z.literal("1.0"),
  series: z.record(seriesStateSchema),
  scores: z.record(scoreStateSchema),
  vetoes: z.record(vetoStateSchema),
  params: paramsSchema,
  allocation: allocationSchema,
  fetchLog: z.array(fetchLogEntrySchema),
  warnings: z.array(warningSchema),
});

export type SnapshotSchema = z.infer<typeof snapshotSchema>;
