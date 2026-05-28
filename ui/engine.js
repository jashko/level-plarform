// src/engine/finance/config.ts
var SCENARIO_ADJUSTMENTS = {
  base: {
    priceMultiplier: 1,
    costMultiplier: 1,
    salesVelocityMultiplier: 1,
    discountRateDelta: 0,
    pfRateDelta: 0
  },
  optimistic: {
    priceMultiplier: 1.15,
    costMultiplier: 0.95,
    salesVelocityMultiplier: 1.3,
    discountRateDelta: -3,
    pfRateDelta: -2
  },
  stress: {
    priceMultiplier: 0.85,
    costMultiplier: 1.15,
    salesVelocityMultiplier: 0.6,
    discountRateDelta: 3,
    pfRateDelta: 3
  }
};
var SENSITIVITY_DELTAS = [-0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15];
var IRR_NORMALIZATION = {
  floorPct: 15,
  ceilingPct: 40
};
var SUCCESS_PROB_WEIGHTS = {
  cityScore: 0.3,
  districtScore: 0.2,
  siteScore: 0.2,
  financialScore: 0.3
};
var SUCCESS_PROB_PENALTIES = {
  perRedRisk: 5,
  stressIrrNegative: 20,
  confidenceDivisor: 2
};
var DEFAULT_FINANCING_PARAMS = {
  equityShare: 0.2,
  pfBaseRateAnnual: 17,
  pfEscrowCoveredRateAnnual: 9,
  escrowReleaseLagMonths: 2,
  escrowCoverageDiscount: 0.7,
  escrowDiscountActivationProgress: 0.3,
  pfCommitmentFeeAnnual: 1.5,
  pfCommittedLineMultiplier: 1
};

// src/engine/finance/calculations.ts
function calculateVolumes(inputs) {
  const totalBuildableM2 = inputs.landAreaHa * inputs.allowedDensityM2PerHa;
  const sellableM2 = totalBuildableM2 * inputs.sellableRatio;
  const unitCount = Math.floor(sellableM2 / inputs.averageUnitSizeM2);
  return { totalBuildableM2, sellableM2, unitCount };
}
function calculateRevenue(inputs, volumes, scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const pricePerM2 = inputs.basePricePerM2 * adj.priceMultiplier;
  const totalRevenue = volumes.sellableM2 * pricePerM2;
  return { pricePerM2, totalRevenue, scenario };
}
function calculateCapex(inputs, volumes, totalRevenue, scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const land = inputs.landCost;
  const construction = volumes.sellableM2 * inputs.constructionCostPerM2 * adj.costMultiplier;
  const infrastructure = inputs.infrastructureCost;
  const marketing = totalRevenue * inputs.marketingShare;
  const total = land + construction + infrastructure + marketing;
  return { land, construction, infrastructure, marketing, total };
}
function buildMonthlyCashFlow(inputs, volumes, revenue, capex, scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const salesVelocity = inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier;
  const pfBaseRate = inputs.financing.pfBaseRateAnnual + adj.pfRateDelta;
  const pfLowRate = inputs.financing.pfEscrowCoveredRateAnnual;
  const equityCap = capex.total * inputs.financing.equityShare;
  const constructionEndMonth = inputs.constructionMonths;
  const escrowReleaseMonth = constructionEndMonth + inputs.financing.escrowReleaseLagMonths;
  const sellOutMonths = Math.ceil(volumes.sellableM2 / Math.max(salesVelocity, 1));
  const horizon = Math.max(
    escrowReleaseMonth + 6,
    inputs.salesStartMonth + sellOutMonths + 3
  );
  const sCurve = normalizedSCurveWeights(inputs.constructionMonths);
  const flows = [];
  let cumulativeM2 = 0;
  let cumulativeEquity = 0;
  let cumulativeCapexSpent = 0;
  let pfBalance = 0;
  let cumulativePfInterest = 0;
  let escrowBalance = 0;
  let cumulativeDevCash = 0;
  const pfCommittedLine = capex.total * (1 - inputs.financing.equityShare) * inputs.financing.pfCommittedLineMultiplier;
  for (let m = 0; m <= horizon; m++) {
    const landSpend = m === 0 ? capex.land : 0;
    const constructionSpend = m >= 1 && m <= constructionEndMonth ? capex.construction * sCurve[m - 1] : 0;
    const infraSpend = m >= 1 && m <= constructionEndMonth ? capex.infrastructure / constructionEndMonth : 0;
    let m2Sold = 0;
    if (m >= inputs.salesStartMonth && cumulativeM2 < volumes.sellableM2) {
      m2Sold = Math.min(salesVelocity, volumes.sellableM2 - cumulativeM2);
    }
    cumulativeM2 += m2Sold;
    const revenueMonth = m2Sold * revenue.pricePerM2;
    const isDuringConstruction = m <= constructionEndMonth;
    const escrowInflow = isDuringConstruction ? revenueMonth : 0;
    let directInflow = isDuringConstruction ? 0 : revenueMonth;
    const marketingSpend = revenueMonth * inputs.marketingShare;
    const totalSpend = landSpend + constructionSpend + infraSpend + marketingSpend;
    let equityDraw = 0;
    let pfDraw = 0;
    if (totalSpend > 0) {
      const equityRoom = Math.max(0, equityCap - cumulativeEquity);
      equityDraw = Math.min(equityRoom, totalSpend);
      pfDraw = totalSpend - equityDraw;
    }
    cumulativeEquity += equityDraw;
    cumulativeCapexSpent += totalSpend;
    const pfBalanceStart = pfBalance;
    const constructionProgress = Math.min(1, cumulativeCapexSpent / Math.max(1, capex.total - capex.marketing));
    let effectiveRateAnnual;
    if (constructionProgress < inputs.financing.escrowDiscountActivationProgress) {
      effectiveRateAnnual = pfBaseRate;
    } else {
      const discountedEscrow = escrowBalance * inputs.financing.escrowCoverageDiscount;
      const coverage = pfBalanceStart > 0 ? Math.min(1, discountedEscrow / pfBalanceStart) : 0;
      effectiveRateAnnual = pfBaseRate * (1 - coverage) + pfLowRate * coverage;
    }
    const monthlyRate = effectiveRateAnnual / 100 / 12;
    const pfInterestAccrued = pfBalanceStart * monthlyRate;
    const unusedLine = Math.max(0, pfCommittedLine - pfBalanceStart);
    const commitmentFee = isDuringConstruction ? unusedLine * (inputs.financing.pfCommitmentFeeAnnual / 100 / 12) : 0;
    const totalFinanceCharge = pfInterestAccrued + commitmentFee;
    cumulativePfInterest += totalFinanceCharge;
    pfBalance = pfBalanceStart + pfDraw + totalFinanceCharge;
    escrowBalance += escrowInflow;
    let escrowReleased = 0;
    let pfRepayment = 0;
    if (m === escrowReleaseMonth && escrowBalance > 0) {
      escrowReleased = escrowBalance;
      escrowBalance = 0;
      pfRepayment = Math.min(pfBalance, escrowReleased);
      pfBalance -= pfRepayment;
      const surplus = escrowReleased - pfRepayment;
      directInflow += surplus;
    }
    if (m > escrowReleaseMonth && directInflow > 0 && pfBalance > 0) {
      const tailRepayment = Math.min(pfBalance, directInflow);
      pfBalance -= tailRepayment;
      pfRepayment += tailRepayment;
      directInflow -= tailRepayment;
    }
    const developerCashFlow = directInflow - equityDraw;
    cumulativeDevCash += developerCashFlow;
    flows.push({
      month: m,
      landSpend,
      constructionSpend,
      infraSpend,
      marketingSpend,
      totalSpend,
      m2Sold,
      cumulativeM2Sold: cumulativeM2,
      revenue: revenueMonth,
      projectNetCashFlow: revenueMonth - totalSpend,
      equityDraw,
      cumulativeEquityDrawn: cumulativeEquity,
      pfDraw,
      pfBalanceStart,
      pfRateAnnualEffective: effectiveRateAnnual,
      pfInterestAccrued: totalFinanceCharge,
      cumulativePfInterest,
      pfRepayment,
      pfBalanceEnd: pfBalance,
      escrowInflow,
      escrowBalance,
      escrowReleased,
      directInflow,
      developerCashFlow,
      cumulativeDeveloperCashFlow: cumulativeDevCash
    });
    const allDone = cumulativeM2 >= volumes.sellableM2 && m > escrowReleaseMonth && pfBalance < 1 && escrowBalance < 1;
    if (allDone) break;
  }
  return flows;
}
function normalizedSCurveWeights(months) {
  if (months <= 0) return [];
  const raw = [];
  for (let i = 0; i < months; i++) {
    const x = (i + 0.5) / months;
    raw.push(Math.pow(x, 1.5) * Math.pow(1 - x, 1.5));
  }
  const sum = raw.reduce((s, w) => s + w, 0) || 1;
  return raw.map((w) => w / sum);
}

// src/engine/finance/financialMetrics.ts
function calculateNPV(monthlyCashFlow, discountRateAnnualPct) {
  const monthlyRate = discountRateAnnualPct / 100 / 12;
  return monthlyCashFlow.reduce(
    (npv, f) => npv + f.developerCashFlow / Math.pow(1 + monthlyRate, f.month),
    0
  );
}
function calculateIRR(monthlyCashFlow) {
  const hasPositive = monthlyCashFlow.some((f) => f.developerCashFlow > 0);
  const hasNegative = monthlyCashFlow.some((f) => f.developerCashFlow < 0);
  if (!hasPositive || !hasNegative) return null;
  const npvAtMonthly = (r) => monthlyCashFlow.reduce(
    (s, f) => s + f.developerCashFlow / Math.pow(1 + r, f.month),
    0
  );
  let lo = -0.05;
  let hi = 0.2;
  let npvLo = npvAtMonthly(lo);
  let npvHi = npvAtMonthly(hi);
  for (let i = 0; i < 6 && npvLo * npvHi > 0; i++) {
    lo = Math.max(-0.95, lo * 1.5 - 0.05);
    hi = Math.min(5, hi * 2);
    npvLo = npvAtMonthly(lo);
    npvHi = npvAtMonthly(hi);
  }
  if (npvLo * npvHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npvMid = npvAtMonthly(mid);
    if (Math.abs(npvMid) < 1 || hi - lo < 1e-10) {
      return (Math.pow(1 + mid, 12) - 1) * 100;
    }
    if (npvLo * npvMid < 0) {
      hi = mid;
      npvHi = npvMid;
    } else {
      lo = mid;
      npvLo = npvMid;
    }
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
}
function buildSensitivity(inputs, runner) {
  const variables = [
    "pricePerM2",
    "constructionCost",
    "salesVelocity",
    "discountRate",
    "pfBaseRate"
  ];
  return variables.map((variable) => {
    const cells = SENSITIVITY_DELTAS.map((delta) => {
      const adjusted = applyDelta(inputs, variable, delta);
      const { irr, npv } = runner(adjusted, "base");
      return { variable, delta, irr, npv };
    });
    return { variable, cells };
  });
}
function applyDelta(inputs, variable, delta) {
  const factor = 1 + delta;
  const copy = { ...inputs, financing: { ...inputs.financing } };
  switch (variable) {
    case "pricePerM2":
      copy.basePricePerM2 *= factor;
      break;
    case "constructionCost":
      copy.constructionCostPerM2 *= factor;
      break;
    case "salesVelocity":
      copy.salesVelocityM2PerMonth *= factor;
      break;
    case "discountRate":
      copy.discountRateAnnual *= factor;
      break;
    case "pfBaseRate":
      copy.financing.pfBaseRateAnnual *= factor;
      break;
  }
  return copy;
}

// src/engine/finance/successProb.ts
function normalizeIrrToScore(irrPct) {
  const { floorPct, ceilingPct } = IRR_NORMALIZATION;
  if (irrPct <= floorPct) return 0;
  if (irrPct >= ceilingPct) return 100;
  return (irrPct - floorPct) / (ceilingPct - floorPct) * 100;
}
function calculateSuccessProb(inputs) {
  const financialScore = normalizeIrrToScore(inputs.irrBase);
  const base = SUCCESS_PROB_WEIGHTS.cityScore * inputs.cityScore + SUCCESS_PROB_WEIGHTS.districtScore * inputs.districtScore + SUCCESS_PROB_WEIGHTS.siteScore * inputs.siteScore + SUCCESS_PROB_WEIGHTS.financialScore * financialScore;
  let penalties = 0;
  penalties += inputs.redRiskCount * SUCCESS_PROB_PENALTIES.perRedRisk;
  if (inputs.irrStress < 0) penalties += SUCCESS_PROB_PENALTIES.stressIrrNegative;
  if (inputs.confidenceScore < 50) {
    penalties += (50 - inputs.confidenceScore) / SUCCESS_PROB_PENALTIES.confidenceDivisor;
  }
  return clamp(base - penalties, 0, 100);
}
function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// src/engine/finance/engine.ts
function runScenario(inputs, scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const volumes = calculateVolumes(inputs);
  const revenue = calculateRevenue(inputs, volumes, scenario);
  const capex = calculateCapex(inputs, volumes, revenue.totalRevenue, scenario);
  const monthlyCashFlow = buildMonthlyCashFlow(
    inputs,
    volumes,
    revenue,
    capex,
    scenario
  );
  const effectiveDiscountRate = inputs.discountRateAnnual + adj.discountRateDelta;
  const npv = calculateNPV(monthlyCashFlow, effectiveDiscountRate);
  const irr = calculateIRR(monthlyCashFlow);
  const totalPfInterest = monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativePfInterest ?? 0;
  const peakPfBalance = monthlyCashFlow.reduce(
    (max, f) => Math.max(max, f.pfBalanceEnd),
    0
  );
  const totalEquityDeployed = monthlyCashFlow[monthlyCashFlow.length - 1]?.cumulativeEquityDrawn ?? 0;
  const grossMargin = revenue.totalRevenue > 0 ? (revenue.totalRevenue - capex.construction - capex.infrastructure) / revenue.totalRevenue * 100 : 0;
  const netMargin = revenue.totalRevenue > 0 ? (revenue.totalRevenue - capex.total - totalPfInterest) / revenue.totalRevenue * 100 : 0;
  const salesVelocity = inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier;
  const sellOutMonths = volumes.sellableM2 / Math.max(salesVelocity, 1);
  const totalProjectMonths = monthlyCashFlow.length - 1;
  return {
    scenario,
    volumes,
    revenue,
    capex,
    monthlyCashFlow,
    npv,
    irr,
    grossMargin,
    netMargin,
    totalPfInterest,
    peakPfBalance,
    totalEquityDeployed,
    sellOutMonths,
    totalProjectMonths
  };
}
function runFinancialModel(inputs, options = {}) {
  const scenarios = {
    base: runScenario(inputs, "base"),
    optimistic: runScenario(inputs, "optimistic"),
    stress: runScenario(inputs, "stress")
  };
  const sensitivity = buildSensitivity(inputs, (i, s) => {
    const r = runScenario(i, s);
    return { irr: r.irr, npv: r.npv };
  });
  const warnings = [];
  if (scenarios.stress.irr !== null && scenarios.stress.irr < 0) {
    warnings.push(
      "IRR \u0432 \u0441\u0442\u0440\u0435\u0441\u0441-\u0441\u0446\u0435\u043D\u0430\u0440\u0438\u0438 \u043E\u0442\u0440\u0438\u0446\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u2014 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 Real Option: Abandon / Delay"
    );
  }
  if (scenarios.base.irr !== null && scenarios.base.irr < 15) {
    warnings.push("\u0411\u0430\u0437\u043E\u0432\u044B\u0439 IRR < 15% \u2014 \u043F\u0440\u043E\u0435\u043A\u0442 \u043D\u0435 \u043F\u0440\u043E\u0439\u0434\u0451\u0442 Stage 2 (Pre-Feasibility)");
  }
  if (scenarios.base.netMargin < 10) {
    warnings.push(
      "\u0427\u0438\u0441\u0442\u0430\u044F \u043C\u0430\u0440\u0436\u0430 \u0431\u0430\u0437\u043E\u0432\u043E\u0433\u043E \u0441\u0446\u0435\u043D\u0430\u0440\u0438\u044F < 10% \u2014 \u043D\u0438\u0437\u043A\u0430\u044F \u0431\u0443\u0444\u0435\u0440\u043D\u0430\u044F \u0437\u043E\u043D\u0430 \u043F\u043E \u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u0438"
    );
  }
  const coverRatio = scenarios.base.totalEquityDeployed > 0 ? scenarios.base.peakPfBalance / scenarios.base.totalEquityDeployed : Infinity;
  if (coverRatio > 5) {
    warnings.push(
      `\u041F\u0438\u043A\u043E\u0432\u044B\u0439 \u041F\u0424 / equity = ${coverRatio.toFixed(1)}\xD7 \u2014 \u0443\u0432\u0435\u043B\u0438\u0447\u044C\u0442\u0435 \u0434\u043E\u043B\u044E equity \u0438\u043B\u0438 \u043F\u043E\u044D\u0442\u0430\u043F\u043D\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A`
    );
  }
  const months = scenarios.base.totalProjectMonths;
  if (months > 72) {
    warnings.push(
      `\u0414\u043B\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043F\u0440\u043E\u0435\u043A\u0442\u0430 ${months} \u043C\u0435\u0441. \u2014 \u0432\u044B\u0441\u043E\u043A\u0430\u044F \u0447\u0443\u0432\u0441\u0442\u0432\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043A \u0441\u0442\u0430\u0432\u043A\u0435 \u0426\u0411`
    );
  }
  let successProb = 0;
  if (options.successProbContext) {
    successProb = calculateSuccessProb({
      ...options.successProbContext,
      irrBase: scenarios.base.irr ?? 0,
      irrStress: scenarios.stress.irr ?? 0
    });
  }
  return { scenarios, sensitivity, successProb, warnings };
}

// src/engine/scoring/config.ts
var DEFAULT_SCORING_WEIGHTS = {
  macro: {
    mortgageAffordability: 0.4,
    realIncome: 0.35,
    macroRisk: 0.25
  },
  city: {
    demography: 0.2,
    economy: 0.25,
    housing: 0.3,
    competition: 0.15,
    infrastructure: 0.1
  },
  district: {
    access: 0.25,
    socialInfra: 0.2,
    urbanQuality: 0.2,
    localMarket: 0.2,
    alignment: 0.15
  },
  site: {
    legal: 0.2,
    tech: 0.2,
    surroundings: 0.25,
    marketFit: 0.2,
    rawFinancial: 0.15
  }
};
var ZONE_THRESHOLDS = {
  yellow: 40,
  orange: 60,
  green: 75
};
function scoreToZone(score) {
  if (score >= ZONE_THRESHOLDS.green) return "green";
  if (score >= ZONE_THRESHOLDS.orange) return "orange";
  if (score >= ZONE_THRESHOLDS.yellow) return "yellow";
  return "red";
}

// src/engine/scoring/normalize.ts
function normalizePiecewise(value, anchors) {
  if (anchors.length === 0) return 50;
  if (value <= anchors[0][0]) return anchors[0][1];
  if (value >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x1, y1] = anchors[i];
    const [x2, y2] = anchors[i + 1];
    if (value >= x1 && value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return 50;
}
function clamp2(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// src/engine/scoring/macroScore.ts
function calculateMortgageAffordability(inputs) {
  const effRate = inputs.preferentialMortgageRate !== null ? inputs.mortgageRateAnnual * (1 - inputs.mortgageShareOfDeals * 0.5) + inputs.preferentialMortgageRate * (inputs.mortgageShareOfDeals * 0.5) : inputs.mortgageRateAnnual;
  const denom = effRate / 100 * inputs.medianPricePerM2Ru * 50;
  if (denom <= 0) return 0;
  const raw = inputs.medianMonthlyIncomeRu * 12 / denom;
  return normalizePiecewise(raw, [
    [0.05, 0],
    [0.15, 30],
    [0.3, 70],
    [0.6, 100]
  ]);
}
function calculateRealIncomeIndex(inputs) {
  const changePct = (inputs.realIncomeIndex3yr - 1) * 100;
  return normalizePiecewise(changePct, [
    [-10, 0],
    [0, 40],
    [10, 80],
    [20, 100]
  ]);
}
function calculateMacroRiskIndex(inputs) {
  const keyRatePenalty = normalizePiecewise(inputs.keyRateAnnual, [
    [5, 0],
    [10, 30],
    [16, 60],
    [22, 100]
  ]);
  const inflationPenalty = normalizePiecewise(inputs.inflationYoY, [
    [3, 0],
    [6, 30],
    [12, 70],
    [20, 100]
  ]);
  const incomePenalty = inputs.realIncomeIndex3yr < 1 ? normalizePiecewise((1 - inputs.realIncomeIndex3yr) * 100, [
    [0, 0],
    [5, 50],
    [15, 100]
  ]) : 0;
  const unemploymentPenalty = normalizePiecewise(inputs.unemploymentRate, [
    [2, 0],
    [5, 30],
    [10, 80],
    [15, 100]
  ]);
  return clamp2(
    0.3 * keyRatePenalty + 0.25 * inflationPenalty + 0.25 * incomePenalty + 0.2 * unemploymentPenalty,
    0,
    100
  );
}
function calculateMacroScore(inputs, weights = DEFAULT_SCORING_WEIGHTS) {
  const w = weights.macro;
  const mortgageAffordabilityIndex = calculateMortgageAffordability(inputs);
  const realIncomeIndex = calculateRealIncomeIndex(inputs);
  const macroRiskIndex = calculateMacroRiskIndex(inputs);
  const macroScore = clamp2(
    w.mortgageAffordability * mortgageAffordabilityIndex + w.realIncome * realIncomeIndex + w.macroRisk * (100 - macroRiskIndex),
    0,
    100
  );
  return {
    mortgageAffordabilityIndex,
    realIncomeIndex,
    macroRiskIndex,
    macroScore,
    macroMultiplier: macroScore / 100
  };
}

// src/engine/scoring/cityScore.ts
function calculateDemographyScore(inputs) {
  const trendScore = normalizePiecewise(inputs.populationTrend5yPct, [
    [-10, 0],
    [-2, 30],
    [0, 50],
    [5, 80],
    [15, 100]
  ]);
  const ageScore = normalizePiecewise(inputs.shareAge25to45, [
    [0.15, 0],
    [0.25, 50],
    [0.35, 100]
  ]);
  const migrationScore = normalizePiecewise(inputs.migrationBalanceThousands, [
    [-20, 0],
    [0, 50],
    [10, 80],
    [50, 100]
  ]);
  return clamp2(0.4 * trendScore + 0.35 * ageScore + 0.25 * migrationScore, 0, 100);
}
function calculateEconomyScore(inputs, ruMedianSalary) {
  const salaryRatio = inputs.avgSalary / Math.max(ruMedianSalary, 1);
  const salaryScore = normalizePiecewise(salaryRatio, [
    [0.7, 0],
    [1, 40],
    [1.5, 80],
    [2, 100]
  ]);
  const growthScore = normalizePiecewise(inputs.salaryGrowthYoY, [
    [-5, 0],
    [0, 30],
    [10, 70],
    [20, 100]
  ]);
  const industryScore = normalizePiecewise(inputs.highPaidIndustriesShare, [
    [0.05, 0],
    [0.15, 50],
    [0.3, 100]
  ]);
  const unemploymentScore = 100 - normalizePiecewise(inputs.unemploymentRate, [
    [2, 0],
    [5, 40],
    [10, 100]
  ]);
  return clamp2(
    0.35 * salaryScore + 0.25 * growthScore + 0.25 * industryScore + 0.15 * unemploymentScore,
    0,
    100
  );
}
function calculateHousingMarketScore(inputs, macroMultiplier) {
  const dealsScore = normalizePiecewise(inputs.dealsGrowthYoY, [
    [-30, 0],
    [-10, 30],
    [0, 50],
    [10, 80],
    [25, 100]
  ]);
  const priceScore = normalizePiecewise(inputs.priceGrowthYoY, [
    [-5, 0],
    [0, 40],
    [10, 80],
    [20, 100]
  ]);
  const absorptionScore = 100 - normalizePiecewise(inputs.monthsOfSupply, [
    [3, 0],
    [12, 50],
    [30, 100]
  ]);
  const raw = clamp2(
    0.4 * dealsScore + 0.3 * priceScore + 0.3 * absorptionScore,
    0,
    100
  );
  return clamp2(raw * macroMultiplier, 0, 100);
}
function calculateCompetitionScore(inputs) {
  let score = 100 - normalizePiecewise(inputs.top5MarketShare, [
    [0.2, 0],
    [0.5, 50],
    [0.8, 100]
  ]);
  if (inputs.hasFederalPlayers) score -= 10;
  if (inputs.hasWhiteSpaceBusinessClass) score += 15;
  return clamp2(score, 0, 100);
}
function calculateInfrastructureScore(inputs) {
  const krtScore = normalizePiecewise(inputs.krtProgramsHa, [
    [0, 0],
    [50, 40],
    [200, 80],
    [500, 100]
  ]);
  const infraBonus = inputs.hasMajorInfraProjects ? 30 : 0;
  const educationBonus = inputs.hasUniversitiesOrTechparks ? 15 : 0;
  return clamp2(krtScore * 0.55 + infraBonus + educationBonus, 0, 100);
}
function calculateCityScore(inputs, context, weights = DEFAULT_SCORING_WEIGHTS) {
  const w = weights.city;
  const breakdown = {
    demographyScore: calculateDemographyScore(inputs.demography),
    economyScore: calculateEconomyScore(inputs.economy, context.ruMedianSalary),
    housingMarketScore: calculateHousingMarketScore(
      inputs.housing,
      context.macroMultiplier
    ),
    competitionScore: calculateCompetitionScore(inputs.competition),
    infrastructureScore: calculateInfrastructureScore(inputs.infrastructure)
  };
  const cityScore = clamp2(
    w.demography * breakdown.demographyScore + w.economy * breakdown.economyScore + w.housing * breakdown.housingMarketScore + w.competition * breakdown.competitionScore + w.infrastructure * breakdown.infrastructureScore,
    0,
    100
  );
  return {
    cityName: inputs.name,
    region: inputs.region,
    breakdown,
    cityScore,
    zone: scoreToZone(cityScore),
    summary: generateCitySummary(inputs.name, breakdown, cityScore)
  };
}
function describe(score, options) {
  if (score >= 70) return options[0];
  if (score >= 45) return options[1];
  return options[2];
}
function generateCitySummary(name, b, total) {
  const demand = describe(b.housingMarketScore, ["\u0432\u044B\u0441\u043E\u043A\u0438\u0439", "\u0441\u0440\u0435\u0434\u043D\u0438\u0439", "\u043D\u0438\u0437\u043A\u0438\u0439"]);
  const competition = describe(b.competitionScore, [
    "\u043D\u0438\u0437\u043A\u0443\u044E",
    "\u0441\u0440\u0435\u0434\u043D\u044E\u044E",
    "\u0432\u044B\u0441\u043E\u043A\u0443\u044E"
  ]);
  const economy = describe(b.economyScore, ["\u0440\u0430\u0441\u0442\u0443\u0449\u0443\u044E", "\u0441\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u0443\u044E", "\u0441\u043B\u0430\u0431\u0443\u044E"]);
  const verdict = total >= 75 ? "\u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442\u043D\u044B\u0439 \u043A\u0430\u043D\u0434\u0438\u0434\u0430\u0442 \u0434\u043B\u044F \u0437\u0430\u043F\u0443\u0441\u043A\u0430" : total >= 60 ? "\u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0434\u0435\u0442\u0430\u043B\u044C\u043D\u043E\u0433\u043E \u0430\u043D\u0430\u043B\u0438\u0437\u0430" : total >= 40 ? "\u0432\u044B\u0441\u043E\u043A\u0438\u0439 \u0440\u0438\u0441\u043A \u2014 \u0437\u0430\u0445\u043E\u0434\u0438\u0442\u044C \u0432\u044B\u0431\u043E\u0440\u043E\u0447\u043D\u043E" : "\u043D\u0435 \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F";
  return `\u0413\u043E\u0440\u043E\u0434 ${name} \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 ${demand} \u0441\u043F\u0440\u043E\u0441, ${competition} \u043A\u043E\u043D\u043A\u0443\u0440\u0435\u043D\u0446\u0438\u044E, ${economy} \u044D\u043A\u043E\u043D\u043E\u043C\u0438\u043A\u0443. \u041A\u043E\u043C\u043F\u043E\u0437\u0438\u0442\u043D\u044B\u0439 \u0431\u0430\u043B\u043B ${total.toFixed(0)}/100 \u2014 ${verdict}.`;
}

// src/engine/scoring/districtScore.ts
function calculateAccessScore(inputs) {
  const timeScore = 100 - normalizePiecewise(inputs.travelTimeToCenterMin, [
    [5, 0],
    [25, 50],
    [60, 100]
  ]);
  const metroBonus = inputs.hasMetro ? 25 : 0;
  return clamp2(timeScore + metroBonus, 0, 100);
}
function calculateSocialInfraScore(inputs) {
  return normalizePiecewise(inputs.socialFacilitiesPer1000, [
    [0.5, 0],
    [2, 50],
    [5, 100]
  ]);
}
function calculateUrbanQualityScore(inputs) {
  const walkability = clamp2(inputs.walkabilityIndex, 0, 100);
  const parkBonus = inputs.hasParksOrWaterfront ? 25 : 0;
  return clamp2(walkability * 0.7 + parkBonus, 0, 100);
}
function calculateLocalMarketScore(inputs, cityAvgPricePerM2) {
  const priceRatio = inputs.localPricePerM2 / Math.max(cityAvgPricePerM2, 1);
  const priceScore = normalizePiecewise(priceRatio, [
    [0.7, 30],
    [1, 60],
    [1.4, 90],
    [2, 100]
  ]);
  const dynamicsScore = normalizePiecewise(inputs.localPriceGrowthYoY, [
    [-5, 0],
    [5, 50],
    [15, 100]
  ]);
  const competitionPenalty = normalizePiecewise(inputs.directCompetitorsCount, [
    [0, 0],
    [5, 50],
    [15, 100]
  ]);
  return clamp2(
    0.45 * priceScore + 0.35 * dynamicsScore + 0.2 * (100 - competitionPenalty),
    0,
    100
  );
}
function calculateAlignmentScore(inputs) {
  return clamp2(inputs.segmentAlignment * 100, 0, 100);
}
function calculateDistrictScore(inputs, context, weights = DEFAULT_SCORING_WEIGHTS) {
  const w = weights.district;
  const breakdown = {
    accessScore: calculateAccessScore(inputs),
    socialInfraScore: calculateSocialInfraScore(inputs),
    urbanQualityScore: calculateUrbanQualityScore(inputs),
    localMarketScore: calculateLocalMarketScore(inputs, context.cityAvgPricePerM2),
    alignmentScore: calculateAlignmentScore(inputs)
  };
  const districtScore = clamp2(
    w.access * breakdown.accessScore + w.socialInfra * breakdown.socialInfraScore + w.urbanQuality * breakdown.urbanQualityScore + w.localMarket * breakdown.localMarketScore + w.alignment * breakdown.alignmentScore,
    0,
    100
  );
  return {
    districtName: inputs.name,
    cityName: inputs.cityName,
    breakdown,
    districtScore,
    zone: scoreToZone(districtScore)
  };
}

// src/engine/scoring/siteScore.ts
function calculateLegalScore(inputs) {
  let score = 100;
  if (inputs.ownershipStatus === "encumbered") score -= 35;
  if (inputs.hasLegalDisputes) score -= 50;
  return clamp2(score, 0, 100);
}
function calculateTechScore(inputs) {
  const capacityRatio = inputs.electricityRequiredMw > 0 ? inputs.electricityCapacityMw / inputs.electricityRequiredMw : 1;
  const capacityScore = normalizePiecewise(capacityRatio, [
    [0.5, 0],
    [1, 50],
    [1.5, 100]
  ]);
  const utilityScore = 100 - normalizePiecewise(inputs.distanceToUtilitiesMeters, [
    [0, 0],
    [500, 50],
    [2e3, 100]
  ]);
  let restrictions = 0;
  if (inputs.hasPowerLineRestriction) restrictions += 1;
  if (inputs.hasSanitaryZoneRestriction) restrictions += 1;
  if (inputs.hasProtectedAreaRestriction) restrictions += 1;
  const restrictionPenalty = restrictions * 15;
  return clamp2(
    0.5 * capacityScore + 0.5 * utilityScore - restrictionPenalty,
    0,
    100
  );
}
function calculateSurroundingsScore(inputs) {
  const metroScore = 100 - normalizePiecewise(inputs.distanceToMetroMeters, [
    [200, 0],
    [800, 50],
    [3e3, 100]
  ]);
  const schoolScore = 100 - normalizePiecewise(inputs.distanceToSchoolMeters, [
    [100, 0],
    [500, 50],
    [2e3, 100]
  ]);
  const parkScore = 100 - normalizePiecewise(inputs.distanceToParkMeters, [
    [100, 0],
    [500, 50],
    [2e3, 100]
  ]);
  const viewBonus = inputs.hasViewAdvantage ? 15 : 0;
  return clamp2(
    0.4 * metroScore + 0.3 * schoolScore + 0.3 * parkScore + viewBonus,
    0,
    100
  );
}
function calculateMarketFitScore(inputs) {
  const competitionScore = 100 - normalizePiecewise(inputs.directCompetitorsNearby, [
    [0, 0],
    [3, 50],
    [10, 100]
  ]);
  return clamp2(competitionScore, 0, 100);
}
function calculateRawFinancialScore(inputs) {
  if (inputs.expectedCapex <= 0) return 0;
  const margin = (inputs.expectedRevenue - inputs.expectedCapex) / inputs.expectedCapex;
  return normalizePiecewise(margin, [
    [-0.1, 0],
    [0.2, 40],
    [0.5, 75],
    [1, 100]
  ]);
}
function makeDecision(siteScore, breakdown) {
  if (breakdown.legalScore < 40) return "no-go";
  if (breakdown.rawFinancialScore < 20) return "no-go";
  if (siteScore >= 70) return "go";
  if (siteScore >= 50) return "soft-go";
  return "no-go";
}
function calculateSiteScore(inputs, weights = DEFAULT_SCORING_WEIGHTS) {
  const w = weights.site;
  const breakdown = {
    legalScore: calculateLegalScore(inputs),
    techScore: calculateTechScore(inputs),
    surroundingsScore: calculateSurroundingsScore(inputs),
    marketFitScore: calculateMarketFitScore(inputs),
    rawFinancialScore: calculateRawFinancialScore(inputs)
  };
  const siteScore = clamp2(
    w.legal * breakdown.legalScore + w.tech * breakdown.techScore + w.surroundings * breakdown.surroundingsScore + w.marketFit * breakdown.marketFitScore + w.rawFinancial * breakdown.rawFinancialScore,
    0,
    100
  );
  return {
    siteName: inputs.name,
    districtName: inputs.districtName,
    breakdown,
    siteScore,
    zone: scoreToZone(siteScore),
    decision: makeDecision(siteScore, breakdown)
  };
}

// src/data/cities.ts
var RUSSIA_MILLION_CITIES = {
  novosibirsk: {
    inputs: {
      name: "\u041D\u043E\u0432\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A",
      region: "\u041D\u043E\u0432\u043E\u0441\u0438\u0431\u0438\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1633.9, populationTrend5yPct: 2.1, shareAge25to45: 0.31, migrationBalanceThousands: 6.2 },
      economy: { avgSalary: 84e3, salaryGrowthYoY: 13.5, highPaidIndustriesShare: 0.19, unemploymentRate: 3.1 },
      housing: { dealsGrowthYoY: -4, priceGrowthYoY: 9.8, monthsOfSupply: 10, businessClassPricePerM2: 23e4, monthlySalesM2: 78e3 },
      competition: { activeDevelopers: 32, top5MarketShare: 0.48, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 220, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro Jan 2026", "\u0420\u0418\u0410 \u0420\u0435\u0439\u0442\u0438\u043D\u0433 2025", "\u0420\u043E\u0441\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  yekaterinburg: {
    inputs: {
      name: "\u0415\u043A\u0430\u0442\u0435\u0440\u0438\u043D\u0431\u0443\u0440\u0433",
      region: "\u0421\u0432\u0435\u0440\u0434\u043B\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1580.1, populationTrend5yPct: 3.8, shareAge25to45: 0.32, migrationBalanceThousands: 9.1 },
      economy: { avgSalary: 92e3, salaryGrowthYoY: 14.2, highPaidIndustriesShare: 0.22, unemploymentRate: 2.8 },
      housing: { dealsGrowthYoY: 2.5, priceGrowthYoY: 12.1, monthsOfSupply: 8, businessClassPricePerM2: 265e3, monthlySalesM2: 92e3 },
      competition: { activeDevelopers: 28, top5MarketShare: 0.55, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 280, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro Jan 2026", "\u0421\u0432\u0435\u0440\u0434\u043B\u043E\u0432\u0441\u043A\u0441\u0442\u0430\u0442", "\u0420\u0411\u041A \u041D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C"], needsVerification: ["krtProgramsHa"] }
  },
  kazan: {
    inputs: {
      name: "\u041A\u0430\u0437\u0430\u043D\u044C",
      region: "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0422\u0430\u0442\u0430\u0440\u0441\u0442\u0430\u043D",
      demography: { populationThousands: 1318.6, populationTrend5yPct: 5.4, shareAge25to45: 0.33, migrationBalanceThousands: 11.8 },
      economy: { avgSalary: 86e3, salaryGrowthYoY: 14.8, highPaidIndustriesShare: 0.21, unemploymentRate: 2.5 },
      housing: { dealsGrowthYoY: -2, priceGrowthYoY: 14.3, monthsOfSupply: 7, businessClassPricePerM2: 274e3, monthlySalesM2: 68e3 },
      competition: { activeDevelopers: 25, top5MarketShare: 0.62, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 350, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro Jan 2026", "\u042F\u043D\u0434\u0435\u043A\u0441 \u041D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C Dec 2025", "\u0422\u0430\u0442\u0430\u0440\u0441\u0442\u0430\u043D\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa"] }
  },
  nizhny: {
    inputs: {
      name: "\u041D\u0438\u0436\u043D\u0438\u0439 \u041D\u043E\u0432\u0433\u043E\u0440\u043E\u0434",
      region: "\u041D\u0438\u0436\u0435\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1205, populationTrend5yPct: -2.1, shareAge25to45: 0.28, migrationBalanceThousands: -1.5 },
      economy: { avgSalary: 78e3, salaryGrowthYoY: 12, highPaidIndustriesShare: 0.2, unemploymentRate: 3 },
      housing: { dealsGrowthYoY: -8, priceGrowthYoY: 11.5, monthsOfSupply: 11, businessClassPricePerM2: 3e5, monthlySalesM2: 42e3 },
      competition: { activeDevelopers: 22, top5MarketShare: 0.58, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 180, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["\u0426\u0438\u0430\u043D 2025", "\u0420\u0411\u041A \u041D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C Nov 2025", "\u041D\u0438\u0436\u0435\u0433\u043E\u0440\u043E\u0434\u0441\u043A\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa"] }
  },
  chelyabinsk: {
    inputs: {
      name: "\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A",
      region: "\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1196.7, populationTrend5yPct: -1.5, shareAge25to45: 0.28, migrationBalanceThousands: -2 },
      economy: { avgSalary: 72e3, salaryGrowthYoY: 11.5, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: { dealsGrowthYoY: -10, priceGrowthYoY: 7.2, monthsOfSupply: 14, businessClassPricePerM2: 185e3, monthlySalesM2: 38e3 },
      competition: { activeDevelopers: 18, top5MarketShare: 0.65, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 90, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro Jan 2026", "\u0420\u0411\u041A \u041D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C", "\u0427\u0435\u043B\u044F\u0431\u0438\u043D\u0441\u043A\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  samara: {
    inputs: {
      name: "\u0421\u0430\u043C\u0430\u0440\u0430",
      region: "\u0421\u0430\u043C\u0430\u0440\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1159, populationTrend5yPct: -1.8, shareAge25to45: 0.28, migrationBalanceThousands: -2.5 },
      economy: { avgSalary: 7e4, salaryGrowthYoY: 11, highPaidIndustriesShare: 0.18, unemploymentRate: 3.2 },
      housing: { dealsGrowthYoY: -6, priceGrowthYoY: 5.5, monthsOfSupply: 12, businessClassPricePerM2: 195e3, monthlySalesM2: 36e3 },
      competition: { activeDevelopers: 16, top5MarketShare: 0.6, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 120, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u0421\u0430\u043C\u0430\u0440\u0430\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  ufa: {
    inputs: {
      name: "\u0423\u0444\u0430",
      region: "\u0420\u0435\u0441\u043F\u0443\u0431\u043B\u0438\u043A\u0430 \u0411\u0430\u0448\u043A\u043E\u0440\u0442\u043E\u0441\u0442\u0430\u043D",
      demography: { populationThousands: 1163.3, populationTrend5yPct: 1.2, shareAge25to45: 0.3, migrationBalanceThousands: 2.8 },
      economy: { avgSalary: 76e3, salaryGrowthYoY: 12.8, highPaidIndustriesShare: 0.19, unemploymentRate: 2.9 },
      housing: { dealsGrowthYoY: -3, priceGrowthYoY: 11, monthsOfSupply: 10, businessClassPricePerM2: 205e3, monthlySalesM2: 41e3 },
      competition: { activeDevelopers: 19, top5MarketShare: 0.55, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 140, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u0411\u0430\u0448\u043A\u043E\u0440\u0442\u043E\u0441\u0442\u0430\u043D\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  rostov: {
    inputs: {
      name: "\u0420\u043E\u0441\u0442\u043E\u0432-\u043D\u0430-\u0414\u043E\u043D\u0443",
      region: "\u0420\u043E\u0441\u0442\u043E\u0432\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1140.5, populationTrend5yPct: 1.5, shareAge25to45: 0.29, migrationBalanceThousands: 4.2 },
      economy: { avgSalary: 73e3, salaryGrowthYoY: 12.5, highPaidIndustriesShare: 0.17, unemploymentRate: 3.4 },
      housing: { dealsGrowthYoY: -5, priceGrowthYoY: 8.5, monthsOfSupply: 11, businessClassPricePerM2: 19e4, monthlySalesM2: 39e3 },
      competition: { activeDevelopers: 21, top5MarketShare: 0.52, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 160, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u0420\u0411\u041A \u041D\u0435\u0434\u0432\u0438\u0436\u0438\u043C\u043E\u0441\u0442\u044C", "\u0420\u043E\u0441\u0442\u043E\u0432\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa"] }
  },
  omsk: {
    inputs: {
      name: "\u041E\u043C\u0441\u043A",
      region: "\u041E\u043C\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1104.5, populationTrend5yPct: -4.2, shareAge25to45: 0.27, migrationBalanceThousands: -8.5 },
      economy: { avgSalary: 64e3, salaryGrowthYoY: 9.5, highPaidIndustriesShare: 0.14, unemploymentRate: 4.1 },
      housing: { dealsGrowthYoY: -12, priceGrowthYoY: 4.8, monthsOfSupply: 16, businessClassPricePerM2: 168e3, monthlySalesM2: 28e3 },
      competition: { activeDevelopers: 14, top5MarketShare: 0.7, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 60, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u041E\u043C\u0441\u043A\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  krasnodar: {
    inputs: {
      name: "\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440",
      region: "\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439",
      demography: { populationThousands: 1138.7, populationTrend5yPct: 14.5, shareAge25to45: 0.34, migrationBalanceThousands: 28 },
      economy: { avgSalary: 75e3, salaryGrowthYoY: 15.5, highPaidIndustriesShare: 0.18, unemploymentRate: 2.6 },
      housing: { dealsGrowthYoY: 1, priceGrowthYoY: 7, monthsOfSupply: 9, businessClassPricePerM2: 215e3, monthlySalesM2: 65e3 },
      competition: { activeDevelopers: 35, top5MarketShare: 0.42, hasFederalPlayers: true, hasWhiteSpaceBusinessClass: false },
      infrastructure: { krtProgramsHa: 420, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["\u041A\u043E\u043C\u043C\u0435\u0440\u0441\u0430\u043D\u0442 Jan 2026", "bnMAP.pro 2025", "\u041A\u0440\u0430\u0441\u043D\u043E\u0434\u0430\u0440\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa"] }
  },
  voronezh: {
    inputs: {
      name: "\u0412\u043E\u0440\u043E\u043D\u0435\u0436",
      region: "\u0412\u043E\u0440\u043E\u043D\u0435\u0436\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1041.7, populationTrend5yPct: 0.5, shareAge25to45: 0.28, migrationBalanceThousands: 1.8 },
      economy: { avgSalary: 65e3, salaryGrowthYoY: 10.5, highPaidIndustriesShare: 0.15, unemploymentRate: 3.3 },
      housing: { dealsGrowthYoY: -7, priceGrowthYoY: 8.1, monthsOfSupply: 13, businessClassPricePerM2: 185e3, monthlySalesM2: 32e3 },
      competition: { activeDevelopers: 17, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 110, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u0412\u043E\u0440\u043E\u043D\u0435\u0436\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  volgograd: {
    inputs: {
      name: "\u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434",
      region: "\u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434\u0441\u043A\u0430\u044F \u043E\u0431\u043B\u0430\u0441\u0442\u044C",
      demography: { populationThousands: 1018.9, populationTrend5yPct: -3.5, shareAge25to45: 0.27, migrationBalanceThousands: -5.2 },
      economy: { avgSalary: 58e3, salaryGrowthYoY: 8.5, highPaidIndustriesShare: 0.13, unemploymentRate: 4.2 },
      housing: { dealsGrowthYoY: -9, priceGrowthYoY: 3.6, monthsOfSupply: 17, businessClassPricePerM2: 168e3, monthlySalesM2: 22e3 },
      competition: { activeDevelopers: 12, top5MarketShare: 0.72, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 45, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: false }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro Jan 2026", "\u0410\u0438\u0424 \u0412\u043E\u043B\u0433\u043E\u0433\u0440\u0430\u0434"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  perm: {
    inputs: {
      name: "\u041F\u0435\u0440\u043C\u044C",
      region: "\u041F\u0435\u0440\u043C\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439",
      demography: { populationThousands: 1026.9, populationTrend5yPct: -2.8, shareAge25to45: 0.28, migrationBalanceThousands: -3.2 },
      economy: { avgSalary: 68e3, salaryGrowthYoY: 11.8, highPaidIndustriesShare: 0.16, unemploymentRate: 3.5 },
      housing: { dealsGrowthYoY: -8.5, priceGrowthYoY: 18.1, monthsOfSupply: 12, businessClassPricePerM2: 228e3, monthlySalesM2: 3e4 },
      competition: { activeDevelopers: 16, top5MarketShare: 0.62, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 95, hasMajorInfraProjects: false, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["RuNews24 Dec 2025", "bnMAP.pro 2025", "\u041F\u0435\u0440\u043C\u044C\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa", "hasWhiteSpaceBusinessClass"] }
  },
  krasnoyarsk: {
    inputs: {
      name: "\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A",
      region: "\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A\u0438\u0439 \u043A\u0440\u0430\u0439",
      demography: { populationThousands: 1211.8, populationTrend5yPct: 1.8, shareAge25to45: 0.3, migrationBalanceThousands: 3.5 },
      economy: { avgSalary: 82e3, salaryGrowthYoY: 12.2, highPaidIndustriesShare: 0.2, unemploymentRate: 3 },
      housing: { dealsGrowthYoY: -4.5, priceGrowthYoY: 7.8, monthsOfSupply: 11, businessClassPricePerM2: 245e3, monthlySalesM2: 35e3 },
      competition: { activeDevelopers: 18, top5MarketShare: 0.58, hasFederalPlayers: false, hasWhiteSpaceBusinessClass: true },
      infrastructure: { krtProgramsHa: 130, hasMajorInfraProjects: true, hasUniversitiesOrTechparks: true }
    },
    meta: { dataAsOfDate: "2026-02-01", sources: ["bnMAP.pro 2025", "\u041A\u0440\u0430\u0441\u043D\u043E\u044F\u0440\u0441\u043A\u0441\u0442\u0430\u0442"], needsVerification: ["krtProgramsHa"] }
  }
};
var ALL_CITY_KEYS = Object.keys(RUSSIA_MILLION_CITIES);
var CITY_COORDINATES = {
  novosibirsk: { lat: 55.0084, lng: 82.9357 },
  yekaterinburg: { lat: 56.8389, lng: 60.6057 },
  kazan: { lat: 55.8304, lng: 49.0661 },
  nizhny: { lat: 56.2965, lng: 43.9361 },
  chelyabinsk: { lat: 55.1644, lng: 61.4368 },
  samara: { lat: 53.1959, lng: 50.1002 },
  ufa: { lat: 54.7388, lng: 55.9721 },
  rostov: { lat: 47.2357, lng: 39.7015 },
  omsk: { lat: 54.9885, lng: 73.3242 },
  krasnodar: { lat: 45.0355, lng: 38.9753 },
  voronezh: { lat: 51.672, lng: 39.1843 },
  volgograd: { lat: 48.708, lng: 44.5133 },
  perm: { lat: 58.0105, lng: 56.2502 },
  krasnoyarsk: { lat: 56.0184, lng: 92.8672 }
};

// src/engine/datasources/cbr.ts
async function fetchCbrSnapshot() {
  const FALLBACK = {
    asOfDate: "2026-04-27",
    keyRateAnnual: 14.5,
    mortgageRateAnnual: 17.8,
    preferentialMortgageRate: 6,
    // Семейная ипотека
    source: "\u0411\u0430\u043D\u043A \u0420\u043E\u0441\u0441\u0438\u0438 / \u0414\u043E\u043C.\u0420\u0424 (\u0441\u0442\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0441\u043D\u0438\u043C\u043E\u043A)",
    fetchMethod: "manual"
  };
  if (typeof fetch !== "function") return FALLBACK;
  try {
    const url = "https://www.cbr.ru/scripts/xml_keyrate.asp";
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "/");
    const fromDate = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10).replace(/-/g, "/");
    const response = await fetch(`${url}?DateFrom=${fromDate}&DateTo=${today}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    const rateMatches = [...xml.matchAll(/<Rate>([\d.,]+)<\/Rate>/g)];
    if (rateMatches.length === 0) throw new Error("no Rate tags");
    const lastRate = parseFloat(
      rateMatches[rateMatches.length - 1][1].replace(",", ".")
    );
    return {
      asOfDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      keyRateAnnual: lastRate,
      // Рыночная ипотека = ключевая + 2.5-3.5 п.п. (расчёт по корреляции)
      mortgageRateAnnual: lastRate + 3.3,
      preferentialMortgageRate: 6,
      // Семейная ипотека пока 6%
      source: "cbr.ru/scripts/xml_keyrate.asp",
      fetchMethod: "automatic"
    };
  } catch (e) {
    console.warn("[cbr] fetch failed, using fallback:", e);
    return FALLBACK;
  }
}

// src/data/ranking.ts
var RU_MEDIAN_SALARY = 56443;
var RU_MEDIAN_PRICE_PER_M2 = 152410;
async function buildCityRanking() {
  const t0 = Date.now();
  const cbr = await fetchCbrSnapshot();
  const macroInputs = {
    keyRateAnnual: cbr.keyRateAnnual,
    mortgageRateAnnual: cbr.mortgageRateAnnual,
    preferentialMortgageRate: cbr.preferentialMortgageRate,
    mortgageShareOfDeals: 0.78,
    // 78% сделок с ипотекой, Дом.РФ 2025
    inflationYoY: 5.9,
    // Банк России март 2026
    realIncomeIndex3yr: 1.085,
    // +8.5% за 3 года, Росстат
    unemploymentRate: 3.2,
    medianMonthlyIncomeRu: RU_MEDIAN_SALARY,
    medianPricePerM2Ru: RU_MEDIAN_PRICE_PER_M2
  };
  const macro = calculateMacroScore(macroInputs);
  const cities = ALL_CITY_KEYS.map((key) => {
    const entry = RUSSIA_MILLION_CITIES[key];
    const score = calculateCityScore(entry.inputs, {
      macroMultiplier: macro.macroMultiplier,
      ruMedianSalary: RU_MEDIAN_SALARY
    });
    return {
      key,
      name: score.cityName,
      region: score.region,
      cityScore: score.cityScore,
      zone: score.zone,
      breakdown: score.breakdown,
      summary: score.summary,
      coordinates: CITY_COORDINATES[key],
      dataAsOfDate: entry.meta.dataAsOfDate,
      sources: entry.meta.sources,
      inputs: entry.inputs,
      needsVerification: entry.meta.needsVerification
    };
  });
  cities.sort((a, b) => b.cityScore - a.cityScore);
  return {
    cities,
    macroSnapshot: {
      keyRateAnnual: cbr.keyRateAnnual,
      mortgageRateAnnual: cbr.mortgageRateAnnual,
      preferentialMortgageRate: cbr.preferentialMortgageRate,
      asOfDate: cbr.asOfDate,
      source: cbr.source,
      fetchMethod: cbr.fetchMethod,
      macroScore: macro.macroScore,
      macroMultiplier: macro.macroMultiplier
    },
    durationMs: Date.now() - t0
  };
}
export {
  ALL_CITY_KEYS,
  CITY_COORDINATES,
  DEFAULT_FINANCING_PARAMS,
  DEFAULT_SCORING_WEIGHTS,
  IRR_NORMALIZATION,
  RUSSIA_MILLION_CITIES,
  SCENARIO_ADJUSTMENTS,
  SENSITIVITY_DELTAS,
  SUCCESS_PROB_PENALTIES,
  SUCCESS_PROB_WEIGHTS,
  ZONE_THRESHOLDS,
  buildCityRanking,
  calculateCityScore,
  calculateDistrictScore,
  calculateIRR,
  calculateMacroScore,
  calculateNPV,
  calculateSiteScore,
  calculateSuccessProb,
  normalizeIrrToScore,
  runFinancialModel,
  runScenario,
  scoreToZone
};
