import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { authorize, authorizeMutation, CAPABILITIES } from "../authorization";
import { assertReadable, auditAiops, clampLimit, scopeOrganization } from "./shared";
import { ERROR_TYPES, WouriError } from "../lib/errors";

// OBS-03 / §30 — freeze inputs and context so a run can be replayed in staging.
// Platform-scoped: requires aiopsReplay.

// Captures a frozen snapshot. inputPayload/contextPayload are serialized to
// JSON strings so the exact bytes replayed later are immutable.
export const captureReplaySnapshot = mutation({
  args: {
    organizationId: v.optional(v.string()),
    traceId: v.optional(v.id("executionTraces")),
    conversationContextId: v.optional(v.id("conversationContexts")),
    inputPayload: v.any(),
    contextPayload: v.any(),
    promptKey: v.optional(v.string()),
    promptVersion: v.optional(v.number()),
    policyKey: v.optional(v.string()),
    policyVersion: v.optional(v.number()),
    modelConfigKey: v.optional(v.string()),
    modelConfigVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorizeMutation(ctx, {
      permission: CAPABILITIES.aiopsReplay,
    });
    const now = Date.now();
    // The capture is pinned to the caller's organization unless the caller is the
    // platform operator, so a tenant can never file a snapshot under another one.
    const organizationId = await scopeOrganization(ctx, auth, args.organizationId);
    const id = await ctx.db.insert("replaySnapshots", {
      organizationId,
      traceId: args.traceId,
      conversationContextId: args.conversationContextId,
      inputPayload: JSON.stringify(args.inputPayload),
      contextPayload: JSON.stringify(args.contextPayload),
      promptKey: args.promptKey,
      promptVersion: args.promptVersion,
      policyKey: args.policyKey,
      policyVersion: args.policyVersion,
      modelConfigKey: args.modelConfigKey,
      modelConfigVersion: args.modelConfigVersion,
      capturedAt: now,
    });
    await auditAiops(ctx, auth, now, {
      action: "aiops.replay.capture",
      resourceType: "replaySnapshots",
      resourceId: id,
      traceId: args.traceId,
      after: { promptKey: args.promptKey, promptVersion: args.promptVersion },
    });
    return id;
  },
});

// OBS-03 / §75 — capture a snapshot FROM a trace. captureReplaySnapshot requires
// the caller to supply the input and context payloads, which an operator opening
// a trace in the Console does not have: asking the client to invent them would
// produce a snapshot that replays nothing. Here the server reads the trace it
// owns and derives everything, so the operator only chooses which execution to
// freeze.
export const captureSnapshotFromTrace = mutation({
  args: { traceId: v.id("executionTraces") },
  handler: async (ctx, args) => {
    const auth = await authorizeMutation(ctx, {
      permission: CAPABILITIES.aiopsReplay,
    });
    const trace = await ctx.db.get(args.traceId);
    if (!trace) {
      throw new WouriError(ERROR_TYPES.INTERNAL, "Unknown execution trace");
    }
    await assertReadable(ctx, auth, trace.organizationId);

    const steps = await ctx.db
      .query("executionTraceSteps")
      .withIndex("by_traceId_and_ordinal", (q) => q.eq("traceId", trace._id))
      .order("asc")
      .take(200);

    const now = Date.now();
    const id = await ctx.db.insert("replaySnapshots", {
      organizationId: trace.organizationId,
      traceId: trace._id,
      conversationContextId: trace.conversationContextId,
      // The trace does not store the farmer's utterance; freezing the routing
      // conditions is what makes a later comparison meaningful, and it keeps the
      // snapshot free of message content.
      inputPayload: JSON.stringify({
        intent: trace.intent ?? null,
        language: trace.language ?? null,
        channel: trace.channel ?? null,
        originAlertId: trace.originAlertId ?? null,
      }),
      contextPayload: JSON.stringify({
        resultStatus: trace.resultStatus,
        errorType: trace.errorType ?? null,
        latencyMs: trace.latencyMs ?? null,
        steps: steps.map((step) => ({
          ordinal: step.ordinal,
          kind: step.kind,
          name: step.name,
          status: step.status,
        })),
      }),
      promptKey: trace.promptKey,
      promptVersion: trace.promptVersion,
      policyKey: trace.policyKey,
      policyVersion: trace.policyVersion,
      modelConfigKey: trace.modelConfigKey,
      modelConfigVersion: trace.modelConfigVersion,
      capturedAt: now,
    });
    await auditAiops(ctx, auth, now, {
      action: "aiops.replay.capture",
      resourceType: "replaySnapshots",
      resourceId: id,
      traceId: trace._id,
      after: { promptKey: trace.promptKey, promptVersion: trace.promptVersion },
    });
    return id;
  },
});

// Recent snapshots, filterable by originating trace or by organization.
export const listReplaySnapshots = query({
  args: {
    organizationId: v.optional(v.string()),
    traceId: v.optional(v.id("executionTraces")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.aiopsReplay });
    const limit = clampLimit(args.limit);
    const scope = await scopeOrganization(ctx, auth, args.organizationId);

    if (args.traceId !== undefined) {
      const traceId = args.traceId;
      const byTrace = await ctx.db
        .query("replaySnapshots")
        .withIndex("by_traceId", (q) => q.eq("traceId", traceId))
        .order("desc")
        .take(limit);
      // A trace id is guessable, so the trace filter must not escape the tenant.
      return scope === undefined
        ? byTrace
        : byTrace.filter((snapshot) => snapshot.organizationId === scope);
    }
    return ctx.db
      .query("replaySnapshots")
      .withIndex("by_organizationId_and_capturedAt", (q) =>
        q.eq("organizationId", scope),
      )
      .order("desc")
      .take(limit);
  },
});

export const getReplaySnapshot = query({
  args: { snapshotId: v.id("replaySnapshots") },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.aiopsReplay });
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) return null;
    // Snapshots carry frozen input and context payloads: the most sensitive
    // records in the platform. Ownership is verified before returning them.
    await assertReadable(ctx, auth, snapshot.organizationId);
    return snapshot;
  },
});
