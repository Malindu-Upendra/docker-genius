export enum PriorityTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
}

// Every entry here is a REAL route taken from the controllers in
// src/modules/**/*.controller.ts — checked against each @Controller()/@Get()
// /@Post()/@Put()/@Delete() decorator, not guessed. Previously this map had
// several dead keys (POS cart/payments/refunds/hold/sync, a reports
// "payments/collection" path) that matched nothing a controller ever
// registers, so they silently did nothing; those are removed or corrected
// to the real path below.
//
// Routes with a dynamic segment (:id, :clientId, :barcode, ...) are listed
// with the literal placeholder ":id" — resolvePriorityTier() normalizes any
// purely-numeric path segment to ":id" before lookup, since the real
// request path carries the actual id value, never the param name.
//
// Every endpoint in the app is listed explicitly (including plain TIER_2
// ones) so nothing relies on the implicit default below — a new, unlisted
// route is the only thing that should ever fall through to it.
export const ENDPOINT_PRIORITY_MAP: Record<string, PriorityTier> = {
  // ── TIER_1 — POS checkout-critical path ──────────────────────────────────
  'POST:/api/pos/sessions': PriorityTier.TIER_1,
  'GET:/api/pos/sessions/current': PriorityTier.TIER_1,
  'PUT:/api/pos/sessions/:id/close': PriorityTier.TIER_1,
  'GET:/api/pos/products/scan': PriorityTier.TIER_1,
  'GET:/api/pos/products/search': PriorityTier.TIER_1,
  'POST:/api/pos/checkout': PriorityTier.TIER_1,
  'POST:/api/pos/transactions': PriorityTier.TIER_1,
  'PUT:/api/pos/transactions/:id/void': PriorityTier.TIER_1,

  // ── TIER_2 — POS, non-critical ───────────────────────────────────────────
  'GET:/api/pos/transactions': PriorityTier.TIER_2,
  'GET:/api/pos/transactions/:id': PriorityTier.TIER_2,

  // ── TIER_3 — heavy reports, aggregates, bulk/approval operations ────────
  'POST:/api/reports/financial/aggregate': PriorityTier.TIER_3,
  'GET:/api/reports/sales/monthly': PriorityTier.TIER_3,
  'GET:/api/reports/sales/daily': PriorityTier.TIER_3,
  'GET:/api/reports/inventory/movement': PriorityTier.TIER_3,
  'GET:/api/reports/inventory/valuation': PriorityTier.TIER_3,
  'GET:/api/reports/clients/aged-receivables': PriorityTier.TIER_3,
  'GET:/api/reports/products/top-selling': PriorityTier.TIER_3,
  'GET:/api/reports/products/profit-margin': PriorityTier.TIER_3,
  'GET:/api/reports/semantic-logs': PriorityTier.TIER_3,
  'POST:/api/reports/bulk-generate': PriorityTier.TIER_3,
  'POST:/api/grn/approve': PriorityTier.TIER_3,
  'POST:/api/grn/bulk-process': PriorityTier.TIER_3,
  'GET:/api/grn/supplier-performance': PriorityTier.TIER_3,
  'POST:/api/grun/approve': PriorityTier.TIER_3,
  'GET:/api/grun/summary-report': PriorityTier.TIER_3,
  'POST:/api/inventory/bulk-sync': PriorityTier.TIER_3,
  'GET:/api/invoices/aging-report': PriorityTier.TIER_3,
  'GET:/api/payments/aged-receivables': PriorityTier.TIER_3,
  'GET:/api/payments/collection-report': PriorityTier.TIER_3,
  'GET:/api/clients/dashboard': PriorityTier.TIER_3,
  'GET:/api/clients/aged-receivables': PriorityTier.TIER_3,
  'GET:/api/payments/dashboard': PriorityTier.TIER_3,
  'GET:/api/products/dashboard': PriorityTier.TIER_3,

  // ── TIER_2 — everything else (standard CRUD / admin) ─────────────────────
  'POST:/api/clients': PriorityTier.TIER_2,
  'GET:/api/clients': PriorityTier.TIER_2,
  'GET:/api/clients/groups': PriorityTier.TIER_2,
  'POST:/api/clients/groups': PriorityTier.TIER_2,
  'GET:/api/clients/:id': PriorityTier.TIER_2,
  'PUT:/api/clients/:id': PriorityTier.TIER_2,
  'DELETE:/api/clients/:id': PriorityTier.TIER_2,
  'PUT:/api/clients/:id/credit-limit': PriorityTier.TIER_2,
  'GET:/api/clients/:id/statement': PriorityTier.TIER_2,
  'GET:/api/clients/:id/outstanding': PriorityTier.TIER_2,
  'GET:/api/clients/:id/loyalty': PriorityTier.TIER_2,
  'GET:/api/clients/:id/contacts': PriorityTier.TIER_2,
  'POST:/api/clients/:id/contacts': PriorityTier.TIER_2,

  'POST:/api/payments': PriorityTier.TIER_2,
  'GET:/api/payments': PriorityTier.TIER_2,
  'GET:/api/payments/outstanding/:id': PriorityTier.TIER_2,
  'GET:/api/payments/:id': PriorityTier.TIER_2,
  'PUT:/api/payments/:id/approve': PriorityTier.TIER_2,
  'PUT:/api/payments/:id/cancel': PriorityTier.TIER_2,
  'PUT:/api/payments/:id/void': PriorityTier.TIER_2,

  'POST:/api/products': PriorityTier.TIER_2,
  'GET:/api/products': PriorityTier.TIER_2,
  'GET:/api/products/low-stock': PriorityTier.TIER_2,
  'GET:/api/products/barcode/:id': PriorityTier.TIER_2,
  'GET:/api/products/:id': PriorityTier.TIER_2,
  'PUT:/api/products/:id': PriorityTier.TIER_2,
  'DELETE:/api/products/:id': PriorityTier.TIER_2,
  'GET:/api/products/:id/stock': PriorityTier.TIER_2,
  'GET:/api/products/:id/availability': PriorityTier.TIER_2,
  'POST:/api/products/stock/adjust': PriorityTier.TIER_2,
  'GET:/api/products/:id/audit': PriorityTier.TIER_2,
  'POST:/api/products/categories': PriorityTier.TIER_2,
  'GET:/api/products/categories/list': PriorityTier.TIER_2,
  'POST:/api/products/brands': PriorityTier.TIER_2,
  'GET:/api/products/brands/list': PriorityTier.TIER_2,
  'POST:/api/products/units': PriorityTier.TIER_2,
  'GET:/api/products/units/list': PriorityTier.TIER_2,

  'POST:/api/auth/login': PriorityTier.TIER_2,
  'POST:/api/auth/users': PriorityTier.TIER_2,
  'POST:/api/auth/change-password': PriorityTier.TIER_2,

  'POST:/api/tenants': PriorityTier.TIER_2,
  'GET:/api/tenants': PriorityTier.TIER_2,
  'GET:/api/tenants/:id': PriorityTier.TIER_2,
  'PUT:/api/tenants/:id': PriorityTier.TIER_2,
  'DELETE:/api/tenants/:id': PriorityTier.TIER_2,

  'POST:/api/grun': PriorityTier.TIER_2,
  'GET:/api/grun': PriorityTier.TIER_2,
  'GET:/api/grun/:id': PriorityTier.TIER_2,
  'PUT:/api/grun/:id/submit': PriorityTier.TIER_2,
  'PUT:/api/grun/:id/approve': PriorityTier.TIER_2,
  'PUT:/api/grun/:id/reject': PriorityTier.TIER_2,

  'POST:/api/grn': PriorityTier.TIER_2,
  'GET:/api/grn': PriorityTier.TIER_2,
  'GET:/api/grn/suppliers': PriorityTier.TIER_2,
  'POST:/api/grn/suppliers': PriorityTier.TIER_2,
  'GET:/api/grn/:id': PriorityTier.TIER_2,
  'PUT:/api/grn/:id/submit': PriorityTier.TIER_2,
  'PUT:/api/grn/:id/approve': PriorityTier.TIER_2,
  'PUT:/api/grn/:id/reject': PriorityTier.TIER_2,

  'POST:/api/invoices': PriorityTier.TIER_2,
  'GET:/api/invoices': PriorityTier.TIER_2,
  'GET:/api/invoices/:id': PriorityTier.TIER_2,
  'PUT:/api/invoices/:id/confirm': PriorityTier.TIER_2,
  'PUT:/api/invoices/:id/void': PriorityTier.TIER_2,
  'POST:/api/invoices/:id/duplicate': PriorityTier.TIER_2,

  'GET:/api/inventory/stock-summary': PriorityTier.TIER_2,
};

// Real request paths carry actual id values (e.g. "/api/clients/42"), never
// the param name the controller declared (":id", ":clientId", ...), so a
// literal map key with ":id" in it can only ever match once numeric segments
// are normalized to that same placeholder first.
function normalizeDynamicSegments(path: string): string {
  return path
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

export function resolvePriorityTier(method: string, path: string): PriorityTier {
  const key = `${method}:${normalizeDynamicSegments(path)}`;
  return ENDPOINT_PRIORITY_MAP[key] ?? PriorityTier.TIER_2;
}
