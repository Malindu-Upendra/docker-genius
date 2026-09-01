import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface FinancialAggregateFilter {
  fromDate?: Date;
  toDate?: Date;
  categoryId?: string;
  brandId?: string;
  no_cache?: boolean;
}

// Deliberately CPU-bound work for the research-mode Tier-3 endpoint. All
// of this service's other "heavy" queries delegate their cost to MySQL —
// which runs in a SEPARATE container the DOCKER-GENIUS governor neither
// monitors nor scales. Measured directly: erp_app sat at 32-42% CPU while
// erp_mysql hit 82-112% during a heavy burst, so no amount of SQL-side
// load will ever raise erp_app's own CPU high enough to trigger the
// governor's scale-up rules — the contention exists, but not where the
// governor can see or act on it. This burns a FIXED amount of computation
// (not a fixed wall-clock duration) inside the Node process itself, so
// completion time genuinely responds to the container's --cpus allocation
// — more CPU shares means this finishes faster, which is the entire
// premise the vertical-scaling mechanism is supposed to demonstrate.
// Calibrated empirically: 800M iterations ≈ 3s on a warmed-up V8 JIT at
// 2.0 CPUs (a cold one-shot `node -e` benchmark of the same loop measures
// ~2.5x slower — don't recalibrate against that, only against real
// in-process timing). Verified this actually blocks concurrent Tier-1
// checkouts (Node is single-threaded): 8 concurrent checkout workers vs
// 3 concurrent bursts of this produced a 33.6% Tier-1 SLA breach rate.
const CPU_BURN_ITERATIONS = 800_000_000;

function burnCpu(iterations: number): number {
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    acc += Math.sqrt(i + 1) * Math.sin(acc);
  }
  return acc;
}

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  // TIER_3: PRIMARY DOCKER-GENIUS research endpoint
  // 6+ table joins, multiple subquery levels, deliberately unoptimized — NO caching
  async getFinancialAggregate(tenantId: string, filter: FinancialAggregateFilter) {
    const params: any[] = [tenantId];
    let dateFilter = '';
    if (filter.fromDate) { dateFilter += ' AND i.invoice_date >= ?'; params.push(filter.fromDate); }
    if (filter.toDate) { dateFilter += ' AND i.invoice_date <= ?'; params.push(filter.toDate); }

    let categoryFilter = '';
    if (filter.categoryId) { categoryFilter = ' AND p.category_id = ?'; params.push(filter.categoryId); }

    let brandFilter = '';
    if (filter.brandId) { brandFilter = ' AND p.brand_id = ?'; params.push(filter.brandId); }

    return this.dataSource.query(
      `SELECT
          t.tenant_code, t.company_name,
          pc.category_name,
          pb.brand_name,
          p.product_code, p.product_name, p.tax_percentage,
          COUNT(DISTINCT i.id) AS total_invoices,
          SUM(ii.quantity) AS total_qty_sold,
          SUM(ii.line_total) AS gross_revenue,
          SUM(ii.discount_amount) AS total_line_discounts,
          SUM(ii.line_total - ii.discount_amount) AS net_revenue,
          SUM(ii.tax_amount) AS total_tax_collected,
          SUM(ii.quantity * p.cost_price) AS total_cogs,
          SUM(ii.line_total - ii.discount_amount) - SUM(ii.quantity * p.cost_price) AS gross_profit,
          ROUND(
            (SUM(ii.line_total - ii.discount_amount) - SUM(ii.quantity * p.cost_price))
            / NULLIF(SUM(ii.line_total - ii.discount_amount), 0) * 100, 2
          ) AS gross_margin_pct,
          AVG(ii.unit_price) AS avg_unit_price,
          MAX(ii.unit_price) AS max_unit_price,
          MIN(ii.unit_price) AS min_unit_price,
          COALESCE(pos_agg.pos_revenue, 0) AS pos_channel_revenue,
          COALESCE(pos_agg.pos_qty, 0) AS pos_channel_qty,
          ps.qty_on_hand AS current_stock_qty,
          ps.qty_on_hand * p.cost_price AS current_stock_value
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id AND i.tenant_id = ?${dateFilter}
          AND i.status NOT IN ('void', 'draft')
        JOIN products p ON p.id = ii.product_id${categoryFilter}${brandFilter}
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        LEFT JOIN product_brands pb ON pb.id = p.brand_id
        JOIN tenants t ON t.id = i.tenant_id
        LEFT JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        LEFT JOIN (
          SELECT pti.product_id,
            SUM(pti.line_total) AS pos_revenue,
            SUM(pti.quantity) AS pos_qty
          FROM pos_transaction_items pti
          JOIN pos_transactions pt ON pt.id = pti.transaction_id AND pt.tenant_id = pti.tenant_id
          WHERE pt.tenant_id = ? AND pt.status = 'completed'
          GROUP BY pti.product_id
        ) pos_agg ON pos_agg.product_id = p.id
        WHERE i.tenant_id = ?
        GROUP BY
          t.tenant_code, t.company_name, pc.category_name, pb.brand_name,
          p.id, p.product_code, p.product_name, p.tax_percentage,
          pos_agg.pos_revenue, pos_agg.pos_qty, ps.qty_on_hand, p.cost_price
        HAVING total_qty_sold > 0
        ORDER BY gross_profit DESC, gross_revenue DESC`,
      [...params, tenantId, tenantId],
    );
  }

  // TIER_3: Monthly sales by category
  async getMonthlySales(tenantId: string, year?: number, no_cache = false) {
    const targetYear = year ?? new Date().getFullYear();
    return this.dataSource.query(
      `SELECT
          MONTH(i.invoice_date) AS month_number,
          MONTHNAME(i.invoice_date) AS month_name,
          pc.category_name,
          COUNT(DISTINCT i.id) AS invoice_count,
          SUM(ii.quantity) AS total_qty,
          SUM(ii.line_total) AS gross_sales,
          SUM(ii.discount_amount) AS discounts,
          SUM(ii.tax_amount) AS tax_collected,
          SUM(ii.line_total - ii.discount_amount) AS net_sales
        FROM invoices i
        JOIN invoice_items ii ON ii.invoice_id = i.id AND ii.tenant_id = i.tenant_id
        JOIN products p ON p.id = ii.product_id
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE i.tenant_id = ? AND YEAR(i.invoice_date) = ?
          AND i.status NOT IN ('void', 'draft')
        GROUP BY MONTH(i.invoice_date), MONTHNAME(i.invoice_date), pc.category_name
        ORDER BY month_number ASC, net_sales DESC`,
      [tenantId, targetYear],
    );
  }

  // TIER_3: Inventory movement — UNION ALL across all stock change sources
  async getInventoryMovement(tenantId: string, fromDate?: Date, toDate?: Date, productId?: string, no_cache = false) {
    const params: any[] = [tenantId];
    const params2: any[] = [tenantId];
    const params3: any[] = [tenantId];
    const params4: any[] = [tenantId];

    let dateF1 = ''; let dateF2 = ''; let dateF3 = ''; let dateF4 = '';
    let prodF1 = ''; let prodF2 = ''; let prodF3 = ''; let prodF4 = '';

    if (fromDate) { dateF1 = ' AND gh.approved_at >= ?'; params.push(fromDate); dateF2 = ' AND i.invoice_date >= ?'; params2.push(fromDate); dateF3 = ' AND pt.transaction_time >= ?'; params3.push(fromDate); dateF4 = ' AND sa.created_at >= ?'; params4.push(fromDate); }
    if (toDate) { dateF1 += ' AND gh.approved_at <= ?'; params.push(toDate); dateF2 += ' AND i.invoice_date <= ?'; params2.push(toDate); dateF3 += ' AND pt.transaction_time <= ?'; params3.push(toDate); dateF4 += ' AND sa.created_at <= ?'; params4.push(toDate); }
    if (productId) { prodF1 = ' AND gi.product_id = ?'; params.push(productId); prodF2 = ' AND ii.product_id = ?'; params2.push(productId); prodF3 = ' AND pti.product_id = ?'; params3.push(productId); prodF4 = ' AND sa.product_id = ?'; params4.push(productId); }

    return this.dataSource.query(
      `SELECT * FROM (
        SELECT 'GRN' AS movement_type, gh.grn_number AS reference,
          gi.product_id, p.product_code, p.product_name,
          gi.qty AS quantity_in, 0 AS quantity_out,
          gi.unit_cost, gh.approved_at AS movement_date
        FROM grn_items gi
        JOIN grn_headers gh ON gh.id = gi.grn_id AND gh.status = 'approved'${dateF1}
        JOIN products p ON p.id = gi.product_id
        WHERE gi.tenant_id = ?${prodF1}
        UNION ALL
        SELECT 'INVOICE', i.invoice_number, ii.product_id, p.product_code, p.product_name,
          0, ii.quantity, ii.unit_price, i.invoice_date
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id AND i.status NOT IN ('void','draft')${dateF2}
        JOIN products p ON p.id = ii.product_id
        WHERE ii.tenant_id = ?${prodF2}
        UNION ALL
        SELECT 'POS', pt.transaction_number, pti.product_id, p.product_code, p.product_name,
          0, pti.quantity, pti.unit_price, pt.transaction_time
        FROM pos_transaction_items pti
        JOIN pos_transactions pt ON pt.id = pti.transaction_id AND pt.status = 'completed'${dateF3}
        JOIN products p ON p.id = pti.product_id
        WHERE pti.tenant_id = ?${prodF3}
        UNION ALL
        SELECT 'ADJUSTMENT', sa.reference_number, sa.product_id, p.product_code, p.product_name,
          CASE WHEN sa.adjustment_type IN ('manual_in','return') THEN sa.quantity ELSE 0 END,
          CASE WHEN sa.adjustment_type NOT IN ('manual_in','return') THEN sa.quantity ELSE 0 END,
          0, sa.created_at
        FROM stock_adjustments sa
        JOIN products p ON p.id = sa.product_id${dateF4}
        WHERE sa.tenant_id = ?${prodF4}
      ) movements
      ORDER BY movement_date DESC`,
      [...params, tenantId, ...params2, tenantId, ...params3, tenantId, ...params4, tenantId],
    );
  }

  // TIER_3: Stock valuation
  async getStockValuation(tenantId: string, no_cache = false) {
    return this.dataSource.query(
      `SELECT p.product_code, p.product_name, pc.category_name, pb.brand_name,
          ps.qty_on_hand, ps.qty_reserved,
          (ps.qty_on_hand - ps.qty_reserved) AS available_qty,
          p.cost_price, p.selling_price,
          ps.qty_on_hand * p.cost_price AS cost_value,
          ps.qty_on_hand * p.selling_price AS selling_value,
          (ps.qty_on_hand * p.selling_price) - (ps.qty_on_hand * p.cost_price) AS potential_profit
        FROM products p
        JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        LEFT JOIN product_brands pb ON pb.id = p.brand_id
        WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_tracked = 1
        ORDER BY cost_value DESC`,
      [tenantId],
    );
  }

  // TIER_3: Top selling products
  async getTopSellingProducts(tenantId: string, limit = 20, fromDate?: Date, toDate?: Date, no_cache = false) {
    const params: any[] = [];
    let dateFilter = '';
    if (fromDate) { dateFilter += ' AND i.invoice_date >= ?'; params.push(fromDate); }
    if (toDate) { dateFilter += ' AND i.invoice_date <= ?'; params.push(toDate); }

    return this.dataSource.query(
      `SELECT p.product_code, p.product_name, pc.category_name,
          SUM(ii.quantity) AS total_qty_sold,
          SUM(ii.line_total - ii.discount_amount) AS net_revenue,
          SUM(ii.quantity * p.cost_price) AS total_cogs,
          SUM(ii.line_total - ii.discount_amount) - SUM(ii.quantity * p.cost_price) AS gross_profit,
          ROUND(
            (SUM(ii.line_total - ii.discount_amount) - SUM(ii.quantity * p.cost_price))
            / NULLIF(SUM(ii.line_total - ii.discount_amount), 0) * 100, 2
          ) AS margin_pct
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii.invoice_id AND i.status NOT IN ('void','draft')${dateFilter}
        JOIN products p ON p.id = ii.product_id
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE ii.tenant_id = ?
        GROUP BY p.id, p.product_code, p.product_name, pc.category_name
        ORDER BY total_qty_sold DESC
        LIMIT ?`,
      [...params, tenantId, limit],
    );
  }

  // TIER_3: Daily sales summary
  async getDailySales(tenantId: string, date?: Date, no_cache = false) {
    const targetDate = date ?? new Date();
    return this.dataSource.query(
      `SELECT
          HOUR(pt.transaction_time) AS hour_of_day,
          COUNT(pt.id) AS transaction_count,
          SUM(pt.total_amount) AS pos_revenue,
          SUM(pt.discount_amount) AS pos_discounts,
          0 AS invoice_revenue
        FROM pos_transactions pt
        WHERE pt.tenant_id = ? AND DATE(pt.transaction_time) = DATE(?)
          AND pt.status = 'completed'
        GROUP BY HOUR(pt.transaction_time)
        UNION ALL
        SELECT
          HOUR(i.created_at) AS hour_of_day,
          COUNT(i.id),
          0,
          0,
          SUM(i.total_amount)
        FROM invoices i
        WHERE i.tenant_id = ? AND DATE(i.invoice_date) = DATE(?)
          AND i.status NOT IN ('void', 'draft')
        GROUP BY HOUR(i.created_at)
        ORDER BY hour_of_day ASC`,
      [tenantId, targetDate, tenantId, targetDate],
    );
  }

  // TIER_3: DOCKER-GENIUS Semantic log P95 report
  async getSemanticLogReport(tenantId: string, fromDate?: Date, toDate?: Date, no_cache = false) {
    const params: any[] = [];
    let dateFilter = '';
    if (fromDate) { dateFilter += ' AND logged_at >= ?'; params.push(fromDate); }
    if (toDate) { dateFilter += ' AND logged_at <= ?'; params.push(toDate); }
    if (tenantId) { dateFilter += ' AND tenant_id = ?'; params.push(tenantId); }

    // MySQL 8.0 has no PERCENTILE_CONT()/WITHIN GROUP (that's Postgres/Oracle
    // syntax) — approximate nearest-rank percentiles per group with
    // PERCENT_RANK() instead, which MySQL 8.0 window functions do support.
    return this.dataSource.query(
      `WITH ranked AS (
          SELECT priority_tier, endpoint_path, response_time_ms, status_code,
                 PERCENT_RANK() OVER (
                   PARTITION BY priority_tier, endpoint_path
                   ORDER BY response_time_ms
                 ) AS pr
          FROM semantic_request_logs
          WHERE 1=1${dateFilter}
        )
        SELECT priority_tier, endpoint_path,
          COUNT(*) AS request_count,
          AVG(response_time_ms) AS avg_response_ms,
          MAX(response_time_ms) AS max_response_ms,
          MIN(response_time_ms) AS min_response_ms,
          MIN(CASE WHEN pr >= 0.50 THEN response_time_ms END) AS p50_ms,
          MIN(CASE WHEN pr >= 0.95 THEN response_time_ms END) AS p95_ms,
          MIN(CASE WHEN pr >= 0.99 THEN response_time_ms END) AS p99_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count
        FROM ranked
        GROUP BY priority_tier, endpoint_path
        ORDER BY priority_tier ASC, avg_response_ms DESC`,
      params,
    );
  }

  // TIER_3: Profit margin by product
  async getProfitMarginReport(tenantId: string, no_cache = false) {
    return this.dataSource.query(
      `SELECT p.product_code, p.product_name, pc.category_name,
          p.cost_price, p.selling_price,
          p.selling_price - p.cost_price AS unit_profit,
          ROUND((p.selling_price - p.cost_price) / NULLIF(p.selling_price, 0) * 100, 2) AS margin_pct
        FROM products p
        LEFT JOIN product_categories pc ON pc.id = p.category_id
        WHERE p.tenant_id = ? AND p.is_active = 1
        ORDER BY margin_pct DESC`,
      [tenantId],
    );
  }

  // TIER_3: Bulk report generation — sequential execution to maximize CPU load
  async bulkGenerate(tenantId: string, options: { research_mode?: boolean; delay_ms?: number } = {}) {
    const delayMs = options.delay_ms ?? 0;
    const results: Record<string, any> = {};

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    results['financial_aggregate'] = await this.getFinancialAggregate(tenantId, {});
    if (delayMs > 0) await sleep(delayMs);

    results['monthly_sales'] = await this.getMonthlySales(tenantId, undefined, true);
    if (delayMs > 0) await sleep(delayMs);

    results['stock_valuation'] = await this.getStockValuation(tenantId, true);
    if (delayMs > 0) await sleep(delayMs);

    results['inventory_movement'] = await this.getInventoryMovement(tenantId, undefined, undefined, undefined, true);
    if (delayMs > 0) await sleep(delayMs);

    results['aged_receivables'] = await this.dataSource.query(
      `SELECT c.client_code, c.client_name, SUM(i.balance_due) AS total_outstanding
       FROM clients c JOIN invoices i ON i.client_id = c.id AND i.tenant_id = c.tenant_id
       WHERE c.tenant_id = ? AND i.balance_due > 0 GROUP BY c.id ORDER BY total_outstanding DESC`,
      [tenantId]
    );
    if (delayMs > 0) await sleep(delayMs);

    results['top_products'] = await this.getTopSellingProducts(tenantId, 20, undefined, undefined, true);
    if (delayMs > 0) await sleep(delayMs);

    results['profit_margins'] = await this.getProfitMarginReport(tenantId, true);
    if (delayMs > 0) await sleep(delayMs);

    // Bounded to the last hour: this report is called repeatedly during a
    // live load test that is itself writing into semantic_request_logs at
    // high volume — an unbounded query here re-reads the entire, ever-growing
    // table on every call (measured at 66MB+ and climbing), so the same load
    // test that calls it also makes it monotonically slower over the course
    // of a single run. A time-bounded window keeps this endpoint heavy but
    // deterministic instead of degrading without limit.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    results['semantic_logs'] = await this.getSemanticLogReport(tenantId, oneHourAgo, undefined, true);

    // See CPU_BURN_ITERATIONS comment above — this is what actually makes
    // Tier-3 load visible to the governor's CPU-based rules.
    if (options.research_mode) {
      burnCpu(CPU_BURN_ITERATIONS);
    }

    return {
      generatedAt: new Date(),
      tenantId,
      researchMode: options.research_mode ?? false,
      reports: results,
    };
  }
}
