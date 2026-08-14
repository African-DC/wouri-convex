import type { QueryCtx } from "../_generated/server";
import {
  getActiveModelConfigVersion,
  getActivePolicyVersion,
  getActivePromptVersion,
} from "../aiops/registry";
import { DEFAULT_REGISTRY_KEYS } from "./registryKeys";

// AI-05 / G11 — « une trace référence une version exacte ».
//
// L'appelant qui ouvre une trace n'a pas à connaître les versions en vigueur :
// elles sont résolues ici, au démarrage de l'exécution. Sans cela chaque trace
// arrivait avec des champs vides, la fiche affichait « — » et le registre ne
// renvoyait à rien, ce qui rend un incident non rejouable.
//
// Une version déjà fournie par l'appelant est respectée : un rejeu doit pouvoir
// imposer une configuration précise plutôt que celle du moment.

export type RegistryStamp = {
  promptKey?: string;
  promptVersion?: number;
  policyKey?: string;
  policyVersion?: number;
  modelConfigKey?: string;
  modelConfigVersion?: number;
};

export const resolveRegistryStamp = async (
  ctx: QueryCtx,
  fourni: RegistryStamp,
): Promise<RegistryStamp> => {
  const [prompt, policy, model] = await Promise.all([
    fourni.promptKey === undefined
      ? getActivePromptVersion(ctx, DEFAULT_REGISTRY_KEYS.prompt)
      : null,
    fourni.policyKey === undefined
      ? getActivePolicyVersion(ctx, DEFAULT_REGISTRY_KEYS.policy)
      : null,
    fourni.modelConfigKey === undefined
      ? getActiveModelConfigVersion(ctx, DEFAULT_REGISTRY_KEYS.model)
      : null,
  ]);
  return {
    ...fourni,
    ...(prompt ? { promptKey: prompt.key, promptVersion: prompt.version } : {}),
    ...(policy ? { policyKey: policy.key, policyVersion: policy.version } : {}),
    ...(model
      ? { modelConfigKey: model.key, modelConfigVersion: model.version }
      : {}),
  };
};
