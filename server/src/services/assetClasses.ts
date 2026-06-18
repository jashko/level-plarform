/**
 * Asset Classes Service
 * 
 * Manages different property types (residential, commercial, hotel, mixed-use)
 * with their specific parameters, tax rates, and capex models.
 */

import { prisma, redis } from '../index.js';
import pino from 'pino';

const logger = pino({ name: 'asset-classes' });

// ── Types ────────────────────────────────────────────────────────

export interface AssetClassConfig {
  id: string;
  name: string;
  displayName: string;
  description: string;

  // Financial parameters
  taxRate: number;              // Corporate tax rate (%)
  vatRate: number;              // VAT rate (%)
  propertyTaxRate: number;      // Property tax rate (%)

  // Capex model
  constructionCostMultiplier: number; // Multiplier vs base
  infrastructureCostMultiplier: number;
  marketingShareRange: [number, number]; // Min-max %

  // Revenue model
  priceMultiplier: number;      // vs base residential
  sellableRatioRange: [number, number];
  averageUnitSizeRange: [number, number];

  // Sales dynamics
  absorptionRateRange: [number, number]; // months
  seasonalityPattern: number[]; // 12 monthly factors

  // Financing
  equityShareRange: [number, number];
  pfRateAdjustment: number;     // Adjustment vs residential

  // Metadata
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RegionConfig {
  id: string;
  name: string;
  countryCode: string;
  currency: string;

  // Tax regime
  corporateTaxRate: number;
  vatRate: number;
  propertyTaxRate: number;
  dividendTaxRate: number;

  // Financing
  centralBankRate: number;
  mortgageRateRange: [number, number];
  pfRateRange: [number, number];

  // Regulatory
  escrowRequired: boolean;
  dduRequired: boolean;
  foreignOwnershipRestrictions: boolean;

  // Market
  typicalAbsorptionMonths: number;
  priceGrowthTypical: number;

  // Metadata
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Default Asset Classes ────────────────────────────────────────

const DEFAULT_ASSET_CLASSES: Omit<AssetClassConfig, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'residential_business',
    displayName: 'Жилой бизнес-класс',
    description: 'Квартиры бизнес-класса в жилых комплексах',
    taxRate: 25,
    vatRate: 0, // НДС не облагается
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.0,
    infrastructureCostMultiplier: 1.0,
    marketingShareRange: [0.03, 0.05],
    priceMultiplier: 1.0,
    sellableRatioRange: [0.75, 0.85],
    averageUnitSizeRange: [50, 80],
    absorptionRateRange: [6, 18],
    seasonalityPattern: [0.7, 0.75, 0.9, 1.0, 1.1, 1.15, 1.05, 0.95, 1.1, 1.15, 0.9, 0.75],
    equityShareRange: [0.15, 0.25],
    pfRateAdjustment: 0,
    isActive: true,
  },
  {
    name: 'residential_comfort',
    displayName: 'Жилой комфорт-класс',
    description: 'Квартиры комфорт-класса',
    taxRate: 25,
    vatRate: 0,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 0.8,
    infrastructureCostMultiplier: 0.9,
    marketingShareRange: [0.02, 0.04],
    priceMultiplier: 0.7,
    sellableRatioRange: [0.80, 0.90],
    averageUnitSizeRange: [40, 65],
    absorptionRateRange: [4, 12],
    seasonalityPattern: [0.75, 0.8, 0.95, 1.0, 1.1, 1.1, 1.0, 0.9, 1.05, 1.1, 0.85, 0.7],
    equityShareRange: [0.15, 0.20],
    pfRateAdjustment: 0,
    isActive: true,
  },
  {
    name: 'residential_premium',
    displayName: 'Жилой премиум',
    description: 'Премиальные квартиры и пентхаусы',
    taxRate: 25,
    vatRate: 0,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.4,
    infrastructureCostMultiplier: 1.3,
    marketingShareRange: [0.05, 0.08],
    priceMultiplier: 1.8,
    sellableRatioRange: [0.65, 0.80],
    averageUnitSizeRange: [80, 200],
    absorptionRateRange: [12, 36],
    seasonalityPattern: [0.6, 0.65, 0.8, 0.9, 1.0, 1.1, 1.1, 1.0, 1.1, 1.2, 1.0, 0.65],
    equityShareRange: [0.20, 0.30],
    pfRateAdjustment: 0.5,
    isActive: true,
  },
  {
    name: 'commercial_office',
    displayName: 'Коммерческий офис',
    description: 'Офисные помещения класса A/B',
    taxRate: 25,
    vatRate: 20,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.2,
    infrastructureCostMultiplier: 1.1,
    marketingShareRange: [0.04, 0.06],
    priceMultiplier: 1.5,
    sellableRatioRange: [0.85, 0.95],
    averageUnitSizeRange: [100, 500],
    absorptionRateRange: [6, 24],
    seasonalityPattern: [0.8, 0.85, 1.0, 1.05, 1.0, 0.95, 0.9, 0.85, 1.05, 1.1, 1.0, 0.75],
    equityShareRange: [0.25, 0.35],
    pfRateAdjustment: 1.0,
    isActive: true,
  },
  {
    name: 'commercial_retail',
    displayName: 'Коммерческий ритейл',
    description: 'Торговые помещения',
    taxRate: 25,
    vatRate: 20,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.1,
    infrastructureCostMultiplier: 1.0,
    marketingShareRange: [0.03, 0.05],
    priceMultiplier: 2.0,
    sellableRatioRange: [0.90, 1.0],
    averageUnitSizeRange: [50, 300],
    absorptionRateRange: [3, 12],
    seasonalityPattern: [0.7, 0.75, 0.9, 1.0, 1.1, 1.15, 1.1, 1.0, 1.05, 1.1, 1.15, 1.3],
    equityShareRange: [0.20, 0.30],
    pfRateAdjustment: 0.5,
    isActive: true,
  },
  {
    name: 'hotel',
    displayName: 'Гостиничный',
    description: 'Гостиницы и апартаменты',
    taxRate: 25,
    vatRate: 20,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.5,
    infrastructureCostMultiplier: 1.4,
    marketingShareRange: [0.06, 0.10],
    priceMultiplier: 2.5,
    sellableRatioRange: [0.70, 0.85],
    averageUnitSizeRange: [25, 60],
    absorptionRateRange: [12, 36],
    seasonalityPattern: [0.5, 0.5, 0.7, 0.9, 1.1, 1.3, 1.4, 1.3, 1.1, 0.9, 0.6, 0.4],
    equityShareRange: [0.30, 0.40],
    pfRateAdjustment: 1.5,
    isActive: true,
  },
  {
    name: 'mixed_use',
    displayName: 'Смешанное использование',
    description: 'Жилые + коммерческие + общественные пространства',
    taxRate: 25,
    vatRate: 20,
    propertyTaxRate: 2.2,
    constructionCostMultiplier: 1.3,
    infrastructureCostMultiplier: 1.2,
    marketingShareRange: [0.05, 0.08],
    priceMultiplier: 1.4,
    sellableRatioRange: [0.75, 0.88],
    averageUnitSizeRange: [45, 85],
    absorptionRateRange: [8, 24],
    seasonalityPattern: [0.7, 0.75, 0.9, 1.0, 1.1, 1.15, 1.05, 0.95, 1.1, 1.15, 0.9, 0.75],
    equityShareRange: [0.20, 0.30],
    pfRateAdjustment: 0.5,
    isActive: true,
  },
];

// ── Default Region Configs ───────────────────────────────────────

const DEFAULT_REGIONS: Omit<RegionConfig, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Russia',
    countryCode: 'RU',
    currency: 'RUB',
    corporateTaxRate: 25,
    vatRate: 20,
    propertyTaxRate: 2.2,
    dividendTaxRate: 15,
    centralBankRate: 14.5,
    mortgageRateRange: [20, 30],
    pfRateRange: [15, 25],
    escrowRequired: true,
    dduRequired: true,
    foreignOwnershipRestrictions: false,
    typicalAbsorptionMonths: 12,
    priceGrowthTypical: 5,
    isActive: true,
  },
  {
    name: 'Kazakhstan',
    countryCode: 'KZ',
    currency: 'KZT',
    corporateTaxRate: 20,
    vatRate: 12,
    propertyTaxRate: 1.5,
    dividendTaxRate: 10,
    centralBankRate: 14.75,
    mortgageRateRange: [18, 25],
    pfRateRange: [14, 22],
    escrowRequired: true,
    dduRequired: false,
    foreignOwnershipRestrictions: true,
    typicalAbsorptionMonths: 10,
    priceGrowthTypical: 8,
    isActive: true,
  },
  {
    name: 'UAE',
    countryCode: 'AE',
    currency: 'AED',
    corporateTaxRate: 9,
    vatRate: 5,
    propertyTaxRate: 0,
    dividendTaxRate: 0,
    centralBankRate: 5.4,
    mortgageRateRange: [4, 6],
    pfRateRange: [5, 8],
    escrowRequired: true,
    dduRequired: false,
    foreignOwnershipRestrictions: false,
    typicalAbsorptionMonths: 8,
    priceGrowthTypical: 10,
    isActive: true,
  },
  {
    name: 'Turkey',
    countryCode: 'TR',
    currency: 'TRY',
    corporateTaxRate: 25,
    vatRate: 20,
    propertyTaxRate: 0.1,
    dividendTaxRate: 15,
    centralBankRate: 50,
    mortgageRateRange: [40, 60],
    pfRateRange: [45, 55],
    escrowRequired: false,
    dduRequired: false,
    foreignOwnershipRestrictions: false,
    typicalAbsorptionMonths: 6,
    priceGrowthTypical: 25,
    isActive: true,
  },
];

// ── Service Functions ────────────────────────────────────────────

export async function getAssetClasses(): Promise<AssetClassConfig[]> {
  const cacheKey = 'asset-classes';
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // In production, fetch from database
  // For now, return defaults
  const classes = DEFAULT_ASSET_CLASSES.map((c, i) => ({
    ...c,
    id: `ac_${i + 1}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await redis.setex(cacheKey, 3600, JSON.stringify(classes));
  return classes;
}

export async function getRegions(): Promise<RegionConfig[]> {
  const cacheKey = 'regions';
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const regions = DEFAULT_REGIONS.map((r, i) => ({
    ...r,
    id: `reg_${i + 1}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

  await redis.setex(cacheKey, 3600, JSON.stringify(regions));
  return regions;
}

export async function getAssetClassByName(name: string): Promise<AssetClassConfig | null> {
  const classes = await getAssetClasses();
  return classes.find(c => c.name === name) ?? null;
}

export async function getRegionByCountry(countryCode: string): Promise<RegionConfig | null> {
  const regions = await getRegions();
  return regions.find(r => r.countryCode === countryCode) ?? null;
}

// ── Validation Helpers ───────────────────────────────────────────

export function validateAssetClassForRegion(
  assetClass: AssetClassConfig,
  region: RegionConfig,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check tax compatibility
  if (assetClass.vatRate > 0 && region.vatRate === 0) {
    warnings.push('Asset class has VAT but region has 0% VAT');
  }

  // Check financing
  if (region.escrowRequired && assetClass.name.includes('hotel')) {
    warnings.push('Hotel projects may have different escrow requirements');
  }

  // Check foreign ownership
  if (region.foreignOwnershipRestrictions && assetClass.priceMultiplier > 1.5) {
    warnings.push('Premium projects may face foreign ownership restrictions');
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
