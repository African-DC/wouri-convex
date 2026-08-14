// AI-05 — clés de registre utilisées par le pipeline de réponse.
//
// Elles sont ici, hors du seed et hors du pipeline, pour une raison : la trace
// résout la version active de ces clés au démarrage de chaque exécution, et le
// seed crée les versions correspondantes. Si les deux divergeaient, les traces
// référenceraient des versions inexistantes et le registre n'expliquerait plus
// rien.
export const DEFAULT_REGISTRY_KEYS = {
  prompt: "agronomy.answer",
  policy: "evidence.required",
  model: "agronomy.primary",
} as const;
