/**
 * Seed script: generates realistic invoices + payments for Jan–Dec 2026
 * Run: node seed-invoices.js
 */
const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const TENANT_ID = 'c73be30e-ac59-48b1-97e3-092da548f79c';
const USER_ID   = '6ea31564-289a-47eb-adb3-32f085a62f1c';

// Monthly invoice targets (Jan–Dec). Seasonal variation — retail picks up mid-year and Q4.
const MONTHLY_TARGETS = [55, 50, 60, 65, 70, 80, 85, 75, 70, 85, 90, 100];

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
function pick(arr) { return arr[rndInt(0, arr.length - 1)]; }

function randDate(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = rndInt(1, daysInMonth);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost', user: 'root', password: 'root', database: 'demo_nexcore',
  });

  console.log('Fetching clients and products...');
  const [clients] = await conn.query('SELECT id FROM clients WHERE tenant_id = ?', [TENANT_ID]);
  const [products] = await conn.query(
    'SELECT id, selling_price, cost_price, tax_percentage FROM products WHERE tenant_id = ? AND is_active = 1',
    [TENANT_ID]
  );

  if (!clients.length || !products.length) {
    console.error('No clients or products found. Aborting.');
    process.exit(1);
  }

  const [countRow] = await conn.query('SELECT COUNT(*) AS n FROM invoices WHERE tenant_id = ?', [TENANT_ID]);
  let invoiceSeq = Number(countRow[0].n) + 1;

  const [payCountRow] = await conn.query('SELECT COUNT(*) AS n FROM payments WHERE tenant_id = ?', [TENANT_ID]);
  let paySeq = Number(payCountRow[0].n) + 1;

  const year = 2026;
  let totalInvoices = 0, totalPayments = 0, totalItems = 0;

  for (let month = 1; month <= 12; month++) {
    const target = MONTHLY_TARGETS[month - 1];
    process.stdout.write(`  Month ${String(month).padStart(2,'0')}/${year}: ${target} invoices... `);

    for (let n = 0; n < target; n++) {
      const invId       = uuidv4();
      const invNumber   = `INV-${year}-${String(invoiceSeq++).padStart(6, '0')}`;
      const invoiceDate = randDate(year, month);
      const clientId    = pick(clients).id;
      const numItems    = rndInt(2, 6);

      let subtotal = 0, taxAmount = 0, headerDiscount = 0;
      const lineItems = [];

      const shuffled = [...products].sort(() => Math.random() - 0.5).slice(0, numItems);
      for (const prod of shuffled) {
        const qty      = rndInt(1, 15);
        const unitPrice = Number(prod.selling_price) * rnd(0.92, 1.08);
        const discPct  = pick([0, 0, 0, 5, 10]);
        const taxPct   = Number(prod.tax_percentage) || 0;
        const gross    = qty * unitPrice;
        const discAmt  = gross * discPct / 100;
        const net      = gross - discAmt;
        const tax      = net * taxPct / 100;
        const lineTotal = net + tax;

        subtotal   += gross;
        taxAmount  += tax;
        headerDiscount += discAmt;

        lineItems.push({ id: uuidv4(), productId: prod.id, qty, unitPrice, discPct, discAmt, taxPct, tax, lineTotal });
      }

      const totalAmount = subtotal - headerDiscount + taxAmount;

      // 40% paid, 35% confirmed (unpaid), 15% partial, 10% also confirmed
      const roll = Math.random();
      let status, amountPaid, balanceDue;
      if (roll < 0.40)       { status = 'paid';      amountPaid = totalAmount; balanceDue = 0; }
      else if (roll < 0.75)  { status = 'confirmed'; amountPaid = 0;           balanceDue = totalAmount; }
      else if (roll < 0.90)  {
        const frac = rnd(0.2, 0.8);
        status = 'partial'; amountPaid = totalAmount * frac; balanceDue = totalAmount - amountPaid;
      } else                 { status = 'confirmed'; amountPaid = 0;           balanceDue = totalAmount; }

      // Invoice header — created_at/updated_at have DB defaults, let DB fill them
      await conn.query(
        `INSERT INTO invoices
          (id, tenant_id, invoice_number, client_id, invoice_date,
           subtotal, discount_amount, tax_amount, total_amount,
           balance_due, amount_paid, status, source, created_by)
         VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)`,
        [
          invId, TENANT_ID, invNumber, clientId, invoiceDate,
          subtotal.toFixed(2), headerDiscount.toFixed(2), taxAmount.toFixed(2), totalAmount.toFixed(2),
          balanceDue.toFixed(2), amountPaid.toFixed(2), status, 'manual', USER_ID,
        ]
      );

      // Invoice items — no created_at/updated_at columns on this table
      for (const item of lineItems) {
        await conn.query(
          `INSERT INTO invoice_items
            (id, tenant_id, invoice_id, product_id, quantity, unit_price,
             discount_percentage, discount_amount, tax_percentage, tax_amount, line_total)
           VALUES (?,?,?,?,?,?, ?,?,?,?,?)`,
          [
            item.id, TENANT_ID, invId, item.productId,
            item.qty, item.unitPrice.toFixed(4),
            item.discPct, item.discAmt.toFixed(2),
            item.taxPct, item.tax.toFixed(2),
            item.lineTotal.toFixed(2),
          ]
        );
        totalItems++;
      }

      // Payment for paid / partial invoices
      if (status === 'paid' || status === 'partial') {
        const payId     = uuidv4();
        const payNumber = `PAY-${year}-${String(paySeq++).padStart(6, '0')}`;
        const payDate   = addDays(invoiceDate, rndInt(1, 20));
        const method    = pick(['cash', 'bank_transfer', 'cheque', 'card']);

        await conn.query(
          `INSERT INTO payments
            (id, tenant_id, payment_number, client_id, payment_method_id, payment_date,
             amount, base_amount, status, created_by)
           VALUES (?,?,?,?,?,?, ?,?,?,?)`,
          [
            payId, TENANT_ID, payNumber, clientId, method, payDate,
            amountPaid.toFixed(2), amountPaid.toFixed(2), 'confirmed', USER_ID,
          ]
        );

        await conn.query(
          `INSERT INTO payment_allocations
            (id, tenant_id, payment_id, invoice_id, allocated_amount)
           VALUES (?,?,?,?,?)`,
          [uuidv4(), TENANT_ID, payId, invId, amountPaid.toFixed(2)]
        );

        totalPayments++;
      }

      totalInvoices++;
    }

    console.log(`done (total: ${totalInvoices} invoices, ${totalPayments} payments)`);
  }

  await conn.end();
  console.log('\n✓ Seeding complete!');
  console.log(`  Invoices:      ${totalInvoices}`);
  console.log(`  Invoice items: ${totalItems}`);
  console.log(`  Payments:      ${totalPayments}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
