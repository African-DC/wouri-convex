import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ERROR_TYPES, WouriError } from "../lib/errors";

// ALT-01 — audience targeting + tenant scoping. Every helper takes
// organizationId EXPLICITLY so the public functions stay the only place that
// reads the session, and the resolution is unit-testable in isolation.

// Bound every audience resolution so a large tenant can never blow the
// transaction budget. previewAudience and publishAlert share these ceilings.
const RULE_SCAN_LIMIT = 5000;
const MAX_AUDIENCE = 20000;

// ALT-05 — consent purpose governing outbound alerts. Opt-in is required: a
// farmer with no consent row is NOT part of an audience. Withdrawal therefore
// blocks any further delivery, which is the whole point of the opt-out.
export const ALERT_CONSENT_PURPOSE = "whatsapp_alerts";

// Version en vigueur du texte de consentement pour ce motif. Autorité serveur :
// un client ne doit pas pouvoir attester un accord sous une version qu'il choisit
// (voir recordConsent). Elle changera avec le texte, jamais par l'interface.
export const ALERT_CONSENT_POLICY_VERSION = "v1";

// One index read per farmer: bounded so a huge audience cannot exceed the
// transaction budget. Beyond this we fail closed rather than skip the check.
// This is the REAL ceiling of any diffusion — MAX_AUDIENCE only bounds the
// targeting pass, which does not read consents.
export const CONSENT_CHECK_LIMIT = 2000;

export const audienceKindValidator = v.union(
  v.literal("farmer"),
  v.literal("zone"),
  v.literal("crop"),
  v.literal("group"),
);

export const audienceRuleValidator = v.object({
  kind: audienceKindValidator,
  targetKey: v.string(),
});

export type AudienceRule = { kind: "farmer" | "zone" | "crop" | "group"; targetKey: string };

const resolveZone = async (ctx: QueryCtx, organizationId: string, zoneId: string) => {
  const links = await ctx.db
    .query("farmerZoneLinks")
    .withIndex("by_organizationId_and_zoneId", (q) =>
      q.eq("organizationId", organizationId).eq("zoneId", zoneId),
    )
    .take(RULE_SCAN_LIMIT);
  return links.map((link) => link.farmerId);
};

const resolveCrop = async (ctx: QueryCtx, organizationId: string, cropCode: string) => {
  const links = await ctx.db
    .query("farmerCropLinks")
    .withIndex("by_organizationId_and_cropCode", (q) =>
      q.eq("organizationId", organizationId).eq("cropCode", cropCode),
    )
    .take(RULE_SCAN_LIMIT);
  return links.map((link) => link.farmerId);
};

const resolveGroup = async (ctx: QueryCtx, organizationId: string, targetKey: string) => {
  const groupId = ctx.db.normalizeId("farmerGroups", targetKey);
  if (!groupId) return [];
  const members = await ctx.db
    .query("farmerGroupMembers")
    .withIndex("by_groupId_and_farmerId", (q) => q.eq("groupId", groupId))
    .take(RULE_SCAN_LIMIT);
  // by_groupId_and_farmerId is not org-scoped, so verify tenant on each row.
  return members
    .filter((member) => member.organizationId === organizationId)
    .map((member) => member.farmerId);
};

const resolveFarmer = async (ctx: QueryCtx, organizationId: string, targetKey: string) => {
  const farmerId = ctx.db.normalizeId("farmers", targetKey);
  if (!farmerId) return [];
  const farmer = await ctx.db.get(farmerId);
  if (!farmer || farmer.organizationId !== organizationId) return [];
  return [farmer._id];
};

const resolveRule = async (
  ctx: QueryCtx,
  organizationId: string,
  rule: AudienceRule,
): Promise<Id<"farmers">[]> => {
  switch (rule.kind) {
    case "zone":
      return resolveZone(ctx, organizationId, rule.targetKey);
    case "crop":
      return resolveCrop(ctx, organizationId, rule.targetKey);
    case "group":
      return resolveGroup(ctx, organizationId, rule.targetKey);
    case "farmer":
      return resolveFarmer(ctx, organizationId, rule.targetKey);
  }
};

// ALT-05 — keeps only farmers whose most recent consent for the alert purpose
// is "granted". Absence of a row means no opt-in, so the farmer is excluded:
// silence is never consent.
const filterByConsent = async (
  ctx: QueryCtx,
  farmerIds: Id<"farmers">[],
): Promise<Id<"farmers">[]> => {
  if (farmerIds.length > CONSENT_CHECK_LIMIT) {
    // Failing closed. Sending to an unverified audience would be worse than
    // refusing: the alert leaves the platform and cannot be recalled.
    throw new WouriError(
      ERROR_TYPES.DELIVERY,
      `Audience of ${farmerIds.length} exceeds the ${CONSENT_CHECK_LIMIT} farmers whose consent can be verified in one operation. Narrow the targeting.`,
    );
  }
  const consenting: Id<"farmers">[] = [];
  for (const farmerId of farmerIds) {
    const latest = await ctx.db
      .query("farmerConsents")
      .withIndex("by_farmerId_and_purpose_and_recordedAt", (q) =>
        q.eq("farmerId", farmerId).eq("purpose", ALERT_CONSENT_PURPOSE),
      )
      .order("desc")
      .first();
    if (latest?.state === "granted") consenting.push(farmerId);
  }
  return consenting;
};

// Union of all rules, deduplicated, restricted to farmers of organizationId,
// then restricted again to those who consented. previewAudience and publishAlert
// both go through here, so the previewed count is exactly what gets delivered.
export const resolveAudience = async (
  ctx: QueryCtx,
  organizationId: string,
  rules: AudienceRule[],
): Promise<Id<"farmers">[]> => {
  const seen = new Set<string>();
  const cibles: Id<"farmers">[] = [];
  for (const rule of rules) {
    const farmerIds = await resolveRule(ctx, organizationId, rule);
    for (const farmerId of farmerIds) {
      if (seen.has(farmerId)) continue;
      seen.add(farmerId);
      cibles.push(farmerId);
      // Pas de sortie anticipée sur MAX_AUDIENCE ici : elle transmettait
      // exactement 20 000 identifiants à filterByConsent, qui refuse au-delà de
      // 2 000. La branche ne pouvait donc jamais rendre de valeur, et laissait
      // croire à un plafond dix fois supérieur au plafond réel.
      if (cibles.length > CONSENT_CHECK_LIMIT) break;
    }
    if (cibles.length > CONSENT_CHECK_LIMIT) break;
  }
  return filterByConsent(ctx, cibles);
};

// Same targeting, without the consent filter. Exposed so an operator can see how
// many farmers the rules match and how many of them are reachable: a preview
// showing only the reachable count hides an opt-out problem instead of naming it.
export const resolveTargeted = async (
  ctx: QueryCtx,
  organizationId: string,
  rules: AudienceRule[],
): Promise<Id<"farmers">[]> => {
  const seen = new Set<string>();
  const cibles: Id<"farmers">[] = [];
  for (const rule of rules) {
    const farmerIds = await resolveRule(ctx, organizationId, rule);
    for (const farmerId of farmerIds) {
      if (seen.has(farmerId)) continue;
      seen.add(farmerId);
      cibles.push(farmerId);
      if (cibles.length >= MAX_AUDIENCE) return cibles;
    }
  }
  return cibles;
};
