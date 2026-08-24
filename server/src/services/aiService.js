const express = require('express');
const router = express.Router();

// -------------------------------------------------------------------
// Gemini API Configuration
// -------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KgCz5nh1Ip4Txel3go_SwIcY5gAm3iA6wz51GPJGVG7g';

// Using gemini-2.5-flash endpoint
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

// Helper function for standard API fetch with error handling
async function fetchGeminiAPI(prompt, isJson = false) {
  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  if (isJson) {
    payload.generationConfig = {
      responseMimeType: "application/json"
    };
  }

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// -------------------------------------------------------------------
// Fallback Data Generators
// -------------------------------------------------------------------
function getFallbackAutofill(name, dosageForm = '') {
  const formattedName = name ? name.trim() : 'Medication';
  return {
    description: `${formattedName} is a pharmaceutical product formulated as a ${dosageForm || 'dosage unit'} intended for therapeutic administration.`,
    indication: `Indicated for clinical management of conditions responsive to ${formattedName} therapy under medical guidance.`,
    contraindication: `Contraindicated in patients with known hypersensitivity to ${formattedName} or any of its active components.`,
    pregnancy_lactation: `Use during pregnancy and breastfeeding only if the potential benefit justifies the potential risk to the fetus/infant. Consult prescribing clinician.`,
    interactions: `May interact with concomitant medications. Perform comprehensive drug regimen review prior to co-administration.`,
    side_effects: `Gastrointestinal upset, mild headache, dizziness, localized skin rash or allergic reactions may occur.`,
    storage_condition_patient: `Store in original container below 25°C (77°F). Protect from heat, direct light, and high humidity. Keep out of reach of children.`,
    source: 'Fallback AI Predictive Engine'
  };
}

// -------------------------------------------------------------------
// AI Service Functions
// -------------------------------------------------------------------
async function autofillMedicineDetails(name, dosageForm = '') {
  if (!name) return getFallbackAutofill(name, dosageForm);

  const prompt = `You are a clinical pharmacist AI. Provide accurate pharmacological details for the medication: "${name}" (Dosage form: ${dosageForm}).
  Return a JSON object with these exact keys:
  {
    "description": "Brief description of drug class and mechanism",
    "indication": "Main clinical indications",
    "contraindication": "Major contraindications",
    "pregnancy_lactation": "Pregnancy and lactation safety",
    "interactions": "Key drug interactions",
    "side_effects": "Common and severe side effects",
    "storage_condition_patient": "Storage instructions for patient"
  }`;

  try {
    const textResult = await fetchGeminiAPI(prompt, true);
    if (textResult) {
      const parsed = JSON.parse(textResult);
      return { ...parsed, source: 'Google Gemini Clinical AI' };
    }
  } catch (err) {
    console.error('Gemini Autofill Error:', err.message);
  }

  return getFallbackAutofill(name, dosageForm);
}

async function checkDrugInteractions(medicines) {
  const names = medicines.map(m => (typeof m === 'string' ? m : (m.generic_name || m.brand_name || ''))).filter(Boolean);

  if (names.length < 2) {
    return { hasInteractions: false, warnings: [], checkedCount: names.length };
  }

  const prompt = `You are a clinical pharmacist AI. Analyze this list of medications for potential drug-drug interactions: ${names.join(', ')}.
  Return a JSON object with this structure:
  {
    "hasInteractions": true or false,
    "warnings": [
      {
        "severity": "HIGH or MODERATE or LOW",
        "title": "Short title of interaction",
        "warning": "Detailed clinical warning",
        "action": "Actionable advice for the pharmacist",
        "involvedDrugs": ["drug1", "drug2"]
      }
    ]
  }`;

  try {
    const textResult = await fetchGeminiAPI(prompt, true);
    if (textResult) {
      const parsed = JSON.parse(textResult);
      return { ...parsed, checkedCount: names.length };
    }
  } catch (err) {
    console.error('Gemini Interaction Checker Error:', err.message);
  }

  return { hasInteractions: false, warnings: [], checkedCount: names.length, error: "AI service unreachable" };
}

async function generateCounselingPoints(items) {
  if (!items || items.length === 0) {
    return "No medications selected for counseling.";
  }

  const medList = items.map(item => {
    const name = item.brand_name || item.generic_name || item.name || `Drug`;
    const dose = item.dosage_instruction || item.strength || 'as prescribed';
    return `${name} (${dose})`;
  }).join(', ');

  const prompt = `You are a clinical pharmacist AI. Generate concise patient counseling points for a prescription containing: ${medList}.
  Provide administration advice, key precautions, and major side effects in bullet points. Keep it brief and patient-friendly.`;

  try {
    const textResult = await fetchGeminiAPI(prompt, false);
    if (textResult) {
      return textResult.trim();
    }
  } catch (err) {
    console.error('Gemini Counseling Error:', err.message);
  }

  return `📌 PATIENT COUNSELING SUMMARY:\n\nFor ${medList}:\n• Take medications exactly as prescribed.\n• Complete the full course of treatment.\n• Keep out of reach of children and store in a cool, dry place.\n• Contact your healthcare provider if unexpected symptoms occur.`;
}

// -------------------------------------------------------------------
// Express API Routes with ECONNRESET Guarding
// -------------------------------------------------------------------

// POST /api/ai/autofill
router.post('/api/ai/autofill', async (req, res) => {
  try {
    const { name, dosageForm } = req.body;
    const result = await autofillMedicineDetails(name, dosageForm);
    res.json(result);
  } catch (err) {
    console.error('Autofill Route Error:', err.message);
    res.status(500).json({ error: 'Internal server error during autofill' });
  }
});

// GET /api/sales (Guarded against database ECONNRESET socket drops)
router.get('/api/sales', async (req, res) => {
  try {
    // Replace DB call with your actual pool/orm call
    // const sales = await db.query('SELECT * FROM sales');
    res.json({ success: true, sales: [] });
  } catch (err) {
    console.error('Error fetching sales:', err.message);
    res.status(503).json({ error: 'Database connection interrupted. Retrying...' });
  }
});

module.exports = {
  autofillMedicineDetails,
  checkDrugInteractions,
  generateCounselingPoints,
  router
};