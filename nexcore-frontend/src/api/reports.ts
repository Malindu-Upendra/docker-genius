import api from './client';

export const getFinancialAggregate = (filter?: any) =>
  api.post('/reports/financial/aggregate?no_cache=true', filter ?? {});
export const getMonthlySales = (year?: number) =>
  api.get('/reports/sales/monthly', { params: { year, no_cache: true } });
export const getDailySales = (date?: string) =>
  api.get('/reports/sales/daily', { params: { date, no_cache: true } });
export const getStockValuation = () =>
  api.get('/reports/inventory/valuation?no_cache=true');
export const getTopSelling = (params?: any) =>
  api.get('/reports/products/top-selling', { params: { ...params, no_cache: true } });
export const getProfitMargin = () =>
  api.get('/reports/products/profit-margin?no_cache=true');
export const getInventoryMovement = (params?: any) =>
  api.get('/reports/inventory/movement', { params: { ...params, no_cache: true } });
export const bulkGenerate = (options?: any) =>
  api.post('/reports/bulk-generate', options ?? { research_mode: true });
