/**
 * Classement de risque des opérations du Control Plane (§7).
 *
 * Le risque est un jugement, pas une propriété dérivable du code : il est donc
 * déclaré ici, une fois, et le générateur de matrice vérifie que toute fonction
 * publique y figure. Une fonction non classée fait échouer la génération plutôt
 * que d'être silencieusement traitée comme anodine.
 *
 * Classes :
 *   READ             lecture, aucun effet de bord
 *   SAFE_WRITE       écriture réversible, périmètre restreint, pas de diffusion
 *   SENSITIVE_WRITE  effet visible hors de la plateforme, ou changement de
 *                    comportement d'exécution : exige confirmation et audit
 *   DESTRUCTIVE      perte d'accès ou de données
 *   SYSTEM_CRITICAL  affecte tous les tenants
 *
 * Politique d'exposition par classe, appliquée par le générateur :
 *   READ             Console oui, CLI oui, MCP oui
 *   SAFE_WRITE       Console oui, CLI oui (--dry-run), MCP possible
 *   SENSITIVE_WRITE  Console oui + confirmation, CLI --dry-run obligatoire,
 *                    MCP en préparation seulement (jamais d'exécution directe)
 *   DESTRUCTIVE      Console très protégée, CLI protégé, MCP interdit
 *   SYSTEM_CRITICAL  Console ADC uniquement, CLI protégé, MCP interdit
 */

export const CLASSES = {
  READ: {
    console: "oui",
    cli: "oui",
    mcp: "oui",
    audit: false,
    dryRun: false,
    confirmation: false,
  },
  SAFE_WRITE: {
    console: "oui",
    cli: "oui",
    mcp: "possible",
    audit: true,
    dryRun: true,
    confirmation: false,
  },
  SENSITIVE_WRITE: {
    console: "oui + confirmation",
    cli: "--dry-run obligatoire",
    mcp: "préparation seulement",
    audit: true,
    dryRun: true,
    confirmation: true,
  },
  DESTRUCTIVE: {
    console: "protégée",
    cli: "protégé",
    mcp: "interdit",
    audit: true,
    dryRun: true,
    confirmation: true,
  },
  SYSTEM_CRITICAL: {
    console: "ADC uniquement",
    cli: "protégé",
    mcp: "interdit",
    audit: true,
    dryRun: true,
    confirmation: true,
  },
};

/** Fonction publique -> classe de risque. Clé : `chemin:nom`. */
export const RISQUES = {
  // Session et organisations
  "session/me:me": "READ",
  "organizations/queries:listOrganizations": "READ",
  "organizations/queries:getMyOrganization": "READ",
  "organizations/provisioning:activateOrganization": "SENSITIVE_WRITE",

  // Agriculteurs, groupes, consentements
  "farmers/queries:listFarmers": "READ",
  "farmers/queries:getFarmer": "READ",
  "farmers/queries:getFarmerProfile": "READ",
  "farmers/queries:listFarmerGroups": "READ",
  "farmers/mutations:registerFarmer": "SAFE_WRITE",
  "farmers/mutations:upsertFarmerProfile": "SAFE_WRITE",
  "farmers/mutations:linkFarmerZone": "SAFE_WRITE",
  "farmers/mutations:linkFarmerCrop": "SAFE_WRITE",
  "farmers/mutations:createFarmerGroup": "SAFE_WRITE",
  "farmers/mutations:addFarmerToGroup": "SAFE_WRITE",
  // Le consentement conditionne la légalité de toute diffusion : sensible.
  "farmers/mutations:recordConsent": "SENSITIVE_WRITE",
  "farmers/mutations:withdrawConsent": "SENSITIVE_WRITE",

  // Alertes
  "alerts/queries:listAlerts": "READ",
  "alerts/queries:getAlert": "READ",
  "alerts/queries:previewAudience": "READ",
  "alerts/mutations:createAlert": "SAFE_WRITE",
  "alerts/mutations:addAlertAudienceRule": "SAFE_WRITE",
  // Sort de la plateforme vers des téléphones réels : irréversible.
  "alerts/mutations:publishAlert": "SENSITIVE_WRITE",

  // Conversations
  "conversations/queries:listConversations": "READ",
  "conversations/queries:getConversationContext": "READ",
  "conversations/queries:listConversationMessages": "READ",

  // Sources et connaissances
  "knowledge/queries:listKnowledgeSources": "READ",
  "knowledge/queries:getProvenance": "READ",
  "knowledge/mutations:createKnowledgeSource": "SAFE_WRITE",
  // Une nouvelle version devient la référence servie aux agriculteurs.
  "knowledge/mutations:createKnowledgeSourceVersion": "SENSITIVE_WRITE",
  "knowledge/ingest:ingestDocument": "SENSITIVE_WRITE",
  "weather/mutations:publishWeatherObservation": "SENSITIVE_WRITE",

  // Langues et corpus
  "language/feedback:listFeedback": "READ",
  "language/feedback:submitFeedback": "SAFE_WRITE",
  "language/feedback:setFeedbackStatus": "SAFE_WRITE",
  "language/fastPath:listApprovedPhrases": "READ",
  // Une phrase approuvée est servie sans passer par le pipeline : elle devient
  // la parole de WOURI.
  "language/fastPath:promoteToApprovedPhrase": "SENSITIVE_WRITE",
  "language/promote:promoteToGlossary": "SENSITIVE_WRITE",
  "language/promote:promoteToCorpus": "SENSITIVE_WRITE",
  "language/importCorpus:importCorpus": "SENSITIVE_WRITE",

  // AI Ops
  "aiops/health:health": "READ",
  "aiops/traces:listTraces": "READ",
  "aiops/traces:getTrace": "READ",
  "aiops/traces:listErrors": "READ",
  "aiops/auditread:listAuditLogs": "READ",
  "aiops/flags:listFlags": "READ",
  // Change le comportement d'exécution sans redéploiement.
  "aiops/flags:setFlag": "SENSITIVE_WRITE",
  "aiops/registry:getActivePrompt": "READ",
  "aiops/registry:getActivePolicy": "READ",
  "aiops/registry:getActiveModelConfig": "READ",
  "aiops/registry:createPromptVersion": "SAFE_WRITE",
  "aiops/registry:createPolicyVersion": "SAFE_WRITE",
  "aiops/registry:createModelConfig": "SAFE_WRITE",
  "aiops/registry:activatePromptVersion": "SENSITIVE_WRITE",
  "aiops/registry:activatePolicyVersion": "SENSITIVE_WRITE",
  "aiops/registry:activateModelConfig": "SENSITIVE_WRITE",
  "aiops/replay:listReplaySnapshots": "READ",
  "aiops/replay:getReplaySnapshot": "READ",
  "aiops/replay:captureReplaySnapshot": "SAFE_WRITE",

  // Outils métier et pipeline
  "tools/getFarmerProfile:getFarmerProfile": "READ",
  "tools/getWeather:getWeather": "READ",
  "tools/searchKnowledge:searchKnowledge": "READ",
  // Consomme un modèle et écrit une trace : réversible mais coûteux.
  "pipeline/answer:answerFarmerQuestion": "SAFE_WRITE",
};
