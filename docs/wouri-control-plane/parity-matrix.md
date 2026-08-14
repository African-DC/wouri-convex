# Capability Registry et Parity Matrix

Document **généré** par `node tools/registry/build.mjs`. Ne pas le modifier à
la main : il serait faux au premier commit suivant. Le générateur échoue si
une fonction publique n'est pas classée en risque, pour qu'aucune surface
n'entre sans décision explicite.

Fonctions publiques recensées : **62**. Capacités déclarées : **22**.

## Classes de risque et politique d'exposition

| Classe | Console | CLI | MCP | Audit | Dry-run | Confirmation |
| --- | --- | --- | --- | --- | --- | --- |
| READ | oui | oui | oui | — | — | — |
| SAFE_WRITE | oui | oui | possible | oui | oui | — |
| SENSITIVE_WRITE | oui + confirmation | --dry-run obligatoire | préparation seulement | oui | oui | oui |
| DESTRUCTIVE | protégée | protégé | interdit | oui | oui | oui |
| SYSTEM_CRITICAL | ADC uniquement | protégé | interdit | oui | oui | oui |

## Capacités et rôles

| Capacité | Fonctions | Préréglages qui la portent |
| --- | --- | --- |
| `platform.manage` | 2 | aucun |
| `organization.read` | 2 | sodexamOperator, cnraOperator, clientAdmin, clientOperator, linguist |
| `organization.manage` | 0 | clientAdmin |
| `organization.members.manage` | 0 | clientAdmin |
| `entitlements.manage` | 0 | aucun |
| `farmers.read` | 5 | clientAdmin, clientOperator |
| `farmers.write` | 6 | clientAdmin, clientOperator |
| `consents.write` | 2 | clientAdmin |
| `alerts.create` | 3 | sodexamOperator, cnraOperator, clientAdmin |
| `alerts.publish` | 1 | sodexamOperator, cnraOperator, clientAdmin |
| `alerts.read` | 5 | sodexamOperator, cnraOperator, clientAdmin, clientOperator |
| `weather.publish` | 1 | sodexamOperator |
| `sources.publish` | 2 | sodexamOperator, cnraOperator |
| `knowledge.ingest` | 1 | cnraOperator |
| `knowledge.publish` | 0 | cnraOperator |
| `knowledge.read` | 6 | sodexamOperator, cnraOperator, clientAdmin, clientOperator, linguist |
| `analytics.read` | 0 | sodexamOperator, cnraOperator, clientAdmin, clientOperator |
| `linguistic.validate` | 7 | linguist |
| `aiops.read` | 7 | aucun |
| `aiops.replay` | 3 | aucun |
| `featureflags.manage` | 8 | aucun |
| `audit.read` | 1 | aucun |

## Matrice de parité

Colonne Console renseignée depuis le code du dépôt `wouri-console`.

| Fonction | Type | Capacité | Risque | Console | CLI/MCP |
| --- | --- | --- | --- | --- | --- |
| `aiops/auditread:listAuditLogs` | query | `audit.read` | READ | oui | — |
| `aiops/flags:listFlags` | query | `featureflags.manage` | READ | oui | — |
| `aiops/flags:setFlag` | mutation | `featureflags.manage` | SENSITIVE_WRITE | — | — |
| `aiops/health:health` | query | `aiops.read` | READ | — | oui |
| `aiops/registry:activateModelConfig` | mutation | `featureflags.manage` | SENSITIVE_WRITE | — | — |
| `aiops/registry:activatePolicyVersion` | mutation | `featureflags.manage` | SENSITIVE_WRITE | — | — |
| `aiops/registry:activatePromptVersion` | mutation | `featureflags.manage` | SENSITIVE_WRITE | — | — |
| `aiops/registry:createModelConfig` | mutation | `featureflags.manage` | SAFE_WRITE | — | — |
| `aiops/registry:createPolicyVersion` | mutation | `featureflags.manage` | SAFE_WRITE | — | — |
| `aiops/registry:createPromptVersion` | mutation | `featureflags.manage` | SAFE_WRITE | — | — |
| `aiops/registry:getActiveModelConfig` | query | `aiops.read` | READ | — | — |
| `aiops/registry:getActivePolicy` | query | `aiops.read` | READ | — | — |
| `aiops/registry:getActivePrompt` | query | `aiops.read` | READ | — | — |
| `aiops/replay:captureReplaySnapshot` | mutation | `aiops.replay` | SAFE_WRITE | — | — |
| `aiops/replay:getReplaySnapshot` | query | `aiops.replay` | READ | — | — |
| `aiops/replay:listReplaySnapshots` | query | `aiops.replay` | READ | — | — |
| `aiops/traces:getTrace` | query | `aiops.read` | READ | oui | oui |
| `aiops/traces:listErrors` | query | `aiops.read` | READ | oui | oui |
| `aiops/traces:listTraces` | query | `aiops.read` | READ | oui | oui |
| `alerts/mutations:addAlertAudienceRule` | mutation | `alerts.create` | SAFE_WRITE | oui | — |
| `alerts/mutations:createAlert` | mutation | `alerts.create` | SAFE_WRITE | oui | — |
| `alerts/mutations:publishAlert` | mutation | `alerts.publish` | SENSITIVE_WRITE | oui | — |
| `alerts/queries:getAlert` | query | `alerts.read` | READ | oui | — |
| `alerts/queries:listAlerts` | query | `alerts.read` | READ | oui | — |
| `alerts/queries:previewAudience` | query | `alerts.create` | READ | oui | — |
| `conversations/queries:getConversationContext` | query | `alerts.read` | READ | oui | oui |
| `conversations/queries:listConversationMessages` | query | `alerts.read` | READ | — | — |
| `conversations/queries:listConversations` | query | `alerts.read` | READ | oui | — |
| `farmers/mutations:addFarmerToGroup` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:createFarmerGroup` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:linkFarmerCrop` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:linkFarmerZone` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:recordConsent` | mutation | `consents.write` | SENSITIVE_WRITE | — | — |
| `farmers/mutations:registerFarmer` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:upsertFarmerProfile` | mutation | `farmers.write` | SAFE_WRITE | — | — |
| `farmers/mutations:withdrawConsent` | mutation | `consents.write` | SENSITIVE_WRITE | — | — |
| `farmers/queries:getFarmer` | query | `farmers.read` | READ | — | — |
| `farmers/queries:getFarmerProfile` | query | `farmers.read` | READ | — | — |
| `farmers/queries:listFarmerGroups` | query | `farmers.read` | READ | — | — |
| `farmers/queries:listFarmers` | query | `farmers.read` | READ | oui | — |
| `knowledge/ingest:ingestDocument` | action | `knowledge.ingest` | SENSITIVE_WRITE | — | — |
| `knowledge/mutations:createKnowledgeSource` | mutation | `sources.publish` | SAFE_WRITE | — | — |
| `knowledge/mutations:createKnowledgeSourceVersion` | mutation | `sources.publish` | SENSITIVE_WRITE | — | — |
| `knowledge/queries:getProvenance` | query | `knowledge.read` | READ | — | oui |
| `knowledge/queries:listKnowledgeSources` | query | `knowledge.read` | READ | oui | oui |
| `language/fastPath:listApprovedPhrases` | query | `knowledge.read` | READ | oui | oui |
| `language/fastPath:promoteToApprovedPhrase` | mutation | `linguistic.validate` | SENSITIVE_WRITE | — | — |
| `language/feedback:listFeedback` | query | `linguistic.validate` | READ | oui | — |
| `language/feedback:setFeedbackStatus` | mutation | `linguistic.validate` | SAFE_WRITE | oui | — |
| `language/feedback:submitFeedback` | mutation | `linguistic.validate` | SAFE_WRITE | oui | — |
| `language/importCorpus:importCorpus` | mutation | `linguistic.validate` | SENSITIVE_WRITE | oui | — |
| `language/promote:promoteToCorpus` | mutation | `linguistic.validate` | SENSITIVE_WRITE | oui | — |
| `language/promote:promoteToGlossary` | mutation | `linguistic.validate` | SENSITIVE_WRITE | oui | — |
| `organizations/provisioning:activateOrganization` | mutation | `platform.manage` | SENSITIVE_WRITE | — | — |
| `organizations/queries:getMyOrganization` | query | `organization.read` | READ | — | — |
| `organizations/queries:listOrganizations` | query | `platform.manage` | READ | oui | — |
| `pipeline/answer:answerFarmerQuestion` | action | `knowledge.read` | SAFE_WRITE | — | — |
| `session/me:me` | query | `organization.read` | READ | oui | — |
| `tools/getFarmerProfile:getFarmerProfile` | query | `farmers.read` | READ | — | — |
| `tools/getWeather:getWeather` | action | `knowledge.read` | READ | — | — |
| `tools/searchKnowledge:searchKnowledge` | action | `knowledge.read` | READ | — | — |
| `weather/mutations:publishWeatherObservation` | mutation | `weather.publish` | SENSITIVE_WRITE | — | — |

## Fonctions orphelines

Exposées par le backend, atteignables depuis aucune interface. Chacune est
soit un trou du Control Plane, soit une surface à retirer.

**36** sur 62.

| Fonction | Risque |
| --- | --- |
| `aiops/flags:setFlag` | SENSITIVE_WRITE |
| `aiops/registry:activateModelConfig` | SENSITIVE_WRITE |
| `aiops/registry:activatePolicyVersion` | SENSITIVE_WRITE |
| `aiops/registry:activatePromptVersion` | SENSITIVE_WRITE |
| `aiops/registry:createModelConfig` | SAFE_WRITE |
| `aiops/registry:createPolicyVersion` | SAFE_WRITE |
| `aiops/registry:createPromptVersion` | SAFE_WRITE |
| `aiops/registry:getActiveModelConfig` | READ |
| `aiops/registry:getActivePolicy` | READ |
| `aiops/registry:getActivePrompt` | READ |
| `aiops/replay:captureReplaySnapshot` | SAFE_WRITE |
| `aiops/replay:getReplaySnapshot` | READ |
| `aiops/replay:listReplaySnapshots` | READ |
| `conversations/queries:listConversationMessages` | READ |
| `farmers/mutations:addFarmerToGroup` | SAFE_WRITE |
| `farmers/mutations:createFarmerGroup` | SAFE_WRITE |
| `farmers/mutations:linkFarmerCrop` | SAFE_WRITE |
| `farmers/mutations:linkFarmerZone` | SAFE_WRITE |
| `farmers/mutations:recordConsent` | SENSITIVE_WRITE |
| `farmers/mutations:registerFarmer` | SAFE_WRITE |
| `farmers/mutations:upsertFarmerProfile` | SAFE_WRITE |
| `farmers/mutations:withdrawConsent` | SENSITIVE_WRITE |
| `farmers/queries:getFarmer` | READ |
| `farmers/queries:getFarmerProfile` | READ |
| `farmers/queries:listFarmerGroups` | READ |
| `knowledge/ingest:ingestDocument` | SENSITIVE_WRITE |
| `knowledge/mutations:createKnowledgeSource` | SAFE_WRITE |
| `knowledge/mutations:createKnowledgeSourceVersion` | SENSITIVE_WRITE |
| `language/fastPath:promoteToApprovedPhrase` | SENSITIVE_WRITE |
| `organizations/provisioning:activateOrganization` | SENSITIVE_WRITE |
| `organizations/queries:getMyOrganization` | READ |
| `pipeline/answer:answerFarmerQuestion` | SAFE_WRITE |
| `tools/getFarmerProfile:getFarmerProfile` | READ |
| `tools/getWeather:getWeather` | READ |
| `tools/searchKnowledge:searchKnowledge` | READ |
| `weather/mutations:publishWeatherObservation` | SENSITIVE_WRITE |

## Surface de diagnostic (CLI et MCP)

La CLI et le serveur MCP partagent une seule surface, en lecture seule, dont
le préfixe est vérifié en code et non seulement documenté (DEV-04).

Outils exposés : `health`, `traces`, `trace`, `errors`, `sources`, `corpus`, `conversation`.

