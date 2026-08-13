import { listMessages } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { components } from "../_generated/api";
import { authorize, authorizeResource, CAPABILITIES } from "../authorization";
import * as model from "./model";

// Inbox de la console. Paginee et scopee a l'organisation de la session : une
// organisation ne voit jamais les conversations d'une autre, meme en devinant un
// identifiant. Enrichie du minimum necessaire a la liste (langue, canal, alerte
// d'origine) pour eviter une requete par ligne cote client.
export const listConversations = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("closed"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, { permission: CAPABILITIES.alertsRead });
    const page = await ctx.db
      .query("conversationContexts")
      .withIndex("by_organizationId_and_status_and_lastActivityAt", (q) =>
        args.status
          ? q.eq("organizationId", auth.organizationId).eq("status", args.status)
          : q.eq("organizationId", auth.organizationId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...page,
      page: page.page.map((context) => ({
        id: context._id,
        farmerId: context.farmerId,
        channel: context.channel,
        preferredLanguage: context.preferredLanguage,
        status: context.status,
        lastActivityAt: context.lastActivityAt,
        originAlertId: context.originAlertId ?? null,
      })),
    };
  },
});

// G05 — proves the conversation recovers its originating alert without the
// farmer repeating it. authorizeResource confirms the context belongs to the
// caller's organization.
export const getConversationContext = query({
  args: { contextId: v.id("conversationContexts") },
  handler: async (ctx, args) => {
    const { authorization } = await authorizeResource(ctx, args.contextId, {
      permission: CAPABILITIES.alertsRead,
    });
    return model.resolveAlertContext(
      ctx,
      authorization.organizationId,
      args.contextId,
    );
  },
});

export const listConversationMessages = query({
  args: {
    contextId: v.id("conversationContexts"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { resource: context } = await authorizeResource(ctx, args.contextId, {
      permission: CAPABILITIES.alertsRead,
    });
    return listMessages(ctx, components.agent, {
      threadId: context.agentThreadId,
      paginationOpts: args.paginationOpts,
    });
  },
});
