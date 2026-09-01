export enum PriorityTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
}

export const ENDPOINT_PRIORITY_MAP: Record<string, PriorityTier> = {
  'POST:/api/pos/checkout': PriorityTier.TIER_1,
  'POST:/api/pos/transactions': PriorityTier.TIER_1,
  'GET:/api/pos/products/scan': PriorityTier.TIER_1,
  'POST:/api/pos/sessions': PriorityTier.TIER_1,
  'PUT:/api/pos/sessions': PriorityTier.TIER_1,
  'POST:/api/pos/cart': PriorityTier.TIER_1,
  'PUT:/api/pos/cart': PriorityTier.TIER_1,
  'DELETE:/api/pos/cart': PriorityTier.TIER_1,
  'POST:/api/pos/payments': PriorityTier.TIER_1,
  'POST:/api/pos/refunds': PriorityTier.TIER_1,
  'POST:/api/pos/hold': PriorityTier.TIER_1,
  'POST:/api/pos/sync': PriorityTier.TIER_1,
  'POST:/api/reports/financial/aggregate': PriorityTier.TIER_3,
  'GET:/api/reports/sales/monthly': PriorityTier.TIER_3,
  'GET:/api/reports/sales/daily': PriorityTier.TIER_3,
  'GET:/api/reports/inventory/movement': PriorityTier.TIER_3,
  'GET:/api/reports/inventory/valuation': PriorityTier.TIER_3,
  'GET:/api/reports/clients/aged-receivables': PriorityTier.TIER_3,
  'GET:/api/reports/payments/collection': PriorityTier.TIER_3,
  'GET:/api/reports/products/top-selling': PriorityTier.TIER_3,
  'GET:/api/reports/products/profit-margin': PriorityTier.TIER_3,
  'POST:/api/reports/bulk-generate': PriorityTier.TIER_3,
  'POST:/api/grn/approve': PriorityTier.TIER_3,
  'POST:/api/grn/bulk-process': PriorityTier.TIER_3,
  'GET:/api/grn/supplier-performance': PriorityTier.TIER_3,
  'POST:/api/grun/approve': PriorityTier.TIER_3,
  'GET:/api/grun/summary-report': PriorityTier.TIER_3,
  'POST:/api/inventory/bulk-sync': PriorityTier.TIER_3,
  'GET:/api/invoices/aging-report': PriorityTier.TIER_3,
  'GET:/api/payments/aged-receivables': PriorityTier.TIER_3,
};

export function resolvePriorityTier(method: string, path: string): PriorityTier {
  const key = `${method}:${path}`;
  return ENDPOINT_PRIORITY_MAP[key] ?? PriorityTier.TIER_2;
}
