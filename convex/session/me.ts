import { query } from "../_generated/server";
import { authorize, CAPABILITIES } from "../authorization";

// Socle du shell role-aware de la WOURI Console.
//
// Une seule requete fournit tout ce dont l'interface a besoin pour se composer :
// l'organisation active (deduite de la session, jamais d'un parametre), son
// profil, les capabilities effectives du membre, ses perimetres accordes, les
// entitlements du plan et l'environnement. Le menu, les gardes d'affichage et le
// badge d'environnement en decoulent.
//
// L'affichage n'est PAS l'autorisation : chaque fonction sensible re-verifie ses
// droits cote serveur. Ces capabilities servent a ne pas proposer a l'ecran ce
// qui serait de toute facon refuse.

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

export const me = query({
  args: {},
  handler: async (ctx) => {
    const auth = await authorize(ctx, {
      permission: CAPABILITIES.organizationRead,
    });
    const identity = await ctx.auth.getUserIdentity();

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

    const grants = await ctx.db
      .query("membershipScopeGrants")
      .withIndex("by_organizationId_and_memberId", (q) =>
        q.eq("organizationId", auth.organizationId).eq("memberId", auth.memberId),
      )
      .take(200);

    return {
      user: {
        subject: identity?.subject ?? null,
        name: (identity?.name as string | undefined) ?? null,
        email: (identity?.email as string | undefined) ?? null,
      },
      membership: {
        memberId: auth.memberId,
        rolePolicyId: auth.rolePolicyId,
      },
      organization: {
        id: auth.organizationId,
        kind: profile?.kind ?? null,
        legalName: profile?.legalName ?? null,
        status: profile?.status ?? null,
      },
      // Verite d'affichage du menu et des gardes cote console.
      capabilities: auth.permissions,
      // Perimetres restreints (zone, culture, groupe) le cas echeant.
      scopes: grants.map((grant) => ({
        type: grant.scopeType,
        key: grant.scopeKey,
        ...(grant.expiresAt === undefined ? {} : { expiresAt: grant.expiresAt }),
      })),
      entitlements: entitlements.map((entitlement) => ({
        key: entitlement.key,
        enabled: entitlement.enabled,
        limit: entitlement.limit,
      })),
      // Alimente le bandeau d'environnement : la production ne doit jamais
      // ressembler au staging au moment d'une action critique.
      environment:
        runtimeEnvironment.process?.env?.WOURI_ENV ?? "development",
    };
  },
});
