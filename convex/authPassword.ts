import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";

export const resetCredentialPassword = internalMutation({
  args: {
    email: v.string(),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: args.email }],
    });
    if (!user) throw new Error(`Aucun utilisateur ${args.email}`);
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "userId", value: user._id as string },
        { field: "providerId", value: "credential" },
      ],
    });
    if (!account) throw new Error(`Aucun compte mot de passe pour ${args.email}`);
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "account",
        where: [{ field: "_id", value: account._id as string }],
        update: { password: args.passwordHash, updatedAt: Date.now() },
      },
    });
    return { email: args.email, accountId: account._id };
  },
});
