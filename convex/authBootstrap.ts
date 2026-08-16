import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { components, internal } from "./_generated/api";

const ADC_SLUG = "adc";
const ADC_NAME = "African Digit Consulting";

type BetterAuthRecord = {
  _id: string;
  [key: string]: unknown;
};

// Premier utilisateur seulement : si la table user est vide, la Console peut
// afficher le formulaire ADC. Des qu'un compte existe, l'inscription se ferme.
export const needsBootstrap = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 1, cursor: null },
    });
    return { needed: users.page.length === 0 };
  },
});

// Reserve au trigger Better Auth. Refuse tout sauf le tout premier utilisateur.
export const claimFirstAdcAdmin = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 2, cursor: null },
    });
    if (users.page.length !== 1) return { claimed: false as const };
    const onlyUser = users.page[0] as BetterAuthRecord | undefined;
    if (!onlyUser || onlyUser._id !== args.userId) {
      return { claimed: false as const };
    }

    const existingOrg = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "organization",
      where: [{ field: "slug", value: ADC_SLUG }],
    });
    const organization =
      (existingOrg as BetterAuthRecord | null) ??
      ((await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "organization",
          data: {
            name: ADC_NAME,
            slug: ADC_SLUG,
            createdAt: Date.now(),
          },
        },
      })) as BetterAuthRecord);
    const organizationId = organization._id;

    const existingMember = await ctx.runQuery(
      components.betterAuth.adapter.findOne,
      {
        model: "member",
        where: [
          { field: "organizationId", value: organizationId },
          { field: "userId", value: args.userId },
        ],
      },
    );
    const member =
      (existingMember as BetterAuthRecord | null) ??
      ((await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "member",
          data: {
            organizationId,
            userId: args.userId,
            role: "owner",
            createdAt: Date.now(),
          },
        },
      })) as BetterAuthRecord);

    const sessions = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "session",
      where: [{ field: "userId", value: args.userId }],
      paginationOpts: { numItems: 20, cursor: null },
    });
    for (const session of sessions.page as BetterAuthRecord[]) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: "session",
          where: [{ field: "_id", value: session._id }],
          update: { activeOrganizationId: organizationId },
        },
      });
    }

    await ctx.runMutation(internal.organizations.provisioning.provisionOrganization, {
      organizationId,
      kind: "adc",
      legalName: ADC_NAME,
    });
    await ctx.runMutation(internal.organizations.provisioning.assignMemberRole, {
      organizationId,
      memberId: member._id,
      rolePolicyKey: "adcAdmin",
    });

    return {
      claimed: true as const,
      organizationId,
      memberId: member._id,
    };
  },
});
