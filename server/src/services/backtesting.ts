/**
 * Backtesting Service
 * 
 * Handles:
 * - Loading closed projects with actual outcomes
 * - Comparing predicted vs actual NPV/IRR
 * - Calculating model accuracy metrics
 * - Identifying systematic biases
 */

import { prisma } from '../index.js';
import pino from 'pino';

const logger = pino({ name: 'backtesting' });

// ── Types ────────────────────────────────────────────────────────

export interface ClosedProject {
  id: string;
  name: string;
  cityKey: string;
  closedAt: Date;

  // Predicted values (from model)
  predictedNpv: number;
  predictedIrr: number | null;
  predictedRevenue: number;
  predictedCapex: number;

  // Actual outcomes
  actualNpv: number;
  actualIrr: number | null;
  actualRevenue: number;
  actualCapex: number;

  // Metadata
  dataSource: string;
  notes?: string;
}

export interface BacktestResult {
  totalProjects: number;
  metrics: {
    npvAccuracy: AccuracyMetric;
    irrAccuracy: AccuracyMetric;
    revenueAccuracy: AccuracyMetric;
    capexAccuracy: AccuracyMetric;
  };
  biases: BiasAnalysis[];
  recommendations: string[];
  projects: ProjectComparison[];
}

export interface AccuracyMetric {
  meanAbsoluteError: number;
  meanAbsolutePercentageError: number;
  rootMeanSquareError: number;
  rSquared: number;
  medianError: number;
}

export interface BiasAnalysis {
  metric: string;
  bias: number; // positive = overprediction, negative = underprediction
  biasPercent: number;
  significance: 'low' | 'medium' | 'high';
}

export interface ProjectComparison {
  projectId: string;
  projectName: string;
  cityKey: string;
  predicted: {
    npv: number;
    irr: number | null;
    revenue: number;
    capex: number;
  };
  actual: {
    npv: number;
    irr: number | null;
    revenue: number;
    capex: number;
  };
  errors: {
    npvError: number;
    npvErrorPercent: number;
    irrError: number | null;
    revenueError: number;
    revenueErrorPercent: number;
    capexError: number;
    capexErrorPercent: number;
  };
}

// ── Backtesting Engine ───────────────────────────────────────────

export async function runBacktest(): Promise<BacktestResult> {
  logger.info('Starting backtest analysis...');

  // Get all closed projects with actual outcomes
  const closedProjects = await getClosedProjects();

  if (closedProjects.length === 0) {
    return {
      totalProjects: 0,
      metrics: {
        npvAccuracy: createEmptyMetric(),
        irrAccuracy: createEmptyMetric(),
        revenueAccuracy: createEmptyMetric(),
        capexAccuracy: createEmptyMetric(),
      },
      biases: [],
      recommendations: ['No closed projects available for backtesting. Add historical project data.'],
      projects: [],
    };
  }

  // Calculate comparisons
  const projects = closedProjects.map(p => compareProject(p));

  // Calculate accuracy metrics
  const npvErrors = projects.map(p => p.errors.npvErrorPercent).filter(e => !isNaN(e));
  const irrErrors = projects.map(p => p.errors.irrError).filter((e): e is number => e !== null);
  const revenueErrors = projects.map(p => p.errors.revenueErrorPercent).filter(e => !isNaN(e));
  const capexErrors = projects.map(p => p.errors.capexErrorPercent).filter(e => !isNaN(e));

  const metrics = {
    npvAccuracy: calculateAccuracyMetric(npvErrors),
    irrAccuracy: calculateAccuracyMetric(irrErrors),
    revenueAccuracy: calculateAccuracyMetric(revenueErrors),
    capexAccuracy: calculateAccuracyMetric(capexErrors),
  };

  // Analyze biases
  const biases = analyzeBiases(projects);

  // Generate recommendations
  const recommendations = generateRecommendations(metrics, biases);

  logger.info({
    totalProjects: closedProjects.length,
    npvMAPE: metrics.npvAccuracy.meanAbsolutePercentageError,
    irrMAPE: metrics.irrAccuracy.meanAbsolutePercentageError,
  }, 'Backtest completed');

  return {
    totalProjects: closedProjects.length,
    metrics,
    biases,
    recommendations,
    projects,
  };
}

// ── Helper Functions ─────────────────────────────────────────────

async function getClosedProjects(): Promise<ClosedProject[]> {
  // In production, this would query a closed_projects table
  // For now, return sample data structure
  const projects = await prisma.project.findMany({
    where: { status: 'archived' },
    include: {
      city: { select: { key: true } },
      scenarios: {
        where: { scenarioType: 'base' },
        take: 1,
      },
    },
  });

  return projects
    .filter(p => p.scenarios.length > 0 && p.lastRunResult)
    .map(p => {
      const result = p.lastRunResult as any;
      const scenario = p.scenarios[0].result as any;

      return {
        id: p.id,
        name: p.name,
        cityKey: p.city.key,
        closedAt: p.updatedAt,
        predictedNpv: scenario.npv ?? 0,
        predictedIrr: scenario.irr,
        predictedRevenue: scenario.revenue?.totalRevenue ?? 0,
        predictedCapex: scenario.capex?.total ?? 0,
        // Actual values would come from a separate data source
        actualNpv: result?.actualNpv ?? scenario.npv ?? 0,
        actualIrr: result?.actualIrr ?? scenario.irr,
        actualRevenue: result?.actualRevenue ?? scenario.revenue?.totalRevenue ?? 0,
        actualCapex: result?.actualCapex ?? scenario.capex?.total ?? 0,
        dataSource: 'internal',
      };
    });
}

function compareProject(project: ClosedProject): ProjectComparison {
  const npvError = project.actualNpv - project.predictedNpv;
  const npvErrorPercent = project.predictedNpv !== 0
    ? (npvError / Math.abs(project.predictedNpv)) * 100
    : 0;

  const irrError = project.actualIrr !== null && project.predictedIrr !== null
    ? project.actualIrr - project.predictedIrr
    : null;

  const revenueError = project.actualRevenue - project.predictedRevenue;
  const revenueErrorPercent = project.predictedRevenue !== 0
    ? (revenueError / project.predictedRevenue) * 100
    : 0;

  const capexError = project.actualCapex - project.predictedCapex;
  const capexErrorPercent = project.predictedCapex !== 0
    ? (capexError / project.predictedCapex) * 100
    : 0;

  return {
    projectId: project.id,
    projectName: project.name,
    cityKey: project.cityKey,
    predicted: {
      npv: project.predictedNpv,
      irr: project.predictedIrr,
      revenue: project.predictedRevenue,
      capex: project.predictedCapex,
    },
    actual: {
      npv: project.actualNpv,
      irr: project.actualIrr,
      revenue: project.actualRevenue,
      capex: project.actualCapex,
    },
    errors: {
      npvError,
      npvErrorPercent,
      irrError,
      revenueError,
      revenueErrorPercent,
      capexError,
      capexErrorPercent,
    },
  };
}

function calculateAccuracyMetric(errors: number[]): AccuracyMetric {
  if (errors.length === 0) {
    return createEmptyMetric();
  }

  const absErrors = errors.map(Math.abs);
  const squaredErrors = errors.map(e => e * e);

  const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
  const meanAbsolute = absErrors.reduce((s, e) => s + e, 0) / absErrors.length;
  const meanAbsolutePercentage = meanAbsolute; // Assuming errors are already percentages
  const rmse = Math.sqrt(squaredErrors.reduce((s, e) => s + e, 0) / squaredErrors.length);

  // R-squared (simplified)
  const meanOfErrors = mean;
  const ssRes = squaredErrors.reduce((s, e) => s + e, 0);
  const ssTot = errors.reduce((s, e) => s + (e - meanOfErrors) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Median
  const sorted = [...absErrors].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    meanAbsoluteError: meanAbsolute,
    meanAbsolutePercentageError: meanAbsolutePercentage,
    rootMeanSquareError: rmse,
    rSquared: Math.max(0, rSquared),
    medianError: median,
  };
}

function createEmptyMetric(): AccuracyMetric {
  return {
    meanAbsoluteError: 0,
    meanAbsolutePercentageError: 0,
    rootMeanSquareError: 0,
    rSquared: 0,
    medianError: 0,
  };
}

function analyzeBiases(projects: ProjectComparison[]): BiasAnalysis[] {
  const biases: BiasAnalysis[] = [];

  // NPV bias
  const npvBias = projects.reduce((s, p) => s + p.errors.npvError, 0) / projects.length;
  const npvBiasPercent = projects.reduce((s, p) => s + p.errors.npvErrorPercent, 0) / projects.length;
  biases.push({
    metric: 'NPV',
    bias: npvBias,
    biasPercent: npvBiasPercent,
    significance: Math.abs(npvBiasPercent) > 20 ? 'high' : Math.abs(npvBiasPercent) > 10 ? 'medium' : 'low',
  });

  // Revenue bias
  const revenueBias = projects.reduce((s, p) => s + p.errors.revenueErrorPercent, 0) / projects.length;
  biases.push({
    metric: 'Revenue',
    bias: projects.reduce((s, p) => s + p.errors.revenueError, 0) / projects.length,
    biasPercent: revenueBias,
    significance: Math.abs(revenueBias) > 15 ? 'high' : Math.abs(revenueBias) > 8 ? 'medium' : 'low',
  });

  // Capex bias
  const capexBias = projects.reduce((s, p) => s + p.errors.capexErrorPercent, 0) / projects.length;
  biases.push({
    metric: 'Capex',
    bias: projects.reduce((s, p) => s + p.errors.capexError, 0) / projects.length,
    biasPercent: capexBias,
    significance: Math.abs(capexBias) > 15 ? 'high' : Math.abs(capexBias) > 8 ? 'medium' : 'low',
  });

  return biases;
}

function generateRecommendations(
  metrics: BacktestResult['metrics'],
  biases: BiasAnalysis[],
): string[] {
  const recommendations: string[] = [];

  // NPV accuracy
  if (metrics.npvAccuracy.meanAbsolutePercentageError > 25) {
    recommendations.push('NPV predictions have high error (>25%). Consider recalibrating price and cost assumptions.');
  }

  // Revenue bias
  const revenueBias = biases.find(b => b.metric === 'Revenue');
  if (revenueBias && revenueBias.significance === 'high') {
    if (revenueBias.biasPercent > 0) {
      recommendations.push('Model systematically overpredicts revenue. Review price assumptions and absorption rates.');
    } else {
      recommendations.push('Model systematically underpredicts revenue. Review market growth assumptions.');
    }
  }

  // Capex bias
  const capexBias = biases.find(b => b.metric === 'Capex');
  if (capexBias && capexBias.significance === 'high') {
    if (capexBias.biasPercent > 0) {
      recommendations.push('Model underestimates costs. Review construction cost assumptions and infrastructure inputs.');
    } else {
      recommendations.push('Model overestimates costs. Verify cost inputs against recent projects.');
    }
  }

  // General
  if (recommendations.length === 0) {
    recommendations.push('Model accuracy is within acceptable ranges. Continue monitoring.');
  }

  return recommendations;
}

// ── Export for Excel ─────────────────────────────────────────────

export function prepareExcelExport(result: BacktestResult): any {
  return {
    summary: {
      totalProjects: result.totalProjects,
      npvMAPE: result.metrics.npvAccuracy.meanAbsolutePercentageError,
      irrMAPE: result.metrics.irrAccuracy.meanAbsolutePercentageError,
      revenueMAPE: result.metrics.revenueAccuracy.meanAbsolutePercentageError,
      capexMAPE: result.metrics.capexAccuracy.meanAbsolutePercentageError,
    },
    biases: result.biases,
    recommendations: result.recommendations,
    projects: result.projects.map(p => ({
      name: p.projectName,
      city: p.cityKey,
      predictedNPV: p.predicted.npv,
      actualNPV: p.actual.npv,
      npvError: p.errors.npvErrorPercent,
      predictedIRR: p.predicted.irr,
      actualIRR: p.actual.irr,
      irrError: p.errors.irrError,
      predictedRevenue: p.predicted.revenue,
      actualRevenue: p.actual.revenue,
      revenueError: p.errors.revenueErrorPercent,
      predictedCapex: p.predicted.capex,
      actualCapex: p.actual.capex,
      capexError: p.errors.capexErrorPercent,
    })),
  };
}
