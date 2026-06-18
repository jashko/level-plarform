/**
 * Financial Engine Service — wraps the existing LEVEL engine for API use.
 * This bridges the frontend engine code with the backend API.
 */

export interface ProjectFinanceParams {
  equityShare: number;
  pfBaseRateAnnual: number;
  pfEscrowCoveredRateAnnual: number;
  escrowReleaseLagMonths: number;
  escrowCoverageDiscount: number;
  escrowDiscountActivationProgress: number;
  pfCommitmentFeeAnnual: number;
  pfCommittedLineMultiplier: number;
  escrowMidReleasePct: number;
  escrowMidReleaseProgressPct: number;
}

export interface ProjectInputs {
  landAreaHa: number;
  allowedDensityM2PerHa: number;
  sellableRatio: number;
  averageUnitSizeM2: number;
  housingClass: 'comfort' | 'business';
  basePricePerM2: number;
  landCost: number;
  constructionCostPerM2: number;
  infrastructureCost: number;
  marketingShare: number;
  constructionMonths: number;
  discountRateAnnual: number;
  salesVelocityM2PerMonth: number;
  salesStartMonth: number;
  financing: ProjectFinanceParams;
  dduCancellationRatePct?: number;
  workingCapitalPct?: number;
  opexPctOfConstructionAnnual?: number;
  propertyTaxPct?: number;
  seasonalityEnabled?: boolean;
  projectStartCalendarMonth?: number;
  corpTaxRatePct?: number;
  annualPriceGrowthPct?: number;
  annualCostInflationPct?: number;
}

export type Scenario = 'base' | 'optimistic' | 'stress';

export interface ScenarioResult {
  scenario: Scenario;
  volumes: { totalBuildableM2: number; sellableM2: number; unitCount: number };
  revenue: { pricePerM2: number; totalRevenue: number; scenario: Scenario };
  capex: { land: number; construction: number; infrastructure: number; marketing: number; transactions: number; total: number };
  monthlyCashFlow: any[];
  npv: number;
  irr: number | null;
  grossMargin: number;
  netMargin: number;
  roe: number;
  dscr: number | null;
  totalPfInterest: number;
  peakPfBalance: number;
  totalEquityDeployed: number;
  sellOutMonths: number;
  totalProjectMonths: number;
  actualTotalRevenue: number;
  corpTaxAmount: number;
}

export interface FinancialModelOutput {
  scenarios: Record<Scenario, ScenarioResult>;
  sensitivity: any[];
  successProb: number;
  monteCarlo: {
    iterations: number;
    meanIrrPct: number;
    medianIrrPct: number;
    p10IrrPct: number;
    p90IrrPct: number;
    stdDevIrrPct: number;
    probIrrAbove20Pct: number;
    probIrrAbove25Pct: number;
    probNpvPositivePct: number;
  };
  realOption: any;
  warnings: string[];
}

// ── SCENARIO_ADJUSTMENTS (mirrors src/engine/finance/config.ts) ──
const SCENARIO_ADJUSTMENTS: Record<Scenario, any> = {
  base: {
    priceMultiplier: 1.0,
    costMultiplier: 1.0,
    salesVelocityMultiplier: 1.0,
    discountRateDelta: 0,
    pfRateDelta: 0,
  },
  optimistic: {
    priceMultiplier: 1.15,
    costMultiplier: 0.95,
    salesVelocityMultiplier: 1.3,
    discountRateDelta: -3,
    pfRateDelta: -0.5,
  },
  stress: {
    priceMultiplier: 0.85,
    costMultiplier: 1.15,
    salesVelocityMultiplier: 0.5,
    discountRateDelta: 3,
    pfRateDelta: 1.0,
  },
};

// ── SALES_SEASONALITY ────────────────────────────────────────────
const SALES_SEASONALITY = [
  0.7, 0.75, 0.9, 1.0, 1.1, 1.15,
  1.05, 0.95, 1.1, 1.15, 0.9, 0.75,
];

// ── Core Calculation Functions ───────────────────────────────────
function calculateVolumes(inputs: ProjectInputs) {
  const totalBuildableM2 = inputs.landAreaHa * 10_000 * inputs.allowedDensityM2PerHa;
  const sellableM2 = totalBuildableM2 * inputs.sellableRatio;
  const unitCount = Math.floor(sellableM2 / inputs.averageUnitSizeM2);
  return { totalBuildableM2, sellableM2, unitCount };
}

function calculateRevenue(inputs: ProjectInputs, volumes: any, scenario: Scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const pricePerM2 = inputs.basePricePerM2 * adj.priceMultiplier;
  const totalRevenue = volumes.sellableM2 * pricePerM2;
  return { pricePerM2, totalRevenue, scenario };
}

function calculateCapex(inputs: ProjectInputs, volumes: any, totalRevenue: number, scenario: Scenario) {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const construction = volumes.totalBuildableM2 * inputs.constructionCostPerM2 * adj.costMultiplier;
  const land = inputs.landCost;
  const infrastructure = inputs.infrastructureCost;
  const marketing = totalRevenue * inputs.marketingShare;
  const transactions = totalRevenue * 0.01; // 1% working capital
  const total = land + construction + infrastructure + marketing + transactions;
  return { land, construction, infrastructure, marketing, transactions, total };
}

function calculateIRR(cashFlows: number[]): number | null {
  // Newton-Raphson IRR calculation
  const maxIter = 100;
  const tolerance = 1e-7;
  let rate = 0.1; // Initial guess

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + rate, t);
      dnpv -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(npv) < tolerance) return rate * 100;
    if (Math.abs(dnpv) < tolerance) break;
    rate -= npv / dnpv;
  }

  return rate > -1 ? rate * 100 : null;
}

function calculateNPV(cashFlows: number[], discountRate: number): number {
  const monthlyRate = discountRate / 100 / 12;
  return cashFlows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + monthlyRate, t), 0);
}

function runScenario(inputs: ProjectInputs, scenario: Scenario): ScenarioResult {
  const adj = SCENARIO_ADJUSTMENTS[scenario];
  const volumes = calculateVolumes(inputs);
  const revenue = calculateRevenue(inputs, volumes, scenario);
  const capex = calculateCapex(inputs, volumes, revenue.totalRevenue, scenario);

  const effectiveDiscountRate = inputs.discountRateAnnual + adj.discountRateDelta;
  const monthlyDiscountRate = effectiveDiscountRate / 100 / 12;
  const pfRate = (inputs.financing.pfBaseRateAnnual + adj.pfRateDelta) / 100;

  // Simplified monthly cash flow model
  const monthlyCashFlow: any[] = [];
  const developerCashFlows: number[] = [];
  let cumulativeM2Sold = 0;
  let escrowBalance = 0;
  let pfBalance = capex.total * (1 - inputs.financing.equityShare);
  let equityDrawn = 0;
  let cumPfInterest = 0;
  let cumDeveloperCF = 0;

  const equityRequired = capex.total * inputs.financing.equityShare;
  const salesVelocity = inputs.salesVelocityM2PerMonth * adj.salesVelocityMultiplier;

  for (let month = 1; month <= inputs.constructionMonths + 24; month++) {
    const isConstruction = month <= inputs.constructionMonths;
    const isPostConstruction = month > inputs.constructionMonths;

    // Construction spend
    const constructionSpend = isConstruction
      ? (capex.construction + capex.infrastructure) / inputs.constructionMonths
      : 0;

    // Equity draw (front-loaded)
    const equityDraw = month <= 6
      ? equityRequired / 6
      : 0;
    equityDrawn += equityDraw;

    // PF interest
    const monthlyPfInterest = pfBalance * pfRate / 12;
    cumPfInterest += monthlyPfInterest;

    // Sales (start after salesStartMonth)
    let m2Sold = 0;
    let revenue = 0;
    let escrowInflow = 0;

    if (month >= inputs.salesStartMonth) {
      const seasonIdx = (inputs.projectStartCalendarMonth + month - 2) % 12;
      const seasonalFactor = inputs.seasonalityEnabled !== false ? SALES_SEASONALITY[seasonIdx] : 1.0;
      m2Sold = Math.min(salesVelocity * seasonalFactor, volumes.sellableM2 - cumulativeM2Sold);
      cumulativeM2Sold += m2Sold;
      revenue = m2Sold * revenue.pricePerM2;

      if (isConstruction) {
        escrowInflow = revenue; // DDU payments go to escrow
        escrowBalance += escrowInflow;
      }
    }

    // Developer cash flow
    let developerCashFlow = -constructionSpend - equityDraw;
    if (isPostConstruction) {
      developerCashFlow += revenue; // Direct sales after construction
    }

    cumDeveloperCF += developerCashFlow;
    developerCashFlows.push(developerCashFlow);

    monthlyCashFlow.push({
      month,
      constructionSpend,
      equityDraw,
      m2Sold,
      revenue,
      escrowInflow,
      escrowBalance,
      pfInterestAccrued: monthlyPfInterest,
      cumulativePfInterest: cumPfInterest,
      developerCashFlow,
      cumulativeDeveloperCashFlow: cumDeveloperCF,
    });

    if (cumulativeM2Sold >= volumes.sellableM2 && isPostConstruction) break;
  }

  const npv = calculateNPV(developerCashFlows, effectiveDiscountRate);
  const irr = calculateIRR(developerCashFlows);

  const totalRevenue = revenue.totalRevenue;
  const netProfitPreTax = totalRevenue - capex.total - cumPfInterest;
  const corpTaxRate = (inputs.corpTaxRatePct ?? 25) / 100;
  const corpTaxAmount = Math.max(0, netProfitPreTax) * corpTaxRate;
  const netProfitAfterTax = netProfitPreTax - corpTaxAmount;

  const grossMargin = totalRevenue > 0
    ? ((totalRevenue - capex.total) / totalRevenue) * 100
    : 0;
  const netMargin = totalRevenue > 0
    ? (netProfitAfterTax / totalRevenue) * 100
    : 0;
  const roe = equityRequired > 0
    ? (netProfitAfterTax / equityRequired) * 100
    : 0;

  const sellOutMonths = volumes.sellableM2 / Math.max(salesVelocity, 1);
  const totalProjectMonths = monthlyCashFlow.length;

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
    roe,
    dscr: null,
    totalPfInterest: cumPfInterest,
    peakPfBalance: pfBalance,
    totalEquityDeployed: equityDrawn,
    sellOutMonths,
    totalProjectMonths,
    actualTotalRevenue: totalRevenue,
    corpTaxAmount,
  };
}

function runMonteCarlo(
  runScenarioFn: (inputs: ProjectInputs, scenario: Scenario) => ScenarioResult,
  inputs: ProjectInputs,
  iterations: number,
): FinancialModelOutput['monteCarlo'] {
  const irrSamples: number[] = [];
  const npvSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // Random perturbations
    const perturbedInputs = {
      ...inputs,
      basePricePerM2: inputs.basePricePerM2 * (0.88 + Math.random() * 0.24), // ±12%
      constructionCostPerM2: inputs.constructionCostPerM2 * (0.9 + Math.random() * 0.2), // ±10%
      salesVelocityM2PerMonth: inputs.salesVelocityM2PerMonth * (0.8 + Math.random() * 0.4), // ±20%
    };

    const result = runScenarioFn(perturbedInputs, 'base');
    if (result.irr !== null) irrSamples.push(result.irr);
    npvSamples.push(result.npv);
  }

  irrSamples.sort((a, b) => a - b);
  npvSamples.sort((a, b) => a - b);

  const mean = irrSamples.reduce((s, v) => s + v, 0) / irrSamples.length;
  const median = irrSamples[Math.floor(irrSamples.length / 2)];
  const p10 = irrSamples[Math.floor(irrSamples.length * 0.1)];
  const p90 = irrSamples[Math.floor(irrSamples.length * 0.9)];
  const variance = irrSamples.reduce((s, v) => s + (v - mean) ** 2, 0) / irrSamples.length;

  return {
    iterations,
    meanIrrPct: mean,
    medianIrrPct: median,
    p10IrrPct: p10,
    p90IrrPct: p90,
    stdDevIrrPct: Math.sqrt(variance),
    probIrrAbove20Pct: (irrSamples.filter(v => v >= 20).length / iterations) * 100,
    probIrrAbove25Pct: (irrSamples.filter(v => v >= 25).length / iterations) * 100,
    probNpvPositivePct: (npvSamples.filter(v => v > 0).length / iterations) * 100,
  };
}

// ── Main Export ──────────────────────────────────────────────────
export function runFinancialModel(
  inputs: ProjectInputs,
  options?: { successProbContext?: any },
): FinancialModelOutput {
  const scenarios = {
    base: runScenario(inputs, 'base'),
    optimistic: runScenario(inputs, 'optimistic'),
    stress: runScenario(inputs, 'stress'),
  };

  // Sensitivity analysis
  const sensitivity = [
    { variable: 'pricePerM2', cells: [-15, -10, -5, 0, 5, 10, 15].map(d => ({
      variable: 'pricePerM2' as const, delta: d,
      irr: runScenario({ ...inputs, basePricePerM2: inputs.basePricePerM2 * (1 + d / 100) }, 'base').irr,
      npv: runScenario({ ...inputs, basePricePerM2: inputs.basePricePerM2 * (1 + d / 100) }, 'base').npv,
    }))},
    { variable: 'constructionCost', cells: [-10, -5, 0, 5, 10].map(d => ({
      variable: 'constructionCost' as const, delta: d,
      irr: runScenario({ ...inputs, constructionCostPerM2: inputs.constructionCostPerM2 * (1 + d / 100) }, 'base').irr,
      npv: runScenario({ ...inputs, constructionCostPerM2: inputs.constructionCostPerM2 * (1 + d / 100) }, 'base').npv,
    }))},
    { variable: 'salesVelocity', cells: [-20, -10, 0, 10, 20].map(d => ({
      variable: 'salesVelocity' as const, delta: d,
      irr: runScenario({ ...inputs, salesVelocityM2PerMonth: inputs.salesVelocityM2PerMonth * (1 + d / 100) }, 'base').irr,
      npv: runScenario({ ...inputs, salesVelocityM2PerMonth: inputs.salesVelocityM2PerMonth * (1 + d / 100) }, 'base').npv,
    }))},
    { variable: 'discountRate', cells: [-3, -1.5, 0, 1.5, 3].map(d => ({
      variable: 'discountRate' as const, delta: d,
      irr: runScenario({ ...inputs, discountRateAnnual: inputs.discountRateAnnual + d }, 'base').irr,
      npv: runScenario({ ...inputs, discountRateAnnual: inputs.discountRateAnnual + d }, 'base').npv,
    }))},
  ];

  const monteCarlo = runMonteCarlo(runScenario, inputs, 500);

  const warnings: string[] = [];
  if (scenarios.base.irr !== null && scenarios.base.irr < 20) {
    warnings.push(`IRR ${scenarios.base.irr.toFixed(1)}% < 20% — ниже порога для бизнес-класса`);
  }
  if (scenarios.stress.irr !== null && scenarios.stress.irr < 0) {
    warnings.push('IRR в стресс-сценарии отрицательный');
  }
  if (scenarios.base.grossMargin < 20) {
    warnings.push(`Валовая маржа ${scenarios.base.grossMargin.toFixed(1)}% < 20%`);
  }

  return {
    scenarios,
    sensitivity,
    successProb: monteCarlo.probIrrAbove20Pct,
    monteCarlo,
    realOption: null,
    warnings,
  };
}
