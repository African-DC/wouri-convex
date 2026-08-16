const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const LONGUEUR_MAX = 2000;
const VILLE_DEFAUT = "Bouaké";
const SOURCES_CORPUS = new Set([
  "ivr_exact",
  "ivr_fallback",
  "ivr_concept",
  "ivr_semantic",
]);

const secretDeploiement = (nom: string): string | undefined =>
  runtimeEnvironment.process?.env?.[nom];

export const enTetesCors = (request: Request) => ({
  "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

const json = (request: Request, charge: unknown, code = 200) =>
  new Response(JSON.stringify(charge), {
    status: code,
    headers: {
      "Content-Type": "application/json",
      ...enTetesCors(request),
    },
  });

const moteurConfigure = () => {
  const url = secretDeploiement("ENGINE_URL");
  const key = secretDeploiement("ENGINE_API_KEY");
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
};

const audioAbsolu = (engineUrl: string, audioUrl: string | null | undefined) =>
  audioUrl ? new URL(audioUrl, engineUrl).toString() : null;

export function badgeDepuisSource(source: string): string {
  if (SOURCES_CORPUS.has(source)) return "CORPUS_VALIDE";
  if (source.startsWith("deepseek")) return "FALLBACK_OUVERT";
  return "AUTRE";
}

const lireCorps = async (request: Request) => {
  try {
    return { ok: true as const, corps: (await request.json()) as Record<string, unknown> };
  } catch {
    return { ok: false as const };
  }
};

const appelerMoteur = async (
  moteur: { url: string; key: string },
  chemin: string,
  charge: unknown,
) =>
  fetch(`${moteur.url}${chemin}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": moteur.key,
    },
    body: JSON.stringify(charge),
  });

export async function handleEngineSpeak(request: Request): Promise<Response> {
  const moteur = moteurConfigure();
  if (!moteur) {
    return json(request, { error: "engine_unavailable", reason: "not_configured" }, 503);
  }

  const lu = await lireCorps(request);
  if (!lu.ok) return json(request, { error: "invalid_json" }, 400);
  const texte = lu.corps.text;
  if (typeof texte !== "string" || texte.trim().length === 0) {
    return json(request, { error: "text required" }, 400);
  }
  if (texte.length > LONGUEUR_MAX) {
    return json(request, { error: "text too long" }, 400);
  }

  try {
    const reponse = await appelerMoteur(moteur, "/api/tts/", {
      text: texte,
      language: "dioula",
    });
    if (!reponse.ok) {
      return json(request, { error: "engine_error", status: reponse.status }, 502);
    }
    const data = (await reponse.json()) as {
      text?: string;
      audio_url?: string;
      language?: string;
    };
    return json(request, {
      source: "moteur",
      texte: data.text ?? null,
      audioUrl: audioAbsolu(moteur.url, data.audio_url),
      langue: data.language ?? "dioula",
    });
  } catch {
    return json(request, { error: "engine_unreachable" }, 502);
  }
}

const extraireConseil = (
  moteurUrl: string,
  data: Record<string, unknown>,
  via: "demo_agri" | "chat",
) => {
  const meta =
    data.meta && typeof data.meta === "object"
      ? (data.meta as Record<string, unknown>)
      : {};
  const source =
    typeof data.source === "string"
      ? data.source
      : typeof meta.source === "string"
        ? meta.source
        : "unknown";
  const textFr =
    typeof data.text_fr === "string"
      ? data.text_fr
      : typeof data.response === "string"
        ? data.response
        : null;
  const textDioula =
    typeof data.text_dioula === "string"
      ? data.text_dioula
      : typeof data.response_dioula === "string"
        ? data.response_dioula
        : null;
  const audioBrut = typeof data.audio_url === "string" ? data.audio_url : null;
  const intent =
    typeof data.intent === "string"
      ? data.intent
      : typeof meta.intent === "string"
        ? meta.intent
        : null;
  const cultures = Array.isArray(data.cultures)
    ? data.cultures
    : Array.isArray(meta.cultures)
      ? meta.cultures
      : null;

  return {
    text_fr: textFr,
    text_dioula: textDioula,
    audioUrl: audioAbsolu(moteurUrl, audioBrut),
    city: typeof data.city === "string" ? data.city : VILLE_DEFAUT,
    source,
    badge: typeof data.badge === "string" ? data.badge : badgeDepuisSource(source),
    intent,
    cultures,
    via,
  };
};

export async function handleEngineAgri(request: Request): Promise<Response> {
  const moteur = moteurConfigure();
  if (!moteur) {
    return json(request, { error: "engine_unavailable", reason: "not_configured" }, 503);
  }

  const lu = await lireCorps(request);
  if (!lu.ok) return json(request, { error: "invalid_json" }, 400);
  const message = lu.corps.message;
  if (typeof message !== "string" || message.trim().length === 0) {
    return json(request, { error: "message required" }, 400);
  }
  if (message.length > LONGUEUR_MAX) {
    return json(request, { error: "message too long" }, 400);
  }
  const city =
    typeof lu.corps.city === "string" && lu.corps.city.trim().length > 0
      ? lu.corps.city.trim()
      : VILLE_DEFAUT;
  const includeAudio = lu.corps.include_audio !== false;

  try {
    const agri = await appelerMoteur(moteur, "/api/demo/agri", {
      message: message.trim(),
      city,
      include_audio: includeAudio,
    });
    if (agri.ok) {
      const data = (await agri.json()) as Record<string, unknown>;
      return json(request, extraireConseil(moteur.url, data, "demo_agri"));
    }

    if (agri.status === 404) {
      const chat = await appelerMoteur(moteur, "/api/chat/", {
        message: message.trim(),
        city,
        language: "both",
        include_audio: includeAudio,
        user_id: "demo-console",
      });
      if (!chat.ok) {
        return json(request, { error: "engine_error", status: chat.status }, 502);
      }
      const data = (await chat.json()) as Record<string, unknown>;
      return json(request, extraireConseil(moteur.url, data, "chat"));
    }

    return json(request, { error: "engine_error", status: agri.status }, 502);
  } catch {
    return json(request, { error: "engine_unreachable" }, 502);
  }
}
