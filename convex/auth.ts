import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

const localOrigin = "http://localhost:3000";

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const configuredOrigin = () =>
  runtimeEnvironment.process?.env?.SITE_URL ?? localOrigin;

// Flag EXPLICITE de la connexion email/mot de passe.
//
// Auparavant l'activation etait deduite de `SITE_URL === localhost`, ce qui
// produisait un verrouillage silencieux : des qu'un environnement posait
// SITE_URL, la seule methode de connexion disparaissait et, aucun autre
// fournisseur n'etant configure, plus personne ne pouvait se connecter.
// Un environnement decide desormais explicitement, et le defaut reste sur pour
// un deploiement non configure (ferme hors developpement local).
const emailPasswordEnabled = () => {
  const flag = runtimeEnvironment.process?.env?.AUTH_EMAIL_PASSWORD_ENABLED;
  if (flag !== undefined) return flag === "true" || flag === "1";
  return configuredOrigin() === localOrigin;
};

// La Console est un espace institutionnel : un compte y est cree par
// rattachement a une organisation, pas par auto-inscription. L'ouverture reste
// possible pour amorcer un environnement (comptes de demonstration), mais elle
// doit etre demandee explicitement, et le defaut est ferme.
const selfSignUpEnabled = () => {
  const flag = runtimeEnvironment.process?.env?.AUTH_SELF_SIGNUP_ENABLED;
  if (flag !== undefined) return flag === "true" || flag === "1";
  return configuredOrigin() === localOrigin;
};

const authFunctions: AuthFunctions = internal.auth;

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    authFunctions,
    local: { schema: authSchema },
    triggers: {
      user: {
        onCreate: async (ctx, user) => {
          await ctx.runMutation(internal.authBootstrap.claimFirstAdcAdmin, {
            userId: user._id,
          });
        },
      },
      organization: {
        onCreate: async (ctx, organization) => {
          const existing = await ctx.db
            .query("organizationProfiles")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", organization._id),
            )
            .unique();
          if (existing) return;
          await ctx.db.insert("organizationProfiles", {
            organizationId: organization._id,
            legalName: organization.name,
            status: "provisioning",
          });
        },
      },
    },
  },
);

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: configuredOrigin(),
    trustedOrigins: [configuredOrigin()],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: emailPasswordEnabled(),
      // L'inscription n'est pas pilotee par un flag statique : Better Auth
      // evalue disableSignUp au demarrage. Le vrai garde-fou est le hook
      // ci-dessous : premier utilisateur seulement, sauf ouverture explicite.
      disableSignUp: false,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    hooks: {
      before: createAuthMiddleware(async (hookCtx) => {
        const path = hookCtx.path ?? "";
        if (!path.includes("/sign-up/email")) return;
        if (selfSignUpEnabled()) return;
        const adapter = hookCtx.context.adapter;
        const users = await adapter.findMany({
          model: "user",
          limit: 1,
        });
        if (Array.isArray(users) && users.length > 0) {
          throw new APIError("FORBIDDEN", {
            message: "Email and password sign up is not enabled",
          });
        }
      }),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        creatorRole: "owner",
      }),
      convex({ authConfig }),
    ],
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
