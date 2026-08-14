import { defineConfig } from "vitest/config";

// Les tests de l'outillage (CLI, MCP, politique d'accès) tournent sur le runtime
// Node : ils lisent le disque et lancent des processus, ce que l'environnement
// edge du socle Convex ne permet pas. D'où une configuration séparée plutôt
// qu'un mélange qui ferait échouer l'un ou l'autre.
export default defineConfig({
  test: {
    include: ["tools/**/*.test.mjs"],
    environment: "node",
  },
});
