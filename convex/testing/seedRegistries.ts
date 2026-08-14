import { internalMutation } from "../_generated/server";
import { guardNotProduction } from "./orgHelpers";
import { DEFAULT_REGISTRY_KEYS } from "../lib/registryKeys";

// AI-05 / G11 — versions initiales des registres de prompt, de politique et de
// modèle.
//
// Le pipeline résout la version ACTIVE de ces clés au démarrage de chaque
// exécution, et la trace la conserve. Sans ces lignes, les traces référençaient
// des versions vides : la fiche d'exécution affichait « — » et le registre
// n'expliquait rien. Une trace qui ne renvoie à aucune configuration précise ne
// permet pas de rejouer un incident, ce qui est tout l'objet de la porte G11.
//
// Idempotente, et refusée en production : ces contenus sont des versions de
// démonstration, pas les consignes réelles.

const PROMPT = `Tu réponds à un agriculteur ivoirien.
Tu ne réponds que si une source institutionnelle le permet.
Si aucune source ne couvre la question, tu le dis clairement.
Tu réponds dans la langue de la question, en phrases courtes.`;

const POLICY = JSON.stringify(
  {
    requireSource: true,
    maxSourceAgeDays: 30,
    abstainWhenNoEvidence: true,
    abstentionMessageKey: "insufficient_evidence",
  },
  null,
  2,
);

export const seedRegistries = internalMutation({
  args: {},
  handler: async (ctx) => {
    guardNotProduction();
    const now = Date.now();
    const cree: string[] = [];

    const existePrompt = await ctx.db
      .query("promptVersions")
      .withIndex("by_key_and_version", (q) =>
        q.eq("key", DEFAULT_REGISTRY_KEYS.prompt).eq("version", 1),
      )
      .unique();
    if (!existePrompt) {
      await ctx.db.insert("promptVersions", {
        key: DEFAULT_REGISTRY_KEYS.prompt,
        version: 1,
        template: PROMPT,
        status: "active",
        createdAt: now,
      });
      cree.push("prompt");
    }

    const existePolicy = await ctx.db
      .query("policyVersions")
      .withIndex("by_key_and_version", (q) =>
        q.eq("key", DEFAULT_REGISTRY_KEYS.policy).eq("version", 1),
      )
      .unique();
    if (!existePolicy) {
      await ctx.db.insert("policyVersions", {
        key: DEFAULT_REGISTRY_KEYS.policy,
        version: 1,
        definition: POLICY,
        status: "active",
        createdAt: now,
      });
      cree.push("policy");
    }

    const existeModel = await ctx.db
      .query("modelConfigs")
      .withIndex("by_key_and_version", (q) =>
        q.eq("key", DEFAULT_REGISTRY_KEYS.model).eq("version", 1),
      )
      .unique();
    if (!existeModel) {
      await ctx.db.insert("modelConfigs", {
        key: DEFAULT_REGISTRY_KEYS.model,
        version: 1,
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        // Paramètres uniquement. Aucune clé d'API ici, ni nulle part en base.
        parameters: JSON.stringify({ temperature: 0.2, maxOutputTokens: 600 }),
        status: "active",
        createdAt: now,
      });
      cree.push("model");
    }

    return { cree, inchanges: 3 - cree.length };
  },
});
