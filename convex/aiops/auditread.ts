import { v } from "convex/values";
import { query } from "../_generated/server";
import { authorize, CAPABILITIES } from "../authorization";
import { clampLimit, scopeOrganization } from "./shared";

// §31 — read access to the audit trail. Requires auditRead AND tenant scoping:
// only the platform operator may read across organizations (see ./shared).

export const listAuditLogs = query({
  args: {
    organizationId: v.optional(v.string()),
    action: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.auditRead });
    const limit = clampLimit(args.limit);
    const scope = await scopeOrganization(ctx, auth, args.organizationId);

    if (scope === undefined) {
      // Opérateur plateforme sans organisation cible : vue transverse. Sans
      // action, on lit TOUTES les entrées récentes via by_createdAt. L'ancien
      // code interrogeait organizationId === undefined et ne remontait donc que
      // les entrées sans organisation, c'est-à-dire quasi rien : le journal
      // d'audit paraissait vide alors que c'est son usage par défaut.
      if (args.action === undefined) {
        return ctx.db
          .query("auditLogs")
          .withIndex("by_createdAt")
          .order("desc")
          .take(limit);
      }
      const action = args.action;
      return ctx.db
        .query("auditLogs")
        .withIndex("by_action_and_createdAt", (q) => q.eq("action", action))
        .order("desc")
        .take(limit);
    }

    // Organization-scoped: the action filter narrows, it never widens.
    const entries = await ctx.db
      .query("auditLogs")
      .withIndex("by_organizationId_and_createdAt", (q) =>
        q.eq("organizationId", scope),
      )
      .order("desc")
      .take(limit);
    return args.action === undefined
      ? entries
      : entries.filter((entry) => entry.action === args.action);
  },
});
