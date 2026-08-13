import { v } from "convex/values";
import { query } from "../_generated/server";
import { authorize, CAPABILITIES } from "../authorization";
import { assertReadable, clampLimit, scopeOrganization } from "./shared";

// §28 / OBS-01 & OBS-04 — read access to execution traces and error reports.
// Requires aiopsRead AND tenant scoping: holding the capability only grants
// access to the caller's own organization, unless the caller is the platform
// operator (an organization of kind "adc"). See ./shared.

const resultStatus = v.union(
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("abstained"),
  v.literal("failed"),
);

// Recent traces. A cross-organization view is reserved to the platform operator;
// every other caller is pinned to its own organization whatever it requests.
export const listTraces = query({
  args: {
    organizationId: v.optional(v.string()),
    resultStatus: v.optional(resultStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.aiopsRead });
    const limit = clampLimit(args.limit);
    const scope = await scopeOrganization(ctx, auth, args.organizationId);

    if (scope === undefined) {
      // Platform operator, no organization requested: status-wide view.
      if (args.resultStatus === undefined) {
        return ctx.db
          .query("executionTraces")
          .withIndex("by_organizationId_and_startedAt", (q) =>
            q.eq("organizationId", undefined),
          )
          .order("desc")
          .take(limit);
      }
      const status = args.resultStatus;
      return ctx.db
        .query("executionTraces")
        .withIndex("by_resultStatus_and_startedAt", (q) =>
          q.eq("resultStatus", status),
        )
        .order("desc")
        .take(limit);
    }

    // Organization-scoped: read through the org index, then narrow by status so
    // the status filter can never widen the result beyond the tenant.
    const traces = await ctx.db
      .query("executionTraces")
      .withIndex("by_organizationId_and_startedAt", (q) =>
        q.eq("organizationId", scope),
      )
      .order("desc")
      .take(limit);
    return args.resultStatus === undefined
      ? traces
      : traces.filter((trace) => trace.resultStatus === args.resultStatus);
  },
});

// A single trace with its ordered steps — the "Execution Trace" view (G11).
export const getTrace = query({
  args: { traceId: v.id("executionTraces") },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.aiopsRead });
    const trace = await ctx.db.get(args.traceId);
    if (!trace) return null;
    await assertReadable(ctx, auth, trace.organizationId);
    const steps = await ctx.db
      .query("executionTraceSteps")
      .withIndex("by_traceId_and_ordinal", (q) => q.eq("traceId", args.traceId))
      .order("asc")
      .take(500);
    return { trace, steps };
  },
});

// Recent error reports, same tenant scoping as listTraces.
export const listErrors = query({
  args: {
    organizationId: v.optional(v.string()),
    errorType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.aiopsRead });
    const limit = clampLimit(args.limit);
    const scope = await scopeOrganization(ctx, auth, args.organizationId);

    if (scope === undefined) {
      if (args.errorType === undefined) {
        return ctx.db
          .query("errorReports")
          .withIndex("by_organizationId_and_createdAt", (q) =>
            q.eq("organizationId", undefined),
          )
          .order("desc")
          .take(limit);
      }
      const errorType = args.errorType;
      return ctx.db
        .query("errorReports")
        .withIndex("by_errorType_and_createdAt", (q) =>
          q.eq("errorType", errorType),
        )
        .order("desc")
        .take(limit);
    }

    const errors = await ctx.db
      .query("errorReports")
      .withIndex("by_organizationId_and_createdAt", (q) =>
        q.eq("organizationId", scope),
      )
      .order("desc")
      .take(limit);
    return args.errorType === undefined
      ? errors
      : errors.filter((error) => error.errorType === args.errorType);
  },
});
