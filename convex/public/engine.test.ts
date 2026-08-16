import { describe, expect, it } from "vitest";
import { badgeDepuisSource } from "./engine";

describe("badge moteur agri", () => {
  it("marque le corpus IVR comme CORPUS_VALIDE", () => {
    expect(badgeDepuisSource("ivr_exact")).toBe("CORPUS_VALIDE");
    expect(badgeDepuisSource("ivr_concept")).toBe("CORPUS_VALIDE");
  });

  it("marque DeepSeek comme FALLBACK_OUVERT", () => {
    expect(badgeDepuisSource("deepseek_open")).toBe("FALLBACK_OUVERT");
  });

  it("ne maquille pas une source inconnue", () => {
    expect(badgeDepuisSource("nllb")).toBe("AUTRE");
  });
});
