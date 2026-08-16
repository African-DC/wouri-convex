import { v } from "convex/values";
import { query } from "../_generated/server";
import { authorize, CAPABILITIES } from "../authorization";

// G03 support — a member reads only their own organization's profile,
// entitlements and default zones. The organization is derived from the session.
// §16 — vue plateforme : la liste de toutes les organisations, reservee au role
// qui administre la plateforme. Une organisation cliente n'y a jamais acces :
// elle ne voit que la sienne via getMyOrganization.
export const listOrganizations = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await authorize(ctx, { permission: CAPABILITIES.platformManage });
    const limit = Math.min(args.limit ?? 100, 200);
    const profiles = await ctx.db.query("organizationProfiles").take(limit);

    return Promise.all(
      profiles.map(async (profile) => {
        // Compte borne : suffisant pour la liste, sans scanner un tenant entier.
        const farmers = await ctx.db
          .query("farmers")
          .withIndex("by_organizationId_and_status", (q) =>
            q.eq("organizationId", profile.organizationId).eq("status", "active"),
          )
          .take(501);
        const entitlements = await ctx.db
          .query("organizationEntitlements")
          .withIndex("by_organizationId_and_key", (q) =>
            q.eq("organizationId", profile.organizationId),
          )
          .take(50);
        const maxFarmers = entitlements.find((e) => e.key === "maxFarmers");
        const whatsapp = entitlements.find((e) => e.key === "whatsappEnabled");
        return {
          organizationId: profile.organizationId,
          kind: profile.kind ?? null,
          legalName: profile.legalName ?? null,
          status: profile.status,
          agriculteurs: farmers.length,
          agriculteursPlafonnes: farmers.length > 500,
          maxFarmers: maxFarmers?.limit ?? null,
          whatsappEnabled: Boolean(whatsapp?.enabled),
        };
      }),
    );
  },
});

export const getMyOrganization = query({
  args: {},
  handler: async (ctx) => {
    const auth = await authorize(ctx, {
      permission: CAPABILITIES.organizationRead,
    });
    const profile = await ctx.db
      .query("organizationProfiles")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", auth.organizationId),
      )
      .unique();
    const entitlements = await ctx.db
      .query("organizationEntitlements")
      .withIndex("by_organizationId_and_key", (q) =>
        q.eq("organizationId", auth.organizationId),
      )
      .take(100);
    const defaultZones = await ctx.db
      .query("organizationDefaultZones")
      .withIndex("by_organizationId_and_zoneId", (q) =>
        q.eq("organizationId", auth.organizationId),
      )
      .take(200);
    return {
      organizationId: auth.organizationId,
      profile,
      entitlements: entitlements.map((e) => ({
        key: e.key,
        enabled: e.enabled,
        limit: e.limit,
      })),
      defaultZones: defaultZones.map((z) => z.zoneId),
    };
  },
});
