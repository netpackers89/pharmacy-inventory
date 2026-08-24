/**
 * aiService.js
 *
 * Google Gemini integration for NET-PHARMA.
 *
 * Authentication notes (root-cause of the previous 401
 * ACCESS_TOKEN_TYPE_UNSUPPORTED):
 *   - The Generative Language API expects an API KEY, never an OAuth bearer
 *     token. We send the key via the `x-goog-api-key` HEADER (recommended)
 *     instead of concatenating it into the URL, and we validate the format
 *     before calling so an OAuth token pasted into GEMINI_API_KEY produces a
 *     clear configuration error instead of a cryptic 401.
 *   - All requests have a hard timeout so the UI never hangs.
 *   - On ANY failure the service returns an honest fallback:
 *     { ..., source: 'LOCAL_FALLBACK', ai_available: false }.
 *     We NEVER fabricate output and claim Gemini produced it.
 */

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);

// API keys look like "AIza…"; OAuth tokens start with "ya29." — reject those early.
const looksLikeApiKey = (key) => /^AIza[\w-]{20,}$/.test(key) || /^[A-Za-z0-9_-]{30,}$/.test(key);
const isOAuthToken = (key) => /^ya29\./.test(key) || /^EAA/.test(key);

class AiConfigError extends Error {}
class AiUnavailableError extends Error {}

async function fetchGeminiAPI(prompt, { isJson = false } = {}) {
  if (!GEMINI_API_KEY) {
    throw new AiConfigError('GEMINI_API_KEY is not configured on the server.');
  }
  if (isOAuthToken(GEMINI_API_KEY)) {
    throw new AiConfigError(
      'GEMINI_API_KEY contains an OAuth access token. Provide a Generative Language API key (starts with "AIza…") instead.'
    );
  }
  if (!looksLikeApiKey(GEMINI_API_KEY)) {
    throw new AiConfigError('GEMINI_API_KEY does not look like a valid API key.');
  }

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      ...(isJson ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new AiUnavailableError('AI request timed out.');
    throw new AiUnavailableError('AI service is unreachable.');
  }
  clearTimeout(timer);

  if (!response.ok) {
    const status = response.status;
    let detail = '';
    try { detail = (await response.text()).slice(0, 300); } catch (_) {}

    if (status === 401 || status === 403) {
      throw new AiConfigError(`Gemini rejected the API key (${status}). ${detail}`);
    }
    if (status === 429) {
      throw new AiUnavailableError('AI rate limit reached. Try again shortly.');
    }
    throw new AiUnavailableError(`Gemini error ${status}. ${detail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  if (!text) throw new AiUnavailableError('AI returned an empty response.');
  return text;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Local structured fallback — clearly labelled, generic safety text only.
 * This is NOT presented as AI output; the client shows it as
 * "AI unavailable — local template" so staff know to verify manually.
 * ────────────────────────────────────────────────────────────────────────── */
function getLocalFallback(name, dosageForm = '') {
  const formattedName = name ? name.trim() : 'Medication';
  return {
    description: `${formattedName} is a pharmaceutical product formulated as a ${dosageForm || 'dosage unit'} intended for therapeutic administration under professional supervision.`,
    indication: `Indicated for clinical management of conditions responsive to ${formattedName} therapy, as directed by the prescriber.`,
    contraindication: `Contraindicated in patients with known hypersensitivity to ${formattedName} or any component of the formulation. Review the full product literature before use.`,
    pregnancy_lactation: `Use during pregnancy or breastfeeding only if the potential benefit justifies the potential risk. Consult the prescribing clinician.`,
    interactions: `May interact with other medications. Perform a complete drug-regimen review before co-administration.`,
    side_effects: `Possible side effects include gastrointestinal upset, headache, dizziness, or allergic reactions. Refer to the approved product information for the full list.`,
    storage_condition_patient: `Store in the original container below 25°C, protected from moisture and direct light. Keep out of reach of children.`,
    source: 'LOCAL_FALLBACK',
    ai_available: false,
  };
}

async function parseJsonResponse(prompt) {
  const textResult = await fetchGeminiAPI(prompt, { isJson: true });
  try {
    return JSON.parse(textResult);
  } catch (_) {
    // Tolerate fenced code blocks
    const cleaned = String(textResult).replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }
}

/* ── Autofill ── */
async function autofillMedicineDetails(name, dosageForm = '') {
  if (!name) return getLocalFallback(name, dosageForm);

  const prompt = `You are a clinical pharmacist reference assistant. Using established pharmacology for "${name}" (dosage form: ${dosageForm}), return ONLY a JSON object with exactly these keys:
{
  "description": "Brief description of drug class and mechanism",
  "indication": "Main clinical indications",
  "contraindication": "Major contraindications",
  "pregnancy_lactation": "Pregnancy and lactation safety",
  "interactions": "Key drug interactions",
  "side_effects": "Common side effects",
  "storage_condition_patient": "Storage instructions for patients"
}
Do not invent dosages. Do not add extra keys.`;

  try {
    const parsed = await parseJsonResponse(prompt);
    return {
      ...getLocalFallback(name, dosageForm),
      ...parsed,
      source: 'GOOGLE_GEMINI',
      ai_available: true,
    };
  } catch (err) {
    console.error('[AI AUTOFILL]', err.message);
    const fallback = getLocalFallback(name, dosageForm);
    fallback.fallback_reason =
      err instanceof AiConfigError
        ? 'AI is not configured correctly on this server.'
        : 'AI autofill is temporarily unavailable.';
    return fallback;
  }
}

module.exports = {
  autofillMedicineDetails,
  fetchGeminiAPI,
};
