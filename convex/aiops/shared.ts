import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AuthorizationContext } from "../authorization";
import { recordAudit } from "../lib/audit";
import { ERROR_TYPES, WouriError } from "../lib/errors";

// Shared AIOPS/CONFIG helpers. Kept tiny so every domain module stays focused.

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

// Bounds every listing so a table that grows cannot produce an unbounded read.
export const clampLimit = (limit: number | undefined): number =>
  Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

// Holding an aiops capability is NOT sufficient to read another tenant's data:
// capabilities live in per-organization role policies, so a misconfigured
// organization could otherwise read the whole platform. Only an organization of
// kind "adc" (the platform operator) may look across tenants.
export const isPlatformOrganization = async (
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<boolean> => {
  const profile = await ctx.db
    .query("organizationProfiles")
    .withIndex("by_organizationId", (q) => q.eq("organizationId", organizationId))
    .unique();
  return profile?.kind === "adc" && profile.status === "active";
};

// Resolves which organization a listing may target. A platform operator may
// specify one explicitly; anyone else is pinned to their own, whatever they ask.
export const scopeOrganization = async (
  ctx: QueryCtx | MutationCtx,
  auth: AuthorizationContext,
  requested: string | undefined,
): Promise<string | undefined> => {
  if (await isPlatformOrganization(ctx, auth.organizationId)) return requested;
  return auth.organizationId;
};

// Fail-closed ownership check for a record fetched by id.
export const assertReadable = async (
  ctx: QueryCtx | MutationCtx,
  auth: AuthorizationContext,
  recordOrganizationId: string | undefined,
): Promise<void> => {
  if (recordOrganizationId === auth.organizationId) return;
  if (await isPlatformOrganization(ctx, auth.organizationId)) return;
  throw new WouriError(ERROR_TYPES.PERMISSION, "Record not accessible");
};

type AiopsAuditEntry = {
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  traceId?: Id<"executionTraces">;
};

// Records a platform audit entry, deriving the actor subject server-side. The
// caller supplies the already-authorized context; we never trust a client id.
export const auditAiops = async (
  ctx: MutationCtx,
  auth: AuthorizationContext,
  now: number,
  entry: AiopsAuditEntry,
): Promise<void> => {
  const identity = await ctx.auth.getUserIdentity();
  await recordAudit(
    ctx,
    {
      organizationId: auth.organizationId,
      actorSubject: identity?.subject ?? auth.memberId,
      actorMemberId: auth.memberId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      before: entry.before,
      after: entry.after,
      traceId: entry.traceId,
    },
    now,
  );
};
