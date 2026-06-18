/**
 * Excel Export Service
 * 
 * Generates Excel-compatible CSV files with:
 * - Financial model scenarios
 * - Tornado diagrams data
 * - Monte Carlo results
 * - Sensitivity analysis
 * - All parameters with sources
 */

import { prisma } from '../index.js';
import pino from 'pino';

const logger = pino({ name: 'excel-export' });

// ── Types ────────────────────────────────────────────────────────

export interface ExcelExportData {
  filename: string;
  sheets: ExcelSheet[];
}

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

// ── Export Functions ─────────────────────────────────────────────

export async function generateProjectExport(projectId: string): Promise<ExcelExportData> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      city: true,
      scenarios: true,
      sensitivityResults: true,
      monteCarloResults: true,
    },
  });

  if (!project) {
    throw new Error('Project not found');
  }

  const sheets: ExcelSheet[] = [];

  // Sheet 1: Parameters
  sheets.push(generateParametersSheet(project));

  // Sheet 2: Scenarios
  sheets.push(generateScenariosSheet(project));

  // Sheet 3: Sensitivity
  if (project.sensitivityResults.length > 0) {
    sheets.push(generateSensitivitySheet(project));
  }

  // Sheet 4: Monte Carlo
  if (project.monteCarloResults.length > 0) {
    sheets.push(generateMonteCarloSheet(project));
  }

  // Sheet 5: Cash Flow (Base Scenario)
  const baseScenario = project.scenarios.find(s => s.scenarioType === 'base');
  if (baseScenario) {
    sheets.push(generateCashFlowSheet(baseScenario));
  }

  return {
    filename: `LEVEL_${project.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`,
    sheets,
  };
}

// ── Sheet Generators ─────────────────────────────────────────────

function generateParametersSheet(project: any): ExcelSheet {
  const params = [
    ['Category', 'Parameter', 'Value', 'Unit', 'Source'],
    ['Site', 'Land Area', project.landAreaHa, 'ha', 'Project input'],
    ['Site', 'Allowed Density', project.allowedDensityM2PerHa, 'm²/ha', 'Project input'],
    ['Site', 'Sellable Ratio', project.sellableRatio, '%', 'Project input'],
    ['Site', 'Average Unit Size', project.averageUnitSizeM2, 'm²', 'Project input'],
    ['Financial', 'Base Price per m²', project.basePricePerM2, '₽/m²', 'Project input'],
    ['Financial', 'Land Cost', project.landCost, '₽', 'Project input'],
    ['Financial', 'Construction Cost per m²', project.constructionCostPerM2, '₽/m²', 'Project input'],
    ['Financial', 'Infrastructure Cost', project.infrastructureCost, '₽', 'Project input'],
    ['Financial', 'Marketing Share', project.marketingShare, '%', 'Project input'],
    ['Financial', 'Construction Months', project.constructionMonths, 'months', 'Project input'],
    ['Financial', 'Discount Rate', project.discountRateAnnual, '%', 'Project input'],
    ['Financial', 'Sales Velocity', project.salesVelocityM2PerMonth, 'm²/month', 'Project input'],
    ['Financing', 'Equity Share', project.equityShare, '%', 'Project input'],
    ['Financing', 'PF Base Rate', project.pfBaseRateAnnual, '%', 'Project input'],
    ['Financing', 'PF Escrow Rate', project.pfEscrowCoveredRateAnnual, '%', 'Project input'],
    ['Financing', 'Escrow Release Lag', project.escrowReleaseLagMonths, 'months', 'Project input'],
    ['Tax', 'Corporate Tax Rate', project.corpTaxRatePct ?? 25, '%', 'НК РФ'],
    ['Tax', 'Property Tax', project.propertyTaxPct ?? 2.2, '%', 'НК РФ ст. 380'],
  ];

  return {
    name: 'Parameters',
    headers: params[0] as string[],
    rows: params.slice(1),
  };
}

function generateScenariosSheet(project: any): ExcelSheet {
  const scenarios = project.scenarios.map((s: any) => {
    const result = s.result;
    return {
      type: s.scenarioType,
      npv: result.npv,
      irr: result.irr,
      grossMargin: result.grossMargin,
      netMargin: result.netMargin,
      roe: result.roe,
      revenue: result.revenue?.totalRevenue,
      capex: result.capex?.total,
      sellOutMonths: result.sellOutMonths,
      totalProjectMonths: result.totalProjectMonths,
    };
  });

  const headers = [
    'Scenario', 'NPV (₽)', 'IRR (%)', 'Gross Margin (%)', 'Net Margin (%)',
    'ROE (%)', 'Revenue (₽)', 'CAPEX (₽)', 'Sell-out (months)', 'Project Duration (months)',
  ];

  const rows = scenarios.map((s: any) => [
    s.type.toUpperCase(),
    Math.round(s.npv),
    s.irr?.toFixed(1) ?? 'N/A',
    s.grossMargin?.toFixed(1),
    s.netMargin?.toFixed(1),
    s.roe?.toFixed(1),
    Math.round(s.revenue),
    Math.round(s.capex),
    Math.round(s.sellOutMonths),
    s.totalProjectMonths,
  ]);

  return {
    name: 'Scenarios',
    headers,
    rows,
  };
}

function generateSensitivitySheet(project: any): ExcelSheet {
  const headers = ['Variable', 'Delta (%)', 'IRR (%)', 'NPV (₽)'];
  const rows: (string | number)[][] = [];

  for (const table of project.sensitivityResults) {
    const cells = table.cells as any[];
    for (const cell of cells) {
      rows.push([
        table.variable,
        cell.delta,
        cell.irr?.toFixed(1) ?? 'N/A',
        Math.round(cell.npv),
      ]);
    }
    rows.push([]); // Empty row between variables
  }

  return {
    name: 'Sensitivity',
    headers,
    rows,
  };
}

function generateMonteCarloSheet(project: any): ExcelSheet {
  const mc = project.monteCarloResults[0]?.result;
  if (!mc) {
    return { name: 'Monte Carlo', headers: [], rows: [] };
  }

  const headers = ['Metric', 'Value'];
  const rows = [
    ['Iterations', mc.iterations],
    ['Mean IRR (%)', mc.meanIrrPct?.toFixed(2)],
    ['Median IRR (%)', mc.medianIrrPct?.toFixed(2)],
    ['10th Percentile IRR (%)', mc.p10IrrPct?.toFixed(2)],
    ['90th Percentile IRR (%)', mc.p90IrrPct?.toFixed(2)],
    ['Std Dev IRR (%)', mc.stdDevIrrPct?.toFixed(2)],
    ['P(IRR ≥ 20%) (%)', mc.probIrrAbove20Pct?.toFixed(1)],
    ['P(IRR ≥ 25%) (%)', mc.probIrrAbove25Pct?.toFixed(1)],
    ['P(NPV > 0) (%)', mc.probNpvPositivePct?.toFixed(1)],
  ];

  return {
    name: 'Monte Carlo',
    headers,
    rows,
  };
}

function generateCashFlowSheet(scenario: any): ExcelSheet {
  const result = scenario.result;
  const cashFlow = result.monthlyCashFlow || [];

  const headers = [
    'Month', 'Construction Spend', 'Revenue', 'Escrow Inflow', 'Escrow Balance',
    'PF Interest', 'Developer Cash Flow', 'Cumulative CF',
  ];

  const rows = cashFlow.map((cf: any) => [
    cf.month,
    Math.round(cf.constructionSpend),
    Math.round(cf.revenue),
    Math.round(cf.escrowInflow),
    Math.round(cf.escrowBalance),
    Math.round(cf.pfInterestAccrued),
    Math.round(cf.developerCashFlow),
    Math.round(cf.cumulativeDeveloperCashFlow),
  ]);

  return {
    name: 'Cash Flow',
    headers,
    rows,
  };
}

// ── CSV Generator ────────────────────────────────────────────────

export function generateCSV(data: ExcelExportData): string {
  const parts: string[] = [];

  for (const sheet of data.sheets) {
    parts.push(`\n=== ${sheet.name} ===\n`);

    // Headers
    parts.push(sheet.headers.join(','));

    // Rows
    for (const row of sheet.rows) {
      parts.push(row.map(cell => {
        if (typeof cell === 'string' && cell.includes(',')) {
          return `"${cell}"`;
        }
        return String(cell ?? '');
      }).join(','));
    }
  }

  return parts.join('\n');
}

// ── Model Card Generator ─────────────────────────────────────────

export interface ModelCard {
  parameter: string;
  description: string;
  range: string;
  source: string;
  lastUpdated: string;
  confidence: 'high' | 'medium' | 'low';
}

export function generateModelCards(): ModelCard[] {
  return [
    {
      parameter: 'businessClassPricePerM2',
      description: 'Средняя цена квадратного метра в новостройках бизнес-класса',
      range: '150,000 - 350,000 ₽/m²',
      source: 'bnMAP.pro, НДВ, МИР КВАРТИР',
      lastUpdated: '2026-05-31',
      confidence: 'high',
    },
    {
      parameter: 'avgSalary',
      description: 'Среднемесячная начисленная зарплата по городу',
      range: '50,000 - 120,000 ₽/мес',
      source: 'Росстат, visasam.ru',
      lastUpdated: '2026-05-31',
      confidence: 'high',
    },
    {
      parameter: 'dealsGrowthYoY',
      description: 'Рост объёма сделок новостроек год к году',
      range: '-50% to +30%',
      source: 'Коммерсант, Циан',
      lastUpdated: '2026-05-31',
      confidence: 'medium',
    },
    {
      parameter: 'monthsOfSupply',
      description: 'Запас предложения в месяцах (предложение / помесячные продажи)',
      range: '3 - 24 месяца',
      source: 'ЕИСЖС, ДОМ.РФ',
      lastUpdated: '2026-05-31',
      confidence: 'medium',
    },
    {
      parameter: 'keyRateAnnual',
      description: 'Ключевая ставка ЦБ РФ',
      range: '5% - 25%',
      source: 'ЦБ РФ (XML-фид)',
      lastUpdated: 'Автоматически',
      confidence: 'high',
    },
    {
      parameter: 'mortgageRateAnnual',
      description: 'Средневзвешенная ставка по рыночной ипотеке',
      range: '15% - 30%',
      source: 'banki.ru, sravni.ru',
      lastUpdated: '2026-05-31',
      confidence: 'medium',
    },
    {
      parameter: 'constructionCostPerM2',
      description: 'Нормативная себестоимость строительства МКД',
      range: '60,000 - 100,000 ₽/m²',
      source: 'Минстрой РФ 2025',
      lastUpdated: '2025-01-01',
      confidence: 'high',
    },
    {
      parameter: 'krtProgramsHa',
      description: 'Площадь территорий комплексного развития',
      range: '0 - 1000 га',
      source: 'Минстрой РФ, РБК региональные',
      lastUpdated: '2025-12-31',
      confidence: 'low',
    },
    {
      parameter: 'equityShare',
      description: 'Доля собственного капитала в CAPEX',
      range: '15% - 25%',
      source: 'Отраслевая практика',
      lastUpdated: 'Норматив',
      confidence: 'high',
    },
    {
      parameter: 'dduCancellationRatePct',
      description: 'Доля расторжений ДДУ',
      range: '5% - 12%',
      source: 'Росреестр 2024-2025',
      lastUpdated: '2025-01-01',
      confidence: 'medium',
    },
  ];
}
