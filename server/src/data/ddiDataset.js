/**
 * ddiDataset.js
 *
 * NET-PHARMA LOCAL DRUG–DRUG INTERACTION FALLBACK DATASET
 *
 * This is a *structured fallback reference dataset*, NOT an infallible
 * clinical authority. It seeds the `ddi_interactions` table so the dataset
 * can be reviewed, corrected and extended in the database later.
 *
 * Severity scale:
 *   1 = Critical  — pharmacist review required before dispensing
 *   2 = High      — review + counseling before dispensing
 *   3 = Moderate  — review; consider counseling/monitoring
 *
 * Matching is ORDER-INDEPENDENT: pairs are stored canonically as
 * (drug_a < drug_b) after normalization.
 */

const RAW_INTERACTIONS = [
  // ── Warfarin ──────────────────────────────────────────────────────────────
  {
    pair: ["Warfarin", "Amiodarone"],
    severity: 1,
    category: "Anticoagulant / Antiarrhythmic",
    mechanism:
      "Amiodarone inhibits CYP2C9 and CYP3A4, reducing warfarin metabolism.",
    clinical_effect: "Significantly increased INR and bleeding risk.",
    recommended_action:
      "Reduce warfarin dose typically 30–50%; monitor INR closely.",
  },
  {
    pair: ["Warfarin", "Fluconazole"],
    severity: 1,
    category: "Anticoagulant / Azole Antifungal",
    mechanism: "Fluconazole inhibits CYP2C9-mediated warfarin metabolism.",
    clinical_effect: "Elevated INR and increased bleeding risk.",
    recommended_action:
      "Monitor INR within 2–3 days of starting; consider warfarin dose reduction.",
  },
  {
    pair: ["Warfarin", "Trimethoprim/Sulfamethoxazole"],
    severity: 1,
    category: "Anticoagulant / Antibiotic",
    aliases: [["TMP/SMX", "Co-trimoxazole", "Bactrim"]],
    mechanism:
      "Sulfamethoxazole inhibits CYP2C9 and displaces warfarin from plasma proteins.",
    clinical_effect: "Increased INR and serious bleeding episodes reported.",
    recommended_action:
      "Prefer an alternative antibiotic if possible; otherwise monitor INR closely.",
  },
  {
    pair: ["Warfarin", "Ibuprofen"],
    severity: 2,
    category: "Anticoagulant / NSAID",
    mechanism:
      "NSAID-induced platelet inhibition plus gastric mucosal injury add to anticoagulation.",
    clinical_effect: "Increased risk of GI bleeding.",
    recommended_action:
      "Avoid concurrent use where possible; recommend paracetamol for pain.",
  },
  {
    pair: ["Warfarin", "Naproxen"],
    severity: 2,
    category: "Anticoagulant / NSAID",
    mechanism: "Additive bleeding risk via platelet effects and GI irritation.",
    clinical_effect: "Increased risk of GI hemorrhage.",
    recommended_action:
      "Use the lowest effective dose or an alternative analgesic; counsel on bleeding signs.",
  },
  {
    pair: ["Warfarin", "Rifampin"],
    severity: 1,
    category: "Anticoagulant / Antitubercular",
    mechanism:
      "Rifampin induces CYP2C9/CYP3A4, accelerating warfarin clearance.",
    clinical_effect:
      "Markedly reduced anticoagulant effect and thrombosis risk.",
    recommended_action:
      "Monitor INR frequently; substantial warfarin dose increases are usually required.",
  },
  {
    pair: ["Warfarin", "Carbamazepine"],
    severity: 1,
    category: "Anticoagulant / Enzyme Inducer",
    mechanism: "Carbamazepine induces warfarin metabolism (CYP2C9/3A4).",
    clinical_effect: "Reduced INR and anticoagulation failure.",
    recommended_action:
      "Monitor INR closely after starting/stopping carbamazepine; adjust warfarin dose.",
  },

  // ── Clopidogrel ───────────────────────────────────────────────────────────
  {
    pair: ["Clopidogrel", "Omeprazole"],
    severity: 2,
    category: "Antiplatelet / PPI",
    mechanism: "Omeprazole inhibits CYP2C19 activation of clopidogrel.",
    clinical_effect:
      "Reduced antiplatelet effect and possible cardiovascular risk.",
    recommended_action:
      "Consider pantoprazole, which has minimal CYP2C19 interaction.",
  },
  {
    pair: ["Clopidogrel", "Esomeprazole"],
    severity: 2,
    category: "Antiplatelet / PPI",
    mechanism: "Esomeprazole inhibits CYP2C19 activation of clopidogrel.",
    clinical_effect: "Reduced antiplatelet effect.",
    recommended_action: "Prefer pantoprazole if acid suppression is needed.",
  },

  // ── DOACs ────────────────────────────────────────────────────────────────
  {
    pair: ["Apixaban", "Ketoconazole"],
    severity: 1,
    category: "DOAC / Azole Antifungal",
    mechanism:
      "Strong combined P-gp/CYP3A4 inhibition raises apixaban exposure.",
    clinical_effect: "Increased bleeding risk.",
    recommended_action:
      "Avoid combination or reduce apixaban dose per protocol.",
  },
  {
    pair: ["Rivaroxaban", "Clarithromycin"],
    severity: 2,
    category: "DOAC / Macrolide",
    mechanism:
      "Clarithromycin inhibits P-gp/CYP3A4, increasing rivaroxaban levels.",
    clinical_effect: "Increased bleeding risk.",
    recommended_action:
      "Use with caution or choose an alternative antibiotic; watch for bleeding.",
  },

  // ── Aspirin ──────────────────────────────────────────────────────────────
  {
    pair: ["Aspirin", "Ibuprofen"],
    severity: 2,
    category: "Antiplatelet / NSAID",
    mechanism:
      "Ibuprofen competitively blocks aspirin\u2019s antiplatelet COX-1 effect.",
    clinical_effect:
      "Reduced cardioprotective effect of aspirin plus added GI risk.",
    recommended_action:
      "Take aspirin at least 2 hours before ibuprofen, or use another analgesic.",
  },

  // ── Digoxin ──────────────────────────────────────────────────────────────
  {
    pair: ["Digoxin", "Amiodarone"],
    severity: 1,
    category: "Cardiac Glycoside / Antiarrhythmic",
    mechanism: "Amiodarone inhibits P-gp, increasing digoxin levels.",
    clinical_effect: "Digoxin toxicity (nausea, arrhythmias, visual changes).",
    recommended_action:
      "Halve digoxin dose when starting amiodarone; monitor levels and ECG.",
  },
  {
    pair: ["Digoxin", "Clarithromycin"],
    severity: 1,
    category: "Cardiac Glycoside / Macrolide",
    mechanism: "P-gp inhibition raises digoxin concentration.",
    clinical_effect: "Digoxin toxicity risk.",
    recommended_action:
      "Consider azithromycin instead; otherwise monitor digoxin levels.",
  },
  {
    pair: ["Digoxin", "Verapamil"],
    severity: 1,
    category: "Cardiac Glycoside / Calcium Channel Blocker",
    mechanism: "Verapamil reduces digoxin renal and biliary clearance.",
    clinical_effect: "Elevated digoxin levels with bradycardia/AV block risk.",
    recommended_action:
      "Monitor digoxin levels, heart rate and ECG; dose reduction often needed.",
  },
  {
    pair: ["Digoxin", "Furosemide"],
    severity: 2,
    category: "Cardiac Glycoside / Loop Diuretic",
    mechanism:
      "Diuretic-induced hypokalemia/hypomagnesemia sensitizes to digoxin toxicity.",
    clinical_effect: "Increased risk of digoxin-related arrhythmias.",
    recommended_action:
      "Monitor potassium/magnesium and renal function regularly.",
  },
  {
    pair: ["Digoxin", "Hydrochlorothiazide"],
    severity: 2,
    category: "Cardiac Glycoside / Thiazide Diuretic",
    mechanism:
      "Thiazide-induced electrolyte loss increases digoxin sensitivity.",
    clinical_effect: "Arrhythmia risk with hypokalemia.",
    recommended_action: "Monitor potassium; supplement when indicated.",
  },

  // ── Nitrates + PDE5 inhibitors ───────────────────────────────────────────
  {
    pair: ["Sildenafil", "Nitroglycerin"],
    severity: 1,
    category: "PDE5 Inhibitor / Nitrate",
    mechanism:
      "Combined NO/cGMP pathway activation causes profound vasodilation.",
    clinical_effect: "Severe, potentially life-threatening hypotension.",
    recommended_action:
      "Absolutely contraindicated within 24 hours of sildenafil.",
  },
  {
    pair: ["Sildenafil", "Isosorbide Mononitrate"],
    severity: 1,
    category: "PDE5 Inhibitor / Nitrate",
    mechanism: "Additive NO-mediated vasodilation.",
    clinical_effect: "Profound hypotension, syncope, cardiovascular collapse.",
    recommended_action: "Contraindicated — do not combine.",
  },
  {
    pair: ["Tadalafil", "Nitroglycerin"],
    severity: 1,
    category: "PDE5 Inhibitor / Nitrate",
    mechanism: "Combined cGMP potentiation causes severe vasodilation.",
    clinical_effect: "Severe hypotension.",
    recommended_action: "Contraindicated within 48 hours of tadalafil.",
  },

  // ── Serotonergic combinations ────────────────────────────────────────────
  {
    pair: ["Phenelzine", "Fluoxetine"],
    severity: 1,
    category: "MAOI / SSRI",
    mechanism:
      "Additive serotonergic activity with impaired serotonin metabolism.",
    clinical_effect:
      "Serotonin syndrome (hyperthermia, agitation, rigidity) — can be fatal.",
    recommended_action:
      "Contraindicated; require a 5-week washout between agents.",
  },
  {
    pair: ["Phenelzine", "Sertraline"],
    severity: 1,
    category: "MAOI / SSRI",
    mechanism: "Excess synaptic serotonin from dual serotonergic action.",
    clinical_effect: "Serotonin syndrome risk.",
    recommended_action: "Contraindicated; allow appropriate washout periods.",
  },
  {
    pair: ["Phenelzine", "Venlafaxine"],
    severity: 1,
    category: "MAOI / SNRI",
    mechanism: "Dual serotonin/norepinephrine reuptake plus MAO inhibition.",
    clinical_effect: "Hypertensive crisis or serotonin syndrome.",
    recommended_action: "Contraindicated combination.",
  },
  {
    pair: ["Linezolid", "Fluoxetine"],
    severity: 1,
    category: "Antibiotic (MAOI-like) / SSRI",
    mechanism:
      "Linezolid is a weak MAO inhibitor; SSRIs raise synaptic serotonin.",
    clinical_effect: "Serotonin syndrome risk.",
    recommended_action:
      "Avoid combination; if essential, start linezolid at reduced SSRI dose with close monitoring.",
  },
  {
    pair: ["Linezolid", "Sertraline"],
    severity: 1,
    category: "Antibiotic (MAOI-like) / SSRI",
    mechanism: "Additive serotonergic effect.",
    clinical_effect: "Serotonin syndrome risk.",
    recommended_action: "Avoid or monitor closely for serotonergic signs.",
  },
  {
    pair: ["Linezolid", "Tramadol"],
    severity: 1,
    category: "Antibiotic (MAOI-like) / Opioid",
    mechanism:
      "Tramadol increases serotonin release; linezolid impairs its breakdown.",
    clinical_effect: "Serotonin syndrome and seizure threshold lowering.",
    recommended_action: "Use alternative analgesia where possible.",
  },

  // ── Lithium + NSAIDs/diuretics/ACE ───────────────────────────────────────
  {
    pair: ["Lithium", "Ibuprofen"],
    severity: 2,
    category: "Mood Stabilizer / NSAID",
    mechanism: "Reduced renal lithium clearance via prostaglandin inhibition.",
    clinical_effect: "Rising lithium levels → toxicity (tremor, confusion).",
    recommended_action:
      "Monitor lithium levels after NSAID initiation; consider paracetamol.",
  },
  {
    pair: ["Lithium", "Naproxen"],
    severity: 2,
    category: "Mood Stabilizer / NSAID",
    mechanism: "NSAID-mediated decrease in lithium renal clearance.",
    clinical_effect: "Lithium accumulation and toxicity.",
    recommended_action: "Avoid chronic NSAID use; monitor lithium level.",
  },
  {
    pair: ["Lithium", "Lisinopril"],
    severity: 2,
    category: "Mood Stabilizer / ACE Inhibitor",
    mechanism: "ACE inhibitors increase proximal tubular lithium reabsorption.",
    clinical_effect: "Elevated lithium levels and toxicity.",
    recommended_action:
      "Check lithium level within a week of starting ACE inhibitor.",
  },
  {
    pair: ["Lithium", "Hydrochlorothiazide"],
    severity: 2,
    category: "Mood Stabilizer / Thiazide",
    mechanism: "Volume depletion raises proximal lithium reabsorption.",
    clinical_effect: "Lithium toxicity risk (~25–40% level rise).",
    recommended_action: "Reduce lithium dose preemptively and monitor levels.",
  },

  // ── Antiepileptics + hormones ────────────────────────────────────────────
  {
    pair: ["Carbamazepine", "Ethinyl Estradiol"],
    severity: 2,
    category: "Enzyme Inducer / Contraceptive",
    mechanism:
      "Induction of estrogen metabolism reduces contraceptive hormone levels.",
    clinical_effect: "Oral contraceptive failure (unplanned pregnancy).",
    recommended_action:
      "Recommend a non-hormonal or higher-dose/barrier method.",
  },
  {
    pair: ["Phenytoin", "Ethinyl Estradiol"],
    severity: 2,
    category: "Enzyme Inducer / Contraceptive",
    mechanism: "CYP induction accelerates estrogen clearance.",
    clinical_effect: "Reduced contraceptive efficacy.",
    recommended_action: "Counsel on backup contraception methods.",
  },
  {
    pair: ["Valproic Acid", "Phenytoin"],
    severity: 2,
    category: "Antiepileptic / Antiepileptic",
    mechanism:
      "Valproate displaces phenytoin from protein and inhibits its metabolism.",
    clinical_effect:
      "Unpredictable free phenytoin levels — either subtherapeutic or toxic.",
    recommended_action: "Monitor free phenytoin levels and seizure control.",
  },

  // ── Statins + strong inhibitors ──────────────────────────────────────────
  {
    pair: ["Simvastatin", "Clarithromycin"],
    severity: 1,
    category: "Statin / Macrolide",
    mechanism:
      "Strong CYP3A4 inhibition raises simvastatin exposure dramatically.",
    clinical_effect: "High risk of myopathy/rhabdomyolysis.",
    recommended_action: "Suspend simvastatin during macrolide course.",
  },
  {
    pair: ["Simvastatin", "Erythromycin"],
    severity: 1,
    category: "Statin / Macrolide",
    mechanism: "CYP3A4 inhibition increases statin concentration.",
    clinical_effect: "Myopathy/rhabdomyolysis risk.",
    recommended_action: "Pause statin therapy during treatment.",
  },
  {
    pair: ["Simvastatin", "Itraconazole"],
    severity: 1,
    category: "Statin / Azole Antifungal",
    mechanism: "Potent CYP3A4 inhibition.",
    clinical_effect: "Marked elevation of statin levels — muscle injury risk.",
    recommended_action:
      "Do not co-administer; resume statin after antifungal course.",
  },
  {
    pair: ["Simvastatin", "Ketoconazole"],
    severity: 1,
    category: "Statin / Azole Antifungal",
    mechanism: "CYP3A4 inhibition raises statin exposure.",
    clinical_effect: "Rhabdomyolysis risk.",
    recommended_action: "Temporarily withhold simvastatin.",
  },
  {
    pair: ["Lovastatin", "Clarithromycin"],
    severity: 1,
    category: "Statin / Macrolide",
    mechanism: "CYP3A4 inhibition greatly increases lovastatin levels.",
    clinical_effect: "Myopathy/rhabdomyolysis.",
    recommended_action: "Withhold lovastatin during clarithromycin therapy.",
  },

  // ── QT prolongation ──────────────────────────────────────────────────────
  {
    pair: ["Moxifloxacin", "Ondansetron"],
    severity: 2,
    category: "Fluoroquinolone / Antiemetic",
    mechanism: "Additive QT interval prolongation.",
    clinical_effect:
      "Risk of torsades de pointes, especially with electrolyte disturbances.",
    recommended_action:
      "Correct K/Mg; consider ECG monitoring or alternative agents.",
  },
  {
    pair: ["Levofloxacin", "Amiodarone"],
    severity: 2,
    category: "Fluoroquinolone / Antiarrhythmic",
    mechanism: "Two QT-prolonging agents combined.",
    clinical_effect: "Torsades de pointes risk.",
    recommended_action: "Avoid if possible; monitor ECG and electrolytes.",
  },

  // ── Other significant interactions ───────────────────────────────────────
  {
    pair: ["Ciprofloxacin", "Tizanidine"],
    severity: 1,
    category: "Fluoroquinolone / Muscle Relaxant",
    mechanism:
      "Ciprofloxacin strongly inhibits CYP1A2, blocking tizanidine clearance.",
    clinical_effect: "Severe hypotension and excessive sedation.",
    recommended_action: "Combination is contraindicated.",
  },
  {
    pair: ["Colchicine", "Clarithromycin"],
    severity: 1,
    category: "Antigout / Macrolide",
    mechanism:
      "P-gp/CYP3A4 inhibition raises colchicine exposure several-fold.",
    clinical_effect:
      "Colchicine toxicity — GI upset, myelosuppression, multiorgan failure.",
    recommended_action: "Avoid combination, especially in renal impairment.",
  },
  {
    pair: ["Tacrolimus", "Diltiazem"],
    severity: 2,
    category: "Immunosuppressant / CCB",
    mechanism: "Diltiazem inhibits CYP3A4, raising tacrolimus troughs.",
    clinical_effect: "Nephrotoxicity and neurotoxicity risk.",
    recommended_action: "Monitor tacrolimus levels and adjust dose.",
  },
  {
    pair: ["Tacrolimus", "Fluconazole"],
    severity: 2,
    category: "Immunosuppressant / Azole",
    mechanism: "CYP3A4 inhibition increases tacrolimus exposure.",
    clinical_effect: "Elevated levels — kidney injury risk.",
    recommended_action: "Reduce tacrolimus dose and monitor troughs.",
  },
  {
    pair: ["Cyclosporine", "Rifampin"],
    severity: 1,
    category: "Immunosuppressant / Enzyme Inducer",
    mechanism: "Rifampin potently induces CYP3A4/P-gp.",
    clinical_effect:
      "Sharp fall in cyclosporine levels → transplant rejection risk.",
    recommended_action:
      "Avoid rifampin or intensify cyclosporine monitoring; seek alternative antibiotic.",
  },
  {
    pair: ["Azathioprine", "Allopurinol"],
    severity: 1,
    category: "Immunosuppressant / Xanthine Oxidase Inhibitor",
    mechanism:
      "Allopurinol blocks xanthine oxidase, preventing azathioprine inactivation.",
    clinical_effect: "Severe myelosuppression.",
    recommended_action:
      "Reduce azathioprine to 25–33% of dose or avoid combination.",
  },
  {
    pair: ["Mercaptopurine", "Allopurinol"],
    severity: 1,
    category: "Antimetabolite / Xanthine Oxidase Inhibitor",
    mechanism:
      "Xanthine oxidase converts mercaptopurine to inactive metabolite; inhibition raises exposure.",
    clinical_effect: "Profound bone marrow suppression.",
    recommended_action: "Cut dose to ~25% under specialist supervision.",
  },
  {
    pair: ["Methotrexate", "Trimethoprim/Sulfamethoxazole"],
    severity: 1,
    category: "Antimetabolite / Antibiotic",
    aliases: [["TMP/SMX", "Co-trimoxazole", "Bactrim"]],
    mechanism:
      "Double antifolate effect plus reduced renal clearance of methotrexate.",
    clinical_effect: "Severe pancytopenia and mucositis.",
    recommended_action: "Combination is contraindicated.",
  },
  {
    pair: ["Methotrexate", "Ibuprofen"],
    severity: 2,
    category: "Antimetabolite / NSAID",
    mechanism:
      "NSAIDs reduce renal methotrexate clearance (high-dose regimens especially).",
    clinical_effect: "Increased methotrexate toxicity risk.",
    recommended_action: "Use cautiously; monitor CBC and renal function.",
  },

  // ── Thyroid ──────────────────────────────────────────────────────────────
  {
    pair: ["Methimazole", "Warfarin"],
    severity: 2,
    category: "Antithyroid / Anticoagulant",
    mechanism:
      "Hyperthyroidism resolution changes vitamin-K-dependent clotting factor turnover.",
    clinical_effect:
      "Enhanced anticoagulant effect as hyperthyroidism resolves.",
    recommended_action:
      "Monitor INR after thyroid status changes; adjust warfarin.",
  },
  {
    pair: ["Levothyroxine", "Ferrous Sulfate"],
    severity: 2,
    category: "Thyroid Hormone / Iron Supplement",
    mechanism: "Iron salts chelate levothyroxine in the GI tract.",
    clinical_effect: "Reduced absorption → hypothyroid symptoms.",
    recommended_action: "Separate doses by at least 4 hours.",
  },
  {
    pair: ["Levothyroxine", "Calcium Carbonate"],
    severity: 2,
    category: "Thyroid Hormone / Mineral Supplement",
    mechanism: "Calcium binds levothyroxine, impairing absorption.",
    clinical_effect: "Lower T4 uptake and rising TSH.",
    recommended_action: "Separate administration by at least 4 hours.",
  },
  {
    pair: ["Levothyroxine", "Sucralfate"],
    severity: 2,
    category: "Thyroid Hormone / Mucosal Protectant",
    mechanism: "Sucralfate binds levothyroxine in the gut.",
    clinical_effect: "Reduced thyroid hormone absorption.",
    recommended_action: "Give levothyroxine fasting; separate by 4+ hours.",
  },

  // ── Absorption interactions ──────────────────────────────────────────────
  {
    pair: ["Fluoroquinolones", "Antacids"],
    severity: 2,
    category: "Antibiotic / Antacid",
    aliases: [["Ciprofloxacin", "Ofloxacin", "Levofloxacin", "Moxifloxacin"]],
    mechanism: "Divalent/trivalent cations chelate fluoroquinolones.",
    clinical_effect: "Subtherapeutic antibiotic levels → treatment failure.",
    recommended_action:
      "Administer antacid 2 hours before or 6 hours after the antibiotic.",
  },
  {
    pair: ["Tetracycline", "Calcium/Iron Supplements"],
    severity: 2,
    category: "Antibiotic / Minerals",
    aliases: [["Doxycycline", "Minocycline"]],
    mechanism: "Polyvalent cations bind tetracyclines in the gut.",
    clinical_effect: "Reduced antibiotic absorption.",
    recommended_action: "Separate dosing times; advise taking with water only.",
  },

  // ── CNS depressants ──────────────────────────────────────────────────────
  {
    pair: ["Morphine", "Diazepam"],
    severity: 1,
    category: "Opioid / Benzodiazepine",
    mechanism:
      "Additive CNS and respiratory depression via different receptors.",
    clinical_effect: "Profound sedation, respiratory depression, death risk.",
    recommended_action:
      "Avoid combination; if unavoidable use lowest doses and monitor respiration.",
  },
  {
    pair: ["Oxycodone", "Alprazolam"],
    severity: 1,
    category: "Opioid / Benzodiazepine",
    mechanism: "Synergistic respiratory depression.",
    clinical_effect: "Overdose and death risk.",
    recommended_action:
      "Boxed-warning combination — avoid unless no alternative exists.",
  },
  {
    pair: ["Tramadol", "Duloxetine"],
    severity: 2,
    category: "Opioid / SNRI",
    mechanism:
      "Both raise serotonergic tone; duloxetine also inhibits CYP2D6 (tramadol activation).",
    clinical_effect: "Serotonin syndrome and lowered seizure threshold.",
    recommended_action:
      "Monitor for serotonergic symptoms; counsel on seizure risk.",
  },
  {
    pair: ["Tramadol", "Carbamazepine"],
    severity: 2,
    category: "Opioid / Enzyme Inducer",
    mechanism:
      "Carbamazepine induces CYP3A4, accelerating tramadol→M1 conversion and clearance.",
    clinical_effect: "Reduced analgesia and increased seizure risk.",
    recommended_action:
      "Assess analgesic effectiveness; avoid in seizure-prone patients.",
  },
  {
    pair: ["Buprenorphine", "Benzodiazepines"],
    severity: 1,
    category: "Opioid / Benzodiazepine Class",
    aliases: [["Diazepam", "Alprazolam", "Lorazepam", "Clonazepam"]],
    mechanism: "Combined CNS/respiratory depression from opioid + benzo.",
    clinical_effect: "Respiratory depression, coma, death.",
    recommended_action:
      "Avoid concurrent prescribing; if necessary use minimum doses with monitoring.",
  },
  {
    pair: ["Zolpidem", "Alcohol"],
    severity: 2,
    category: "Hypnotic / Alcohol",
    aliases: [["Ethanol"]],
    mechanism: "Additive CNS depression.",
    clinical_effect:
      "Excessive sedation, impaired coordination, next-day impairment.",
    recommended_action: "Advise strictly avoiding alcohol with zolpidem.",
  },

  // ── Diabetes ─────────────────────────────────────────────────────────────
  {
    pair: ["Insulin", "Propranolol"],
    severity: 2,
    category: "Antidiabetic / Beta Blocker",
    mechanism:
      "Beta blockade masks adrenergic hypoglycemia warning signs and impairs recovery.",
    clinical_effect: "Severe prolonged hypoglycemia without warning symptoms.",
    recommended_action:
      "Prefer cardioselective agents; educate patient on masked hypoglycemia.",
  },
  {
    pair: ["Glyburide", "Trimethoprim/Sulfamethoxazole"],
    severity: 1,
    category: "Sulfonylurea / Antibiotic",
    aliases: [["TMP/SMX", "Co-trimoxazole", "Bactrim"]],
    mechanism:
      "Sulfonamide displaces glyburide from protein binding and inhibits its metabolism.",
    clinical_effect: "Profound, sometimes prolonged hypoglycemia.",
    recommended_action:
      "Avoid combination; choose an alternative antibiotic and self-monitor glucose.",
  },
  {
    pair: ["Metformin", "Iodinated Contrast"],
    severity: 2,
    category: "Antidiabetic / Imaging Agent",
    mechanism: "Contrast-induced nephropathy can cause metformin accumulation.",
    clinical_effect: "Lactic acidosis risk.",
    recommended_action:
      "Hold metformin at time of contrast and for 48h after; restart once renal function confirmed.",
  },
  {
    pair: ["Metformin", "Cimetidine"],
    severity: 2,
    category: "Antidiabetic / H2 Antagonist",
    mechanism:
      "Cimetidine competes for renal tubular secretion, raising metformin levels.",
    clinical_effect:
      "Increased metformin concentration and lactic acidosis risk.",
    recommended_action:
      "Consider an alternative H2 blocker or monitor renal function/glucose.",
  },
  {
    pair: ["Pioglitazone", "Rifampin"],
    severity: 2,
    category: "Antidiabetic / Enzyme Inducer",
    mechanism:
      "Rifampin induces CYP2C8/3A4, lowering pioglitazone exposure ~50%.",
    clinical_effect: "Reduced glycemic control.",
    recommended_action: "Monitor blood glucose; dose adjustment may be needed.",
  },
  {
    pair: ["Glipizide", "Fluconazole"],
    severity: 2,
    category: "Sulfonylurea / Azole Antifungal",
    mechanism: "CYP2C9 inhibition slows sulfonylurea metabolism.",
    clinical_effect: "Hypoglycemia episodes.",
    recommended_action: "Monitor glucose closely; consider dose reduction.",
  },

  // ── Respiratory ──────────────────────────────────────────────────────────
  {
    pair: ["Theophylline", "Ciprofloxacin"],
    severity: 2,
    category: "Bronchodilator / Fluoroquinolone",
    mechanism: "CYP1A2 inhibition decreases theophylline clearance ~30%.",
    clinical_effect: "Nausea, tremor, seizures, arrhythmias at toxic levels.",
    recommended_action: "Reduce theophylline dose ~30–50% and monitor levels.",
  },
  {
    pair: ["Theophylline", "Erythromycin"],
    severity: 2,
    category: "Bronchodilator / Macrolide",
    mechanism: "Macrolide inhibits theophylline clearance.",
    clinical_effect: "Theophylline toxicity risk.",
    recommended_action: "Monitor theophylline levels during co-administration.",
  },
  {
    pair: ["Theophylline", "Phenytoin"],
    severity: 2,
    category: "Bronchodilator / Antiepileptic",
    mechanism:
      "Bidirectional: phenytoin induces theophylline clearance; theophylline lowers phenytoin levels.",
    clinical_effect: "Loss of efficacy of both drugs.",
    recommended_action: "Monitor levels of both medications and adjust.",
  },
  {
    pair: ["Montelukast", "Phenobarbital"],
    severity: 2,
    category: "Leukotriene Antagonist / Barbiturate",
    mechanism:
      "CYP enzyme induction reduces montelukast area-under-curve ~40%.",
    clinical_effect: "Possible loss of asthma control.",
    recommended_action:
      "Monitor respiratory symptoms; adjust therapy if needed.",
  },

  // ── Cardiovascular combos ────────────────────────────────────────────────
  {
    pair: ["Lisinopril", "Spironolactone"],
    severity: 2,
    category: "ACE Inhibitor / Potassium-Sparing Diuretic",
    mechanism: "Both reduce aldosterone activity and potassium excretion.",
    clinical_effect: "Hyperkalemia risk, especially with renal impairment.",
    recommended_action:
      "Check potassium within 1 week and periodically; avoid salt substitutes.",
  },
  {
    pair: ["Losartan", "Potassium Chloride"],
    severity: 2,
    category: "ARB / Potassium Supplement",
    mechanism: "ARBs blunt aldosterone → reduced potassium excretion.",
    clinical_effect: "Hyperkalemia.",
    recommended_action:
      "Monitor serum potassium; avoid supplements unless documented deficiency.",
  },
  {
    pair: ["Lisinopril", "Losartan"],
    severity: 1,
    category: "ACE Inhibitor / ARB Dual Blockade",
    mechanism:
      "Dual RAAS blockade compounds hypotension, hyperkalemia and renal effects.",
    clinical_effect:
      "Hypotension, acute kidney injury, hyperkalemia — outcomes generally worse.",
    recommended_action: "Do not combine ACE inhibitors with ARBs.",
  },
  {
    pair: ["Amlodipine", "Simvastatin"],
    severity: 2,
    category: "CCB / Statin",
    mechanism:
      "Amlodipine weakly inhibits CYP3A4, modestly raising simvastatin levels.",
    clinical_effect: "Slightly increased myopathy risk.",
    recommended_action: "Limit simvastatin to 20 mg/day or switch statins.",
  },
  {
    pair: ["Clonidine", "Propranolol"],
    severity: 2,
    category: "Central Alpha Agonist / Beta Blocker",
    mechanism:
      "Rebound hypertension on clonidine withdrawal is amplified by non-selective beta blockade.",
    clinical_effect: "Hypertensive crisis if clonidine stopped abruptly.",
    recommended_action:
      "Never stop clonidine abruptly; taper slowly under supervision.",
  },

  // ── Antivirals ───────────────────────────────────────────────────────────
  {
    pair: ["Ritonavir", "Simvastatin"],
    severity: 1,
    category: "Protease Inhibitor / Statin",
    mechanism: "Ritonavir is a very strong CYP3A4 inhibitor.",
    clinical_effect: "Massive statin exposure — rhabdomyolysis risk.",
    recommended_action: "Contraindicated; switch to pravastatin/rosuvastatin.",
  },
  {
    pair: ["Ritonavir", "Sildenafil"],
    severity: 1,
    category: "Protease Inhibitor / PDE5 Inhibitor",
    mechanism:
      "Strong CYP3A4 inhibition raises sildenafil levels several-fold.",
    clinical_effect: "Hypotension, syncope, visual disturbance, priapism.",
    recommended_action: "Limit sildenafil to 25 mg every 48h with monitoring.",
  },
  {
    pair: ["Efavirenz", "Methadone"],
    severity: 2,
    category: "Antiretroviral / Opioid Substitution",
    mechanism: "Efavirenz induces CYP3A4, accelerating methadone clearance.",
    clinical_effect: "Opioid withdrawal symptoms.",
    recommended_action:
      "Monitor withdrawal; methadone dose increase often required.",
  },
  {
    pair: ["Tenofovir", "Ledipasvir/Sofosbuvir"],
    severity: 2,
    category: "Antiretroviral / HCV Regimen",
    mechanism: "HCV direct-acting agents raise tenofovir exposure.",
    clinical_effect: "Renal function deterioration risk.",
    recommended_action: "Monitor creatinine/EGFR closely during co-treatment.",
  },
  {
    pair: ["Voriconazole", "Vincristine"],
    severity: 1,
    category: "Azole / Vinca Alkaloid",
    mechanism: "Voriconazole inhibits CYP3A4-mediated vincristine metabolism.",
    clinical_effect: "Severe neurotoxicity — can be fatal.",
    recommended_action:
      "Contraindicated; consider posaconazole or fluconazole alternatives.",
  },

  // ── GI ───────────────────────────────────────────────────────────────────
  {
    pair: ["Domperidone", "Clarithromycin"],
    severity: 2,
    category: "Prokinetic / Macrolide",
    mechanism:
      "CYP3A4 inhibition raises domperidone levels plus additive QT prolongation.",
    clinical_effect: "Arrhythmia (torsades) risk.",
    recommended_action: "Avoid combination.",
  },
  {
    pair: ["Ondansetron", "Apomorphine"],
    severity: 1,
    category: "Antiemetic / Dopamine Agonist",
    mechanism: "Additive QT prolongation with apomorphine.",
    clinical_effect: "Serious cardiac arrhythmia risk.",
    recommended_action: "Concomitant use is contraindicated.",
  },
  {
    pair: ["Metoclopramide", "Haloperidol"],
    severity: 2,
    category: "Prokinetic / Antipsychotic",
    mechanism: "Both are dopamine antagonists with EPS liability.",
    clinical_effect:
      "Extrapyramidal symptoms, dystonia, tardive dyskinesia risk.",
    recommended_action:
      "Use together only briefly and watch for movement disorders.",
  },
  {
    pair: ["Sucralfate", "Ciprofloxacin"],
    severity: 2,
    category: "Mucosal Protectant / Fluoroquinolone",
    mechanism: "Sucralfate binds fluoroquinolones in the GI lumen.",
    clinical_effect: "Markedly reduced antibiotic absorption.",
    recommended_action:
      "Give sucralfate at least 2 hours apart from the antibiotic.",
  },

  // ── Musculoskeletal ──────────────────────────────────────────────────────
  {
    pair: ["Cyclobenzaprine", "MAOIs"],
    severity: 1,
    category: "Muscle Relaxant / MAO Inhibitors",
    aliases: [["Phenelzine", "Tranylcypromine", "Selegiline"]],
    mechanism: "TCAD-like agent combined with MAO inhibition.",
    clinical_effect: "Serotonin syndrome, hypertensive crisis, seizures.",
    recommended_action:
      "Contraindicated concurrently and within 14 days of MAOI.",
  },
  {
    pair: ["Baclofen", "Amitriptyline"],
    severity: 2,
    category: "Muscle Relaxant / TCA",
    mechanism: "Additive CNS depression and muscle relaxation.",
    clinical_effect:
      "Marked sedation, weakness, fall risk (especially in elderly).",
    recommended_action: "Start low, counsel on sedation and falls.",
  },
  {
    pair: ["Succinylcholine", "Echothiophate"],
    severity: 2,
    category: "Neuromuscular Blocker / Cholinesterase Inhibitor",
    mechanism:
      "Echothiophate inhibits plasma cholinesterase, slowing succinylcholine hydrolysis.",
    clinical_effect: "Prolonged apnea after anesthesia.",
    recommended_action:
      "Inform anesthesiologist of echothiophate eye-drop use.",
  },
  {
    pair: ["Methyldopa", "Levodopa"],
    severity: 2,
    category: "Antihypertensive / Antiparkinsonian",
    mechanism:
      "Methyldopa enhances levodopa effects via decarboxylase pathway interaction.",
    clinical_effect: "Altered Parkinson control and orthostatic hypotension.",
    recommended_action: "Monitor parkinsonian response and blood pressure.",
  },
  {
    pair: ["Selegiline", "Meperidine"],
    severity: 1,
    category: "MAO-B Inhibitor / Opioid",
    mechanism: "Impaired serotonin and catecholamine metabolism.",
    clinical_effect:
      "Agitation, hyperpyrexia, rigidity — potentially fatal excitation syndrome.",
    recommended_action: "Contraindicated; use an alternative opioid analgesic.",
  },
  {
    pair: ["Isotretinoin", "Tetracycline"],
    severity: 1,
    category: "Retinoid / Antibiotic",
    aliases: [["Doxycycline", "Minocycline"]],
    mechanism: "Both can raise intracranial pressure individually.",
    clinical_effect:
      "Idiopathic intracranial hypertension (pseudotumor cerebri).",
    recommended_action:
      "Do not combine; choose an alternate acne/oral antibiotic regimen.",
  },
  {
    pair: ["Varenicline", "Alcohol"],
    severity: 2,
    category: "Smoking Cessation Aid / Alcohol",
    mechanism:
      "May heighten alcohol effects; neuropsychiatric events reported.",
    clinical_effect:
      "Impaired judgment, unusual behavior, intoxication at lower amounts.",
    recommended_action:
      "Advise reducing alcohol or abstaining while on varenicline.",
  },
  {
    pair: ["St John's Wort", "Cyclosporine"],
    severity: 1,
    category: "Herbal / Immunosuppressant",
    mechanism:
      "Potent CYP3A4/P-gp induction drops cyclosporine levels rapidly.",
    clinical_effect: "Acute organ-transplant rejection.",
    recommended_action:
      "Avoid entirely; screen all herbal products in transplant patients.",
  },
  {
    pair: ["St John's Wort", "Warfarin"],
    severity: 2,
    category: "Herbal / Anticoagulant",
    mechanism: "Enzyme induction accelerates warfarin metabolism.",
    clinical_effect:
      "Reduced INR and anticoagulation failure (also rebound on stopping).",
    recommended_action:
      "Discourage use; check INR if patient starts or stops it.",
  },
];

/* ── Normalization & alias support ───────────────────────────────────────── */
const EXTRA_ALIASES = {
  "st johns wort": "st john's wort",
  stjohnswort: "st john's wort",
  hypericum: "st john's wort",
  "tmp-smx": "trimethoprim/sulfamethoxazole",
  cotrimoxazole: "trimethoprim/sulfamethoxazole",
  bactrim: "trimethoprim/sulfamethoxazole",
  septrin: "trimethoprim/sulfamethoxazole",
  ethanol: "alcohol",
};

function normalizeDrugName(name) {
  let n = String(name || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // remove bracketed qualifiers e.g. "(Amoxil)"
    .replace(/[^a-z0-9/' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (EXTRA_ALIASES[n]) return EXTRA_ALIASES[n];

  // Strip dosage tokens: "bactrim 480mg" -> "bactrim"; "ibuprofen 400" -> "ibuprofen"
  n = n
    .replace(/\s*\d+(\.\d+)?\s*(mg|mcg|ug|g|ml|iu|units?)\b/g, "")
    .replace(/\s+\d+(\.\d+)?$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Strip common salt suffixes: "amoxicillin trihydrate" -> "amoxicillin"
  n = n.replace(
    /\s+(trihydrate|monohydrate|sodium|potassium|hcl|hydrochloride|maleate|besylate|tartrate|sulfate)$/,
    "",
  );
  return n;
}

/** Build canonical name set (name + declared aliases), normalized. */
function canonicalSet(entry) {
  const names = [entry.pair[0], entry.pair[1]];
  for (const aliasList of entry.aliases || []) {
    names.push(...aliasList);
  }
  return names.map(normalizeDrugName);
}

module.exports = {
  RAW_INTERACTIONS,
  normalizeDrugName,
  canonicalSet,
};
