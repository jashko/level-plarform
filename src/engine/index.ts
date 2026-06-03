// Объединённый barrel движка + данных для UI.
export * from './finance';
export * from './scoring';
export { buildCityRanking, type RankingResult, type CityRankingEntry } from '../data/ranking';
export { ALL_CITY_KEYS, CITY_COORDINATES, RUSSIA_MILLION_CITIES } from '../data/cities';
export { MINSTROI_NORMATIVE_2025, BUSINESS_CLASS_CONSTRUCTION_PREMIUM } from './finance/config';
