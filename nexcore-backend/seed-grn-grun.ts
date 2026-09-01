import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const uuid = () => require('crypto').randomUUID() as string;

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function seedGrnGrun() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    username: process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? 'root',
    database: process.env.DB_DATABASE ?? 'demo_nexcore',
    entities: [__dirname + '/src/**/*.entity{.ts,.js}'],
    synchronize: false,
  });

  await ds.initialize();

  const tenants = await ds.query('SELECT id, tenant_code FROM tenants WHERE is_active = 1');
  if (!tenants.length) { console.error('No tenants found.'); process.exit(1); }

  // ─── SUPPLIERS ────────────────────────────────────────────────────────────
  const supplierDefs = [
    { code: 'SUP001', name: 'Samsung Lanka (Pvt) Ltd',          contact: 'Ashan Perera',      email: 'ashan@samsunglanka.lk',      phone: '0112345001', terms: 'NET30' },
    { code: 'SUP002', name: 'Sony Sri Lanka Ltd',               contact: 'Tharuka Silva',     email: 'tharuka@sonylanka.lk',       phone: '0112345002', terms: 'NET45' },
    { code: 'SUP003', name: 'LG Electronics Lanka',             contact: 'Dinesh Fernando',   email: 'dinesh@lglanka.lk',          phone: '0112345003', terms: 'NET30' },
    { code: 'SUP004', name: 'Philips Lanka (Pvt) Ltd',          contact: 'Kavya Gunasekara',  email: 'kavya@philipslanka.lk',      phone: '0112345004', terms: 'NET60' },
    { code: 'SUP005', name: 'Nestlé Lanka PLC',                 contact: 'Roshan Jayawardena',email: 'roshan@nestle.lk',           phone: '0112345005', terms: 'NET30' },
    { code: 'SUP006', name: 'Unilever Sri Lanka Ltd',           contact: 'Malisha Bandara',   email: 'malisha@unilever.lk',        phone: '0112345006', terms: 'NET30' },
    { code: 'SUP007', name: 'Dilmah Ceylon Tea Ltd',            contact: 'Suchira Rajapaksa', email: 'suchira@dilmah.lk',          phone: '0112345007', terms: 'NET15' },
    { code: 'SUP008', name: 'Maliban Biscuit Mfg Co',           contact: 'Primal De Silva',   email: 'primal@maliban.lk',          phone: '0112345008', terms: 'NET15' },
    { code: 'SUP009', name: 'Munchee Biscuits (CBL)',           contact: 'Udara Samarawickrama',email:'udara@cbl.lk',             phone: '0112345009', terms: 'NET15' },
    { code: 'SUP010', name: 'Prima Ceylon Ltd',                 contact: 'Chamath Wijesuriya', email: 'chamath@prima.lk',          phone: '0112345010', terms: 'NET30' },
    { code: 'SUP011', name: 'Keells Food Products PLC',         contact: 'Iresha Karunaratne',email: 'iresha@keells.lk',           phone: '0112345011', terms: 'NET30' },
    { code: 'SUP012', name: 'Anchor Lanka (Fonterra)',          contact: 'Janith Seneviratne', email: 'janith@anchor.lk',          phone: '0112345012', terms: 'NET45' },
    { code: 'SUP013', name: 'Apple Authorized Distributor LK',  contact: 'Nidula Herath',     email: 'nidula@appledist.lk',        phone: '0112345013', terms: 'PREPAID' },
    { code: 'SUP014', name: 'Dialog Axiata PLC',                contact: 'Shanika Amarasinghe',email:'shanika@dialog.lk',         phone: '0777123456', terms: 'NET30' },
    { code: 'SUP015', name: 'Panasonic Lanka Ltd',              contact: 'Rukmal Jayasena',   email: 'rukmal@panasoniclanka.lk',   phone: '0112345015', terms: 'NET45' },
    { code: 'SUP016', name: 'Hitachi Sales Lanka',              contact: 'Gayashan Wijetunge',email: 'gayashan@hitachilanka.lk',   phone: '0112345016', terms: 'NET30' },
    { code: 'SUP017', name: 'Nike Lanka Distributors',          contact: 'Danushka Pieris',   email: 'danushka@nikelanka.lk',      phone: '0112345017', terms: 'NET60' },
    { code: 'SUP018', name: 'Adidas Lanka (Pvt) Ltd',          contact: 'Sachini Kulatunga', email: 'sachini@adidaslanka.lk',     phone: '0112345018', terms: 'NET60' },
    { code: 'SUP019', name: 'Ceylon Coconut Products Ltd',      contact: 'Supun Ranasinghe',  email: 'supun@ceyloncoconut.lk',     phone: '0112345019', terms: 'NET15' },
    { code: 'SUP020', name: 'CTC Ceylon Tea Exports',           contact: 'Wimal Abeykoon',    email: 'wimal@ctctea.lk',            phone: '0112345020', terms: 'NET15' },
  ];

  for (const tenant of tenants) {
    const tenantId = tenant.id;
    console.log(`\nSeeding GRN/GRUN for tenant: ${tenant.tenant_code}`);

    // Seed suppliers
    const supplierIds: Record<string, string> = {};
    for (const s of supplierDefs) {
      const existing = await ds.query('SELECT id FROM suppliers WHERE tenant_id = ? AND supplier_code = ?', [tenantId, s.code]);
      if (existing.length > 0) { supplierIds[s.code] = existing[0].id; continue; }
      const id = uuid();
      await ds.query(
        'INSERT INTO suppliers (id, tenant_id, supplier_code, supplier_name, contact_person, email, phone, payment_terms, is_active) VALUES (?,?,?,?,?,?,?,?,1)',
        [id, tenantId, s.code, s.name, s.contact, s.email, s.phone, s.terms],
      );
      supplierIds[s.code] = id;
    }
    console.log(`  ✓ ${supplierDefs.length} suppliers`);

    // Get products for this tenant
    const products = await ds.query('SELECT id, product_code, cost_price FROM products WHERE tenant_id = ? AND is_active = 1', [tenantId]);
    if (!products.length) { console.log('  No products found, skipping'); continue; }

    // Reset all stock to 0 before building from GRN history
    await ds.query('UPDATE product_stocks SET qty_on_hand = 0, qty_reserved = 0, qty_on_order = 0 WHERE tenant_id = ?', [tenantId]);

    // Get admin user for created_by
    const users = await ds.query('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenantId]);
    const createdBy = users.length ? users[0].id : uuid();

    // ─── SEED GRNs (60 per tenant, spread over last 365 days) ───────────────
    const grnHeaders: Array<{ id: string; supplierId: string; grnNumber: string }> = [];
    const allGrnItems: Array<{ id: string; grnId: string; productId: string; acceptedQty: number; unitCost: number }> = [];

    const supplierCodes = Object.keys(supplierIds);

    for (let i = 1; i <= 60; i++) {
      const grnId = uuid();
      const grnNumber = `GRN-${tenant.tenant_code.slice(-3)}-${String(i).padStart(4, '0')}`;
      const suppCode = supplierCodes[i % supplierCodes.length];
      const suppId = supplierIds[suppCode];
      const receivedDate = daysAgo(randomBetween(1, 365));
      const itemCount = randomBetween(3, 8);

      // Pick random products for this GRN (no duplicates)
      const shuffled = [...products].sort(() => Math.random() - 0.5);
      const selectedProducts = shuffled.slice(0, itemCount);

      let totalQty = 0;
      let totalCost = 0;
      const itemRows: Array<{ id: string; productId: string; acceptedQty: number; unitCost: number }> = [];

      for (const prod of selectedProducts) {
        const itemId = uuid();
        const receivedQty = randomBetween(10, 100);
        const damagedQty = randomBetween(0, 2);
        const acceptedQty = receivedQty - damagedQty;
        const unitCost = Number(prod.cost_price);
        const lineTotal = acceptedQty * unitCost;

        await ds.query(
          `INSERT INTO grn_items (id, tenant_id, grn_id, product_id, ordered_qty, received_qty, accepted_qty, damaged_qty, unit_cost, line_total)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [itemId, tenantId, grnId, prod.id, receivedQty, receivedQty, acceptedQty, damagedQty, unitCost, lineTotal],
        );

        totalQty += acceptedQty;
        totalCost += lineTotal;
        itemRows.push({ id: itemId, productId: prod.id, acceptedQty, unitCost });
        allGrnItems.push({ id: itemId, grnId, productId: prod.id, acceptedQty, unitCost });
      }

      await ds.query(
        `INSERT INTO grn_headers (id, tenant_id, grn_number, supplier_id, received_date, status, total_quantity, total_cost, created_by, approved_by, approved_at)
         VALUES (?,?,?,?,?,'approved',?,?,?,?,?)`,
        [grnId, tenantId, grnNumber, suppId, receivedDate, totalQty, totalCost, createdBy, createdBy, receivedDate + ' 10:00:00'],
      );

      // Update stock: +accepted_qty for each item
      for (const item of itemRows) {
        await ds.query(
          'UPDATE product_stocks SET qty_on_hand = qty_on_hand + ? WHERE tenant_id = ? AND product_id = ?',
          [item.acceptedQty, tenantId, item.productId],
        );
      }

      grnHeaders.push({ id: grnId, supplierId: suppId, grnNumber });
    }
    console.log(`  ✓ 60 GRNs (approved) + stock updated`);

    // ─── SEED GRUNs (20 per tenant, referencing GRNs) ───────────────────────
    let grunCount = 0;
    const returnReasons = [
      'Damaged goods received', 'Expired stock returned', 'Wrong items delivered',
      'Quality below standard', 'Excess quantity returned', 'Supplier replacement request',
    ];
    const conditions = ['damaged', 'expired', 'wrong_item', 'excess', 'quality_issue'];

    // Pick 20 GRNs to return from
    const grnSubset = grnHeaders.slice(0, 20);

    for (let i = 1; i <= 20; i++) {
      const srcGrn = grnSubset[i - 1];
      // Get items of this GRN
      const srcItems = allGrnItems.filter(x => x.grnId === srcGrn.id);
      if (srcItems.length === 0) continue;

      const grunId = uuid();
      const grunNumber = `GRUN-${tenant.tenant_code.slice(-3)}-${String(i).padStart(4, '0')}`;
      const returnDate = daysAgo(randomBetween(1, 30));
      const returnReason = returnReasons[i % returnReasons.length];

      // Return 1-3 items from the GRN
      const itemsToReturn = srcItems.slice(0, randomBetween(1, Math.min(3, srcItems.length)));
      let totalQty = 0;
      let totalCost = 0;

      for (const srcItem of itemsToReturn) {
        const returnQty = randomBetween(1, Math.min(5, Math.floor(srcItem.acceptedQty * 0.1) + 1));
        const lineTotal = returnQty * srcItem.unitCost;
        const condition = conditions[i % conditions.length];

        await ds.query(
          `INSERT INTO grun_items (id, tenant_id, grun_id, grn_item_id, product_id, return_qty, unit_cost, line_total, item_condition)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [uuid(), tenantId, grunId, srcItem.id, srcItem.productId, returnQty, srcItem.unitCost, lineTotal, condition],
        );

        totalQty += returnQty;
        totalCost += lineTotal;

        // Update stock: -return_qty
        await ds.query(
          'UPDATE product_stocks SET qty_on_hand = GREATEST(0, qty_on_hand - ?) WHERE tenant_id = ? AND product_id = ?',
          [returnQty, tenantId, srcItem.productId],
        );
      }

      await ds.query(
        `INSERT INTO grun_headers (id, tenant_id, grun_number, grn_id, supplier_id, grun_type, return_date, status, total_quantity, total_cost, return_reason, created_by, approved_by, approved_at)
         VALUES (?,?,?,?,?,'from_grn',?,'approved',?,?,?,?,?,?)`,
        [grunId, tenantId, grunNumber, srcGrn.id, srcGrn.supplierId, returnDate, totalQty, totalCost, returnReason, createdBy, createdBy, returnDate + ' 14:00:00'],
      );

      grunCount++;
    }
    console.log(`  ✓ ${grunCount} GRUNs (approved) + stock deducted`);

    // Final stock summary
    const stockSummary = await ds.query(
      'SELECT SUM(qty_on_hand) as total_qty, COUNT(*) as product_count FROM product_stocks WHERE tenant_id = ? AND qty_on_hand > 0',
      [tenantId],
    );
    console.log(`  ✓ Final stock: ${Math.round(stockSummary[0].total_qty)} units across ${stockSummary[0].product_count} products`);
  }

  console.log('\n✅ GRN + GRUN seed complete!');
  console.log('   Stock levels now reflect 60 GRN receipts minus 20 GRUN returns per tenant.');
  await ds.destroy();
}

seedGrnGrun().catch(e => { console.error(e); process.exit(1); });
