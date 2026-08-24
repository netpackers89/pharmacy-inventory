const aiService = require('../services/aiService');

exports.autofill = async (req, res) => {
  try {
    const { name, dosage_form } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Medicine name is required for AI autofill' });
    }

    const data = await aiService.autofillMedicineDetails(name, dosage_form);
    res.json(data);
  } catch (err) {
    console.error('AI autofill error:', err);
    res.status(500).json({ error: 'Failed to process AI autofill' });
  }
};

exports.checkInteractions = async (req, res) => {
  try {
    const { medicines } = req.body; // Array of medicine objects or names
    if (!medicines || !Array.isArray(medicines)) {
      return res.status(400).json({ error: 'Array of medicines is required' });
    }

    if (medicines.length < 2) {
      return res.json({ hasInteractions: false, warnings: [], checkedCount: medicines.length });
    }

    const result = await aiService.checkDrugInteractions(medicines);
    res.json(result);
  } catch (err) {
    console.error('AI interaction check error:', err);
    res.status(500).json({ error: 'Failed to check drug interactions' });
  }
};

exports.generateCounseling = async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Array of cart items is required' });
    }

    const counselingText = await aiService.generateCounselingPoints(items);
    res.json({ counseling_points: counselingText });
  } catch (err) {
    console.error('AI counseling error:', err);
    res.status(500).json({ error: 'Failed to generate counseling points' });
  }
};
