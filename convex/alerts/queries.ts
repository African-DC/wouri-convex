import { v } from "convex/values";
import { query } from "../_generated/server";
import { authorize, authorizeResource, CAPABILITIES } from "../authorization";
import {
  alertStatusValidator,
  audienceRuleValidator,
  getAlertDetail,
  listAlertsForOrg,
  resolveAudience,
  resolveTargeted,
} from "./model";

const PREVIEW_SAMPLE_SIZE = 25;

// ALT-02 / ALT-05 — audience preview before sending. Shares resolveAudience with
// publishAlert, so `count` is exactly what will be delivered. `targeted` is the
// same targeting without the consent filter: the difference between the two is
// the number of farmers the rules match but who have not opted in. Showing only
// the reachable count would hide an opt-out problem instead of naming it.
// Creates no deliveries.
export const previewAudience = query({
  args: { rules: v.array(audienceRuleValidator) },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.alertsCreate });
    const targeted = await resolveTargeted(ctx, auth.organizationId, args.rules);
    const farmerIds = await resolveAudience(ctx, auth.organizationId, args.rules);
    return {
      count: farmerIds.length,
      targeted: targeted.length,
      withoutConsent: targeted.length - farmerIds.length,
      sample: farmerIds.slice(0, PREVIEW_SAMPLE_SIZE),
    };
  },
});

// ALT-01 — list this organization's alerts, most recent first, optionally
// filtered by status. Bounded server-side.
export const listAlerts = query({
  args: {
    status: v.optional(alertStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.alertsRead });
    return listAlertsForOrg(ctx, auth.organizationId, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  },
});

// ALT-01 — full detail for one alert: the alert, its audience rules, and a
// per-state summary of its deliveries. authorizeResource enforces tenant scope.
export const getAlert = query({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const { resource } = await authorizeResource(ctx, args.alertId, {
      permission: CAPABILITIES.alertsRead,
    });
    return getAlertDetail(ctx, resource);
  },
});
