const ddiService = require('../services/ddiService');

/**
 * POST /api/ddi/check  { medicines: ["Warfarin", "Ibuprofen", …] }
 *
 * Local-first DDI checking. Unique unordered pairs only; order-independent.
 */
exports.check = async (req, res) => {
  try {
    const { medicines } = req.body || {};

    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: 'An array of medicine names is required' });
    }

    const result = await ddiService.checkInteractions(medicines);
    res.json(result);
  } catch (err) {
    console.error('[DDI CONTROLLER]', err.message);
    // Never crash the POS on DDI failure — return a safe empty result.
    res.json({
      checked: 0,
      hasInteractions: false,
      alerts: [],
      source: 'UNAVAILABLE',
      error: 'Interaction check temporarily unavailable — pharmacist judgement required.',
    });
  }
};
