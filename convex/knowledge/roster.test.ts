/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  createDocument,
  createSource,
  createSourceVersion,
  listSourceRosterVisibleToOrg,
} from "./model";

const modules = import.meta.glob("./../**/*.ts");

describe("roster sources", () => {
  it("expose l autorite, la version et le nombre de documents, pas le localisateur", async () => {
    const t = convexTest(schema, modules);
    const page = await t.run(async (ctx) => {
      const sourceId = await createSource(ctx, {
        visibility: "global",
        authority: "SODEXAM",
        license: "CC-BY",
        canonicalLocator: "demo://sodexam/bulletin",
      });
      const versionId = await createSourceVersion(ctx, {
        sourceId,
        version: "demo-v1",
        contentHash: "hash-1",
        acquiredAt: 1000,
        acquisitionMethod: "seed",
      });
      await createDocument(ctx, {
        sourceVersionId: versionId,
        title: "Bulletin",
        locator: "doc-1",
        language: "fr",
        mimeType: "text/plain",
        contentHash: "doc-hash",
      });
      return listSourceRosterVisibleToOrg(ctx, "org-a");
    });

    expect(page).toHaveLength(1);
    expect(page[0]).not.toHaveProperty("canonicalLocator");
    expect(page[0]?.authority).toBe("SODEXAM");
    expect(page[0]?.latestVersion).toBe("demo-v1");
    expect(page[0]?.documentCount).toBe(1);
  });
});
