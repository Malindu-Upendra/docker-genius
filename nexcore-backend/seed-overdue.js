/**
 * Seed overdue invoices across aging buckets for research.
 * Today = 2026-05-27
 * Buckets: 1-30d | 31-60d | 61-90d | 91-180d | 180+d overdue
 */
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const TENANT_ID = 'c73be30e-ac59-48b1-97e3-092da548f79c';
const USER_ID   = '6ea31564-289a-47eb-adb3-32f085a62f1c';
const TODAY     = new Date('2026-05-27');

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }

function dateOffset(days) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Overdue buckets: [label, dueDay range before today]
const BUCKETS = [
  { label: '1-30 days',   dueMin:  1, dueMax:  30, count: 25 },
  { label: '31-60 days',  dueMin: 31, dueMax:  60, count: 20 },
  { label: '61-90 days',  dueMin: 61, dueMax:  90, count: 18 },
  { label: '91-180 days', dueMin: 91, dueMax: 180, count: 15 },
  { label: '180+ days',   dueMin:181, dueMax: 365, count: 12 },
];

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: 'root', database: 'demo_nexcore',
  });

  const [clients]  = await conn.query('SELECT id FROM clients WHERE tenant_id = ?', [TENANT_ID]);
  const [products] = await conn.query(
    'SELECT id, selling_price, tax_percentage FROM products WHERE tenant_id = ? AND is_active = 1',
    [TENANT_ID]
  );

  const [countRow] = await conn.query('SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = ?', [TENANT_ID]);
  let seq = Number(countRow[0].n) + 1;

  let total = 0;

  for (const bucket of BUCKETS) {
    console.log(`Generating ${bucket.count} invoices overdue ${bucket.label}...`);

    for (let i = 0; i < bucket.count; i++) {
      const dueOffset     = rndInt(bucket.dueMin, bucket.dueMax);
      const dueDate       = dateOffset(dueOffset);
      // Invoice date = due date minus 30-45 day payment terms
      const terms         = rndInt(30, 45);
      const invoiceDate   = dateOffset(dueOffset + terms);

      const invId     = uuidv4();
      const invNumber = `INV-2026-${String(seq++).padStart(6, '0')}`;
      const clientId  = pick(clients).id;
      const numItems  = rndInt(2, 5);

      let subtotal = 0, taxAmount = 0, discAmount = 0;
      const lineItems = [];

      const shuffled = [...products].sort(() => Math.random() - 0.5).slice(0, numItems);
      for (const prod of shuffled) {
        const qty      = rndInt(1, 20);
        const price    = Number(prod.selling_price) * rnd(0.9, 1.1);
        const discPct  = pick([0, 0, 5, 10]);
        const taxPct   = Number(prod.tax_percentage) || 0;
        const gross    = qty * price;
        const disc     = gross * discPct / 100;
        const net      = gross - disc;
        const tax      = net * taxPct / 100;
        const lineTotal = net + tax;

        subtotal   += gross;
        taxAmount  += tax;
        discAmount += disc;

        lineItems.push({ id: uuidv4(), productId: prod.id, qty, price, discPct, disc, taxPct, tax, lineTotal });
      }

      const totalAmount = subtotal - discAmount + taxAmount;
      // Overdue = has balance due. Mix of fully unpaid (70%) and partial (30%).
      let amountPaid, balanceDue, status;
      if (Math.random() < 0.70) {
        status = 'confirmed'; amountPaid = 0; balanceDue = totalAmount;
      } else {
        const frac = rnd(0.1, 0.5);
        status = 'partial'; amountPaid = totalAmount * frac; balanceDue = totalAmount - amountPaid;
      }

      await conn.query(
        `INSERT INTO invoices
          (id, tenant_id, invoice_number, client_id, invoice_date, due_date,
           subtotal, discount_amount, tax_amount, total_amount,
           balance_due, amount_paid, status, source, created_by)
         VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)`,
        [
          invId, TENANT_ID, invNumber, clientId, invoiceDate, dueDate,
          subtotal.toFixed(2), discAmount.toFixed(2), taxAmount.toFixed(2), totalAmount.toFixed(2),
          balanceDue.toFixed(2), amountPaid.toFixed(2), status, 'manual', USER_ID,
        ]
      );

      for (const item of lineItems) {
        await conn.query(
          `INSERT INTO invoice_items
            (id, tenant_id, invoice_id, product_id, quantity, unit_price,
             discount_percentage, discount_amount, tax_percentage, tax_amount, line_total)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [item.id, TENANT_ID, invId, item.productId, item.qty, item.price.toFixed(4),
           item.discPct, item.disc.toFixed(2), item.taxPct, item.tax.toFixed(2), item.lineTotal.toFixed(2)]
        );
      }

      // Partial invoices had a payment at some point
      if (status === 'partial') {
        const [pCountRow] = await conn.query('SELECT COUNT(*) AS n FROM payments WHERE tenant_id = ?', [TENANT_ID]);
        const pSeq = Number(pCountRow[0].n) + 1;
        const payId = uuidv4();
        const payDate = dateOffset(dueOffset + rndInt(5, terms - 5));

        await conn.query(
          `INSERT INTO payments
            (id, tenant_id, payment_number, client_id, payment_method_id, payment_date,
             amount, base_amount, status, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [payId, TENANT_ID, `PAY-2026-${String(pSeq).padStart(6,'0')}`, clientId,
           pick(['cash','bank_transfer','cheque']), payDate,
           amountPaid.toFixed(2), amountPaid.toFixed(2), 'confirmed', USER_ID]
        );

        await conn.query(
          `INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, allocated_amount)
           VALUES (?,?,?,?,?)`,
          [uuidv4(), TENANT_ID, payId, invId, amountPaid.toFixed(2)]
        );
      }

      total++;
    }
  }

  await conn.end();
  console.log(`\n✓ Done — ${total} overdue invoices created across all aging buckets.`);

  // Summary check
  const conn2 = await mysql.createConnection({
    host: 'localhost', user: 'root', password: 'root', database: 'demo_nexcore',
  });
  const [rows] = await conn2.query(`
    SELECT
      CASE
        WHEN DATEDIFF(CURDATE(), due_date) BETWEEN  1 AND  30 THEN '01-30 days'
        WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND  60 THEN '31-60 days'
        WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND  90 THEN '61-90 days'
        WHEN DATEDIFF(CURDATE(), due_date) BETWEEN 91 AND 180 THEN '91-180 days'
        WHEN DATEDIFF(CURDATE(), due_date) >  180             THEN '180+ days'
        ELSE 'not overdue'
      END AS bucket,
      COUNT(*) AS invoices,
      ROUND(SUM(balance_due)) AS total_outstanding
    FROM invoices
    WHERE tenant_id = ? AND balance_due > 0 AND due_date IS NOT NULL AND status NOT IN ('void','draft')
    GROUP BY bucket ORDER BY bucket
  `, [TENANT_ID]);

  console.log('\nAging summary:');
  console.table(rows);
  await conn2.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });
