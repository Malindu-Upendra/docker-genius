import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
dotenv.config();

async function seed() {
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

  // Tenants
  const tenants = [
    { tenantCode: 'TENANT_001', companyName: 'Colombo Retail Hub Pvt Ltd', baseCurrency: 'LKR', timezone: 'Asia/Colombo', isActive: true },
    { tenantCode: 'TENANT_002', companyName: 'Kandy Traders Ltd', baseCurrency: 'LKR', timezone: 'Asia/Colombo', isActive: true },
    { tenantCode: 'TENANT_003', companyName: 'Galle Electronics', baseCurrency: 'LKR', timezone: 'Asia/Colombo', isActive: true },
  ];

  const passwordHash = await bcrypt.hash('test123', 12);
  const tenantIds: number[] = [];

  for (const t of tenants) {
    const existing = await ds.query('SELECT id FROM tenants WHERE tenant_code = ?', [t.tenantCode]);
    if (existing.length > 0) {
      tenantIds.push(existing[0].id);
      console.log(`Tenant ${t.tenantCode} already exists (id=${existing[0].id})`);
      continue;
    }
    const result = await ds.query(
      'INSERT INTO tenants (tenant_code, company_name, base_currency, timezone, is_active) VALUES (?, ?, ?, ?, ?)',
      [t.tenantCode, t.companyName, t.baseCurrency, t.timezone, true],
    );
    tenantIds.push(result.insertId);
    console.log(`Created tenant: ${t.tenantCode} (id=${result.insertId})`);
  }

  // Users
  const users = [
    { email: 'admin@colomboretail.lk', fullName: 'Colombo Admin', role: 'admin', tenantIdx: 0 },
    { email: 'admin@kandytraders.lk', fullName: 'Kandy Admin', role: 'admin', tenantIdx: 1 },
    { email: 'admin@galleelec.lk', fullName: 'Galle Admin', role: 'admin', tenantIdx: 2 },
  ];

  for (const u of users) {
    const existing = await ds.query('SELECT id FROM users WHERE email = ? AND tenant_id = ?', [u.email, tenantIds[u.tenantIdx]]);
    if (existing.length > 0) { console.log(`User ${u.email} already exists`); continue; }
    await ds.query(
      'INSERT INTO users (tenant_id, full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [tenantIds[u.tenantIdx], u.fullName, u.email, passwordHash, u.role, true],
    );
    console.log(`Created user: ${u.email}`);
  }

  console.log('\n✅ Seed complete. Login with:');
  console.log('  Email    : admin@colomboretail.lk');
  console.log('  Password : test123');

  await ds.destroy();
}

seed().catch(e => { console.error(e); process.exit(1); });
