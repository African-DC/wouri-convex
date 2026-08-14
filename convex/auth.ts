import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
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
      organization: {
        onCreate: async (ctx, organization) => {
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
      disableSignUp: !selfSignUpEnabled(),
      minPasswordLength: 12,
      requireEmailVerification: false,
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
