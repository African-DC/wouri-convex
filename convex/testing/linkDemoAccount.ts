import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { ROLE_PRESETS } from "../authz/capabilities";
import { ensureLinguistPolicy } from "./orgHelpers";

// §65 — comptes de demonstration relies a de vraies organisations.
//
// Le seed cree des profils WOURI avec des identifiants synthetiques
// (demo-adc, demo-coop-a...). Une session Better Auth, elle, porte
// l'identifiant GENERE de l'organisation. Sans pont, un utilisateur qui se
// connecte n'a donc aucune organisation reconnue par authorize().
//
// Cette action cree l'organisation cote Better Auth, rattache l'utilisateur
// comme membre, active la session sur cette organisation, puis provisionne le
// profil WOURI et la politique de role sur l'identifiant REEL. Les deux mondes
// partagent enfin la meme cle.
//
// Reservee au staging : elle ecrit des donnees de demonstration.

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const organizationKind = v.union(
  v.literal("adc"),
  v.literal("sodexam"),
  v.literal("cnra"),
  v.literal("cooperative"),
  v.literal("ngo"),
  v.literal("other"),
);

export const linkDemoAccount = internalAction({
  args: {
    email: v.string(),
    organizationName: v.string(),
    organizationSlug: v.string(),
    kind: organizationKind,
    rolePolicyKey: v.string(),
    defaultZoneIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const env = runtimeEnvironment.process?.env ?? {};
    if (env.WOURI_ENV === "production") {
      throw new Error("Comptes de demonstration refuses en production.");
    }
    if (!(args.rolePolicyKey in ROLE_PRESETS)) {
      throw new Error(`Politique de role inconnue : ${args.rolePolicyKey}`);
    }

    // 1. L'utilisateur doit deja exister (cree par inscription dans la console).
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: args.email }],
    });
    if (!user) {
      throw new Error(
        `Aucun utilisateur avec l'adresse ${args.email}. Creer d'abord le compte depuis la console.`,
      );
    }

    // 2. Organisation Better Auth : reutilisee si le slug existe deja.
    const existingOrg = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "organization",
      where: [{ field: "slug", value: args.organizationSlug }],
    });
    const organization =
      existingOrg ??
      (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "organization",
          data: {
            name: args.organizationName,
            slug: args.organizationSlug,
            createdAt: Date.now(),
          },
        },
      }));
    const organizationId = organization._id as string;

    // 3. Adhesion : le membre porte l'identifiant reel de l'organisation.
    const existingMember = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "member",
        where: [
          { field: "organizationId", value: organizationId },
          { field: "userId", value: user._id as string },
        ],
      },
    );
    const member =
      existingMember ??
      (await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "member",
          data: {
            organizationId,
            userId: user._id as string,
            role: "owner",
            createdAt: Date.now(),
          },
        },
      }));
    const memberId = member._id as string;

    // 4. Toutes les sessions ouvertes de cet utilisateur pointent sur cette
    //    organisation : sans cela, authorize() ne trouve pas d'organisation active.
    const sessions = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "session",
      where: [{ field: "userId", value: user._id as string }],
      paginationOpts: { numItems: 20, cursor: null },
    });
    for (const session of sessions.page) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "session",
          where: [{ field: "_id", value: (session as { _id: string })._id }],
          update: { activeOrganizationId: organizationId },
        },
      });
    }

    // 5. Cote WOURI : profil, politiques de role et zones par defaut, sur
    //    l'identifiant REEL de l'organisation.
    await ctx.runMutation(internal.organizations.provisioning.provisionOrganization, {
      organizationId,
      kind: args.kind,
      legalName: args.organizationName,
      defaultZoneIds: args.defaultZoneIds,
    });

    // Le role de linguiste n'est cree par aucun preset de type d'organisation :
    // on l'ajoute explicitement quand il est demande.
    if (args.rolePolicyKey === "linguist") {
      await ctx.runMutation(internal.testing.linkDemoAccount.ensureLinguistPolicyFor, {
        organizationId,
      });
    }

    await ctx.runMutation(internal.organizations.provisioning.assignMemberRole, {
      organizationId,
      memberId,
      rolePolicyKey: args.rolePolicyKey,
    });

    return {
      email: args.email,
      organizationId,
      organizationName: args.organizationName,
      memberId,
      rolePolicyKey: args.rolePolicyKey,
      sessionsMisesAJour: sessions.page.length,
    };
  },
});

// Cree la politique "linguist" pour une organisation donnee. Ce role est
// transversal a la plateforme et n'est cree par aucun preset de type
// d'organisation, il doit donc etre ajoute explicitement.
export const ensureLinguistPolicyFor = internalMutation({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => ensureLinguistPolicy(ctx, args.organizationId),
});
