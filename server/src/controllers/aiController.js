const aiService = require('../services/aiService');
const ddiService = require('../services/ddiService');

/*
 * AI AUTOFILL
 * Assisted suggestions only — the client displays them for review and the
 * user decides what to keep. The response is honestly labelled with its
 * source (GOOGLE_GEMINI or LOCAL_FALLBACK) and never pretends fallback
 * text came from Gemini.
 */
exports.autofill = async (req, res) => {
  try {
    const { name, dosage_form } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Medicine name is required for AI autofill' });
    }

    const data = await aiService.autofillMedicineDetails(String(name).trim(), dosage_form);
    res.json(data);
  } catch (err) {
    console.error('[AI AUTOFILL CONTROLLER]', err.message);
    // Structured failure — frontend shows "AI temporarily unavailable" and
    // lets the user continue manually. Never a raw 500 crash.
    res.status(503).json({
      error: 'AI autofill is temporarily unavailable. You can continue filling the form manually.',
      source: 'UNAVAILABLE',
      ai_available: false,
    });
  }
};

/*
 * AI STATUS
 * Secret-free diagnostic for staff / deployment debugging: tells you whether a
 * credential is present, what kind it is (permanent API key vs short-lived
 * OAuth token) and which model will be used. It NEVER returns the key itself.
 */
exports.status = async (req, res) => {
  const status = aiService.describeAiStatus();
  res.json({
    ...status,
    ready: status.configured && status.credential_is_permanent_api_key,
    checked_at: new Date().toISOString(),
  });
};

/*
 * LEGACY interaction endpoint — now backed by the LOCAL DDI dataset so any
 * existing callers get deterministic, auditable results instead of asking
 * an AI model to invent interactions.
 */
exports.checkInteractions = async (req, res) => {
  try {
    const { medicines } = req.body;
    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: 'Array of medicines is required' });
    }

    const names = medicines.map((m) =>
      typeof m === 'string' ? m : (m.generic_name || m.brand_name || '')
    );

    const result = await ddiService.checkInteractions(names);

    // Backward-compatible shape used by older POS builds.
    res.json({
      hasInteractions: result.hasInteractions,
      warnings: result.alerts.map((a) => ({
        severity: a.severity === 1 ? 'CRITICAL' : a.severity === 2 ? 'HIGH' : 'MODERATE',
        title: `${a.drugs.join(' + ')}`,
        warning: a.clinical_effect || a.title,
        action: a.recommended_action || null,
        involvedDrugs: a.drugs,
      })),
      checkedCount: result.checked,
      alerts: result.alerts,
      source: result.source,
    });
  } catch (err) {
    console.error('[DDI LEGACY]', err.message);
    res.json({
      hasInteractions: false,
      warnings: [],
      checkedCount: 0,
      alerts: [],
      source: 'UNAVAILABLE',
      error: 'Interaction check temporarily unavailable.',
    });
  }
};
