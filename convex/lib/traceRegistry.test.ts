/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { DEFAULT_REGISTRY_KEYS } from "./registryKeys";
import { resolveRegistryStamp } from "./traceRegistry";

const modules = import.meta.glob("./../**/*.ts");

// AI-05 / G11 — « une trace référence une version exacte ». Le pipeline n'avait
// pas à connaître ces versions et ne les passait donc pas : chaque trace
// arrivait avec des champs vides, la fiche d'exécution affichait « — » et le
// registre ne renvoyait à rien. Un incident n'était pas rejouable, ce qui est
// tout l'objet de la porte.
describe("versions de registre portées par la trace", () => {
  const semerRegistres = async (
    ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
  ) => {
    await ctx.db.insert("promptVersions", {
      key: DEFAULT_REGISTRY_KEYS.prompt,
      version: 3,
      template: "consigne",
      status: "active",
      createdAt: 1,
    });
    await ctx.db.insert("policyVersions", {
      key: DEFAULT_REGISTRY_KEYS.policy,
      version: 2,
      definition: "{}",
      status: "active",
      createdAt: 1,
    });
    await ctx.db.insert("modelConfigs", {
      key: DEFAULT_REGISTRY_KEYS.model,
      version: 5,
      provider: "openrouter",
      model: "un-modele",
      status: "active",
      createdAt: 1,
    });
  };

  it("estampille la version active de chaque registre", async () => {
    const t = convexTest(schema, modules);
    await t.run(semerRegistres);
    const trace = await t.run((ctx) => resolveRegistryStamp(ctx, {}));
    expect(trace?.promptVersion).toBe(3);
    expect(trace?.policyVersion).toBe(2);
    expect(trace?.modelConfigVersion).toBe(5);
    expect(trace?.promptKey).toBe(DEFAULT_REGISTRY_KEYS.prompt);
  });

  it("ignore une version retirée et retient celle qui est active", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await semerRegistres(ctx);
      // Une version plus récente mais retirée ne doit pas être servie.
      await ctx.db.insert("promptVersions", {
        key: DEFAULT_REGISTRY_KEYS.prompt,
        version: 4,
        template: "consigne retiree",
        status: "retired",
        createdAt: 2,
      });
    });
    const trace = await t.run((ctx) => resolveRegistryStamp(ctx, {}));
    expect(trace?.promptVersion).toBe(3);
  });

  it("n'écrase pas une version explicitement fournie par l'appelant", async () => {
    const t = convexTest(schema, modules);
    await t.run(semerRegistres);
    const trace = await t.run((ctx) => resolveRegistryStamp(ctx, {
      promptKey: "autre.prompt",
      promptVersion: 99,
    }));
    expect(trace?.promptKey).toBe("autre.prompt");
    expect(trace?.promptVersion).toBe(99);
    // Les registres non précisés restent résolus automatiquement.
    expect(trace?.policyVersion).toBe(2);
  });

  it("laisse les champs vides quand aucun registre n'est peuplé", async () => {
    const t = convexTest(schema, modules);
    const trace = await t.run((ctx) => resolveRegistryStamp(ctx, {}));
    // On ne bloque pas une exécution parce qu'un registre n'est pas initialisé :
    // une trace sans version reste une trace, et l'écran affiche l'absence.
    expect(trace.promptVersion).toBeUndefined();
    expect(trace.policyVersion).toBeUndefined();
    expect(trace.modelConfigVersion).toBeUndefined();
  });
});
