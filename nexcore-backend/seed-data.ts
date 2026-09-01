import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

const uuid = () => require('crypto').randomUUID() as string;

async function seedData() {
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

  // Fetch tenant IDs
  const tenants = await ds.query('SELECT id, tenant_code FROM tenants WHERE is_active = 1');
  if (!tenants.length) { console.error('No tenants found. Run seed.ts first.'); process.exit(1); }
  console.log(`Found ${tenants.length} tenant(s)`);

  // ─── UNITS (shared per tenant) ───────────────────────────────────────────
  const unitDefs = [
    { code: 'EA',  name: 'Each' },
    { code: 'BOX', name: 'Box' },
    { code: 'KG',  name: 'Kilogram' },
    { code: 'LTR', name: 'Litre' },
    { code: 'MTR', name: 'Metre' },
    { code: 'PKT', name: 'Packet' },
    { code: 'PCS', name: 'Pieces' },
  ];

  // ─── CATEGORIES ──────────────────────────────────────────────────────────
  const categoryDefs = [
    { code: 'ELEC',  name: 'Electronics' },
    { code: 'MOBI',  name: 'Mobile & Accessories' },
    { code: 'COMP',  name: 'Computers & Peripherals' },
    { code: 'APPL',  name: 'Home Appliances' },
    { code: 'CLOTH', name: 'Clothing & Apparel' },
    { code: 'FOOD',  name: 'Food & Beverages' },
    { code: 'HLTH',  name: 'Health & Beauty' },
    { code: 'STAT',  name: 'Stationery & Office' },
    { code: 'SPRT',  name: 'Sports & Fitness' },
    { code: 'FURN',  name: 'Furniture & Home' },
    { code: 'AUTO',  name: 'Automotive' },
    { code: 'TOYS',  name: 'Toys & Games' },
  ];

  // ─── BRANDS ──────────────────────────────────────────────────────────────
  const brandDefs = [
    { code: 'SAMS',  name: 'Samsung' },
    { code: 'APPL',  name: 'Apple' },
    { code: 'SONY',  name: 'Sony' },
    { code: 'LG',    name: 'LG' },
    { code: 'PHIL',  name: 'Philips' },
    { code: 'UNILV', name: 'Unilever' },
    { code: 'NESTL', name: 'Nestlé' },
    { code: 'MALIB', name: 'Maliban' },
    { code: 'DILM',  name: 'Dilmah' },
    { code: 'ANCHM', name: 'Anchor' },
    { code: 'MUNCH', name: 'Munchee' },
    { code: 'PRIMA', name: 'Prima' },
    { code: 'KEELL', name: 'Keells' },
    { code: 'DIALO', name: 'Dialog' },
    { code: 'HTACH', name: 'Hitachi' },
    { code: 'PANSO', name: 'Panasonic' },
    { code: 'NIKE',  name: 'Nike' },
    { code: 'ADIDS', name: 'Adidas' },
    { code: 'ARIEL', name: 'Ariel' },
    { code: 'CEYLO', name: 'Ceylon Tea Board' },
  ];

  // ─── PRODUCT DEFINITIONS (120+) ──────────────────────────────────────────
  const productDefs = [
    // Electronics
    { code: 'P001', name: 'Samsung 43" 4K Smart TV', cat: 'ELEC', brand: 'SAMS', unit: 'EA', cost: 85000, sell: 115000, tax: 0, reorder: 2 },
    { code: 'P002', name: 'Samsung 55" QLED TV', cat: 'ELEC', brand: 'SAMS', unit: 'EA', cost: 145000, sell: 195000, tax: 0, reorder: 2 },
    { code: 'P003', name: 'Sony Bravia 40" LED TV', cat: 'ELEC', brand: 'SONY', unit: 'EA', cost: 72000, sell: 98000, tax: 0, reorder: 2 },
    { code: 'P004', name: 'LG 32" HD TV', cat: 'ELEC', brand: 'LG', unit: 'EA', cost: 42000, sell: 58000, tax: 0, reorder: 3 },
    { code: 'P005', name: 'Philips Home Theatre 5.1', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 28000, sell: 38500, tax: 0, reorder: 3 },
    { code: 'P006', name: 'Sony Soundbar 2.1 Channel', cat: 'ELEC', brand: 'SONY', unit: 'EA', cost: 18500, sell: 26000, tax: 0, reorder: 5 },
    { code: 'P007', name: 'Samsung Bluetooth Speaker', cat: 'ELEC', brand: 'SAMS', unit: 'EA', cost: 6500, sell: 9500, tax: 0, reorder: 10 },
    { code: 'P008', name: 'Panasonic DVD Player', cat: 'ELEC', brand: 'PANSO', unit: 'EA', cost: 8200, sell: 11500, tax: 0, reorder: 5 },
    // Mobile & Accessories
    { code: 'P009', name: 'Samsung Galaxy A54 5G', cat: 'MOBI', brand: 'SAMS', unit: 'EA', cost: 62000, sell: 82000, tax: 0, reorder: 5 },
    { code: 'P010', name: 'Samsung Galaxy S23', cat: 'MOBI', brand: 'SAMS', unit: 'EA', cost: 115000, sell: 155000, tax: 0, reorder: 3 },
    { code: 'P011', name: 'Apple iPhone 14', cat: 'MOBI', brand: 'APPL', unit: 'EA', cost: 135000, sell: 175000, tax: 0, reorder: 3 },
    { code: 'P012', name: 'Apple iPhone 13', cat: 'MOBI', brand: 'APPL', unit: 'EA', cost: 108000, sell: 142000, tax: 0, reorder: 3 },
    { code: 'P013', name: 'Dialog 4G SIM Card', cat: 'MOBI', brand: 'DIALO', unit: 'EA', cost: 100, sell: 200, tax: 0, reorder: 50 },
    { code: 'P014', name: 'Samsung Fast Charger 25W', cat: 'MOBI', brand: 'SAMS', unit: 'EA', cost: 1800, sell: 2800, tax: 0, reorder: 20 },
    { code: 'P015', name: 'Apple USB-C Cable 1m', cat: 'MOBI', brand: 'APPL', unit: 'EA', cost: 2200, sell: 3500, tax: 0, reorder: 20 },
    { code: 'P016', name: 'Wireless Earbuds Samsung', cat: 'MOBI', brand: 'SAMS', unit: 'EA', cost: 7500, sell: 10500, tax: 0, reorder: 10 },
    // Computers
    { code: 'P017', name: 'Samsung Laptop i5 8GB 256SSD', cat: 'COMP', brand: 'SAMS', unit: 'EA', cost: 92000, sell: 125000, tax: 0, reorder: 2 },
    { code: 'P018', name: 'Apple MacBook Air M2', cat: 'COMP', brand: 'APPL', unit: 'EA', cost: 185000, sell: 245000, tax: 0, reorder: 2 },
    { code: 'P019', name: 'LG 24" Monitor Full HD', cat: 'COMP', brand: 'LG', unit: 'EA', cost: 22000, sell: 31500, tax: 0, reorder: 5 },
    { code: 'P020', name: 'Wireless Keyboard & Mouse', cat: 'COMP', brand: 'PHIL', unit: 'EA', cost: 3500, sell: 5200, tax: 0, reorder: 10 },
    { code: 'P021', name: 'USB Hub 4-Port', cat: 'COMP', brand: 'PHIL', unit: 'EA', cost: 1200, sell: 1950, tax: 0, reorder: 15 },
    { code: 'P022', name: 'Webcam HD 1080p', cat: 'COMP', brand: 'SONY', unit: 'EA', cost: 5500, sell: 8200, tax: 0, reorder: 10 },
    { code: 'P023', name: 'External Hard Drive 1TB', cat: 'COMP', brand: 'SAMS', unit: 'EA', cost: 8800, sell: 12500, tax: 0, reorder: 10 },
    // Home Appliances
    { code: 'P024', name: 'Samsung Refrigerator 250L', cat: 'APPL', brand: 'SAMS', unit: 'EA', cost: 58000, sell: 78000, tax: 0, reorder: 2 },
    { code: 'P025', name: 'LG Washing Machine 7kg', cat: 'APPL', brand: 'LG', unit: 'EA', cost: 48000, sell: 65000, tax: 0, reorder: 2 },
    { code: 'P026', name: 'Philips Air Fryer 4.1L', cat: 'APPL', brand: 'PHIL', unit: 'EA', cost: 12500, sell: 17500, tax: 0, reorder: 5 },
    { code: 'P027', name: 'Panasonic Microwave 20L', cat: 'APPL', brand: 'PANSO', unit: 'EA', cost: 15000, sell: 21000, tax: 0, reorder: 3 },
    { code: 'P028', name: 'Philips Blender 600W', cat: 'APPL', brand: 'PHIL', unit: 'EA', cost: 4200, sell: 6200, tax: 0, reorder: 8 },
    { code: 'P029', name: 'Hitachi Rice Cooker 1.8L', cat: 'APPL', brand: 'HTACH', unit: 'EA', cost: 6500, sell: 9200, tax: 0, reorder: 8 },
    { code: 'P030', name: 'LG Inverter AC 1.5 Ton', cat: 'APPL', brand: 'LG', unit: 'EA', cost: 88000, sell: 120000, tax: 0, reorder: 1 },
    { code: 'P031', name: 'Panasonic Ceiling Fan 56"', cat: 'APPL', brand: 'PANSO', unit: 'EA', cost: 4800, sell: 7200, tax: 0, reorder: 5 },
    { code: 'P032', name: 'Philips Iron 2000W Steam', cat: 'APPL', brand: 'PHIL', unit: 'EA', cost: 2800, sell: 4200, tax: 0, reorder: 10 },
    // Food & Beverages
    { code: 'P033', name: 'Dilmah Premium Tea 100 Bags', cat: 'FOOD', brand: 'DILM', unit: 'PKT', cost: 280, sell: 420, tax: 0, reorder: 50 },
    { code: 'P034', name: 'Dilmah Green Tea 50 Bags', cat: 'FOOD', brand: 'DILM', unit: 'PKT', cost: 180, sell: 280, tax: 0, reorder: 50 },
    { code: 'P035', name: 'Nestlé Milo 400g', cat: 'FOOD', brand: 'NESTL', unit: 'PKT', cost: 320, sell: 480, tax: 0, reorder: 30 },
    { code: 'P036', name: 'Nestlé Nescafé Classic 200g', cat: 'FOOD', brand: 'NESTL', unit: 'PKT', cost: 580, sell: 850, tax: 0, reorder: 20 },
    { code: 'P037', name: 'Maliban Cream Cracker 200g', cat: 'FOOD', brand: 'MALIB', unit: 'PKT', cost: 95, sell: 145, tax: 0, reorder: 100 },
    { code: 'P038', name: 'Munchee Butter Cake 100g', cat: 'FOOD', brand: 'MUNCH', unit: 'PKT', cost: 65, sell: 100, tax: 0, reorder: 100 },
    { code: 'P039', name: 'Prima Kottu Noodles 400g', cat: 'FOOD', brand: 'PRIMA', unit: 'PKT', cost: 120, sell: 185, tax: 0, reorder: 60 },
    { code: 'P040', name: 'Anchor Milk Powder 400g', cat: 'FOOD', brand: 'ANCHM', unit: 'PKT', cost: 480, sell: 720, tax: 0, reorder: 30 },
    { code: 'P041', name: 'Keells Sausages 500g', cat: 'FOOD', brand: 'KEELL', unit: 'PKT', cost: 380, sell: 580, tax: 0, reorder: 20 },
    { code: 'P042', name: 'Nestlé KitKat 4-Finger Bar', cat: 'FOOD', brand: 'NESTL', unit: 'EA', cost: 95, sell: 140, tax: 0, reorder: 100 },
    { code: 'P043', name: 'Maliban Ginger Biscuits 200g', cat: 'FOOD', brand: 'MALIB', unit: 'PKT', cost: 88, sell: 135, tax: 0, reorder: 80 },
    { code: 'P044', name: 'Prima Rice 5kg', cat: 'FOOD', brand: 'PRIMA', unit: 'PKT', cost: 950, sell: 1350, tax: 0, reorder: 25 },
    { code: 'P045', name: 'Ceylon Tea Loose Leaf 500g', cat: 'FOOD', brand: 'CEYLO', unit: 'PKT', cost: 320, sell: 490, tax: 0, reorder: 30 },
    { code: 'P046', name: 'Munchee Super Cream 150g', cat: 'FOOD', brand: 'MUNCH', unit: 'PKT', cost: 72, sell: 110, tax: 0, reorder: 80 },
    { code: 'P047', name: 'Nestlé Maggi Noodles 80g', cat: 'FOOD', brand: 'NESTL', unit: 'PKT', cost: 55, sell: 85, tax: 0, reorder: 100 },
    { code: 'P048', name: 'Anchor Butter 200g', cat: 'FOOD', brand: 'ANCHM', unit: 'PKT', cost: 210, sell: 320, tax: 0, reorder: 30 },
    // Health & Beauty
    { code: 'P049', name: 'Dove Body Wash 250ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 280, sell: 420, tax: 0, reorder: 30 },
    { code: 'P050', name: 'Sunsilk Shampoo 340ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 320, sell: 480, tax: 0, reorder: 25 },
    { code: 'P051', name: 'Closeup Toothpaste 175g', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 165, sell: 250, tax: 0, reorder: 40 },
    { code: 'P052', name: 'Lifebuoy Bar Soap 120g (3pk)', cat: 'HLTH', brand: 'UNILV', unit: 'PKT', cost: 135, sell: 205, tax: 0, reorder: 50 },
    { code: 'P053', name: 'Vaseline Body Lotion 400ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 420, sell: 650, tax: 0, reorder: 20 },
    { code: 'P054', name: 'Philips Trimmer BT3221', cat: 'HLTH', brand: 'PHIL', unit: 'EA', cost: 3800, sell: 5800, tax: 0, reorder: 10 },
    { code: 'P055', name: 'Rexona Deo Roll-On 50ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 220, sell: 340, tax: 0, reorder: 30 },
    { code: 'P056', name: 'Lux Soap 100g', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 68, sell: 105, tax: 0, reorder: 60 },
    // Household & Cleaning
    { code: 'P057', name: 'Ariel Detergent Powder 2kg', cat: 'HLTH', brand: 'ARIEL', unit: 'PKT', cost: 680, sell: 980, tax: 0, reorder: 20 },
    { code: 'P058', name: 'Ariel Detergent Liquid 1L', cat: 'HLTH', brand: 'ARIEL', unit: 'EA', cost: 420, sell: 650, tax: 0, reorder: 20 },
    { code: 'P059', name: 'Unilever Vim Dishwash 500g', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 180, sell: 275, tax: 0, reorder: 30 },
    { code: 'P060', name: 'Philips LED Bulb 9W E27', cat: 'HLTH', brand: 'PHIL', unit: 'EA', cost: 180, sell: 275, tax: 0, reorder: 50 },
    // Stationery
    { code: 'P061', name: 'A4 Photocopy Paper 500 Sheets', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 620, sell: 920, tax: 0, reorder: 20 },
    { code: 'P062', name: 'Ballpoint Pen Blue (10pk)', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 120, sell: 195, tax: 0, reorder: 30 },
    { code: 'P063', name: 'Stapler Standard Size', cat: 'STAT', brand: 'PHIL', unit: 'EA', cost: 350, sell: 550, tax: 0, reorder: 10 },
    { code: 'P064', name: 'Spiral Notebook A5', cat: 'STAT', brand: 'PHIL', unit: 'EA', cost: 95, sell: 155, tax: 0, reorder: 30 },
    { code: 'P065', name: 'Whiteboard Marker Set 4 Colors', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 280, sell: 450, tax: 0, reorder: 15 },
    { code: 'P066', name: 'Scissors 8" Stainless', cat: 'STAT', brand: 'PHIL', unit: 'EA', cost: 120, sell: 195, tax: 0, reorder: 15 },
    { code: 'P067', name: 'Calculator 12-Digit Desktop', cat: 'STAT', brand: 'PANSO', unit: 'EA', cost: 580, sell: 880, tax: 0, reorder: 10 },
    { code: 'P068', name: 'Correction Fluid 20ml', cat: 'STAT', brand: 'PHIL', unit: 'EA', cost: 65, sell: 100, tax: 0, reorder: 30 },
    // Sports & Fitness
    { code: 'P069', name: 'Nike Running Shoes Men Size 42', cat: 'SPRT', brand: 'NIKE', unit: 'EA', cost: 8500, sell: 13500, tax: 0, reorder: 5 },
    { code: 'P070', name: 'Adidas Training Shoes Women', cat: 'SPRT', brand: 'ADIDS', unit: 'EA', cost: 7200, sell: 11500, tax: 0, reorder: 5 },
    { code: 'P071', name: 'Nike Sports T-Shirt Dri-Fit', cat: 'SPRT', brand: 'NIKE', unit: 'EA', cost: 2200, sell: 3500, tax: 0, reorder: 10 },
    { code: 'P072', name: 'Adidas Sports Bag', cat: 'SPRT', brand: 'ADIDS', unit: 'EA', cost: 3500, sell: 5500, tax: 0, reorder: 8 },
    { code: 'P073', name: 'Yoga Mat Non-Slip 6mm', cat: 'SPRT', brand: 'NIKE', unit: 'EA', cost: 1800, sell: 2900, tax: 0, reorder: 10 },
    { code: 'P074', name: 'Dumbbell Set 2kg Pair', cat: 'SPRT', brand: 'PHIL', unit: 'EA', cost: 1200, sell: 1900, tax: 0, reorder: 10 },
    { code: 'P075', name: 'Water Bottle 1L BPA Free', cat: 'SPRT', brand: 'NIKE', unit: 'EA', cost: 580, sell: 920, tax: 0, reorder: 20 },
    // Clothing
    { code: 'P076', name: 'Men\'s Polo Shirt Cotton M', cat: 'CLOTH', brand: 'NIKE', unit: 'EA', cost: 1200, sell: 1950, tax: 0, reorder: 10 },
    { code: 'P077', name: 'Men\'s Polo Shirt Cotton L', cat: 'CLOTH', brand: 'NIKE', unit: 'EA', cost: 1200, sell: 1950, tax: 0, reorder: 10 },
    { code: 'P078', name: 'Women\'s Cotton Kurta S', cat: 'CLOTH', brand: 'ADIDS', unit: 'EA', cost: 1800, sell: 2900, tax: 0, reorder: 8 },
    { code: 'P079', name: 'Men\'s Denim Jeans 32', cat: 'CLOTH', brand: 'ADIDS', unit: 'EA', cost: 2800, sell: 4500, tax: 0, reorder: 5 },
    { code: 'P080', name: 'Kids School Uniform Set 6-8yrs', cat: 'CLOTH', brand: 'PHIL', unit: 'EA', cost: 1500, sell: 2400, tax: 0, reorder: 10 },
    // Furniture & Home
    { code: 'P081', name: 'Office Chair Ergonomic', cat: 'FURN', brand: 'PHIL', unit: 'EA', cost: 12000, sell: 18500, tax: 0, reorder: 2 },
    { code: 'P082', name: 'Wooden Bookshelf 4-Tier', cat: 'FURN', brand: 'PHIL', unit: 'EA', cost: 8500, sell: 13500, tax: 0, reorder: 2 },
    { code: 'P083', name: 'Study Table with Drawer', cat: 'FURN', brand: 'PHIL', unit: 'EA', cost: 15000, sell: 22500, tax: 0, reorder: 1 },
    { code: 'P084', name: 'Curtains 2-Panel Set 7ft', cat: 'FURN', brand: 'PHIL', unit: 'EA', cost: 2800, sell: 4500, tax: 0, reorder: 5 },
    { code: 'P085', name: 'Floor Rug 5x7 ft', cat: 'FURN', brand: 'PHIL', unit: 'EA', cost: 4500, sell: 7200, tax: 0, reorder: 3 },
    // Automotive
    { code: 'P086', name: 'Car Microfiber Towel Pack 3', cat: 'AUTO', brand: 'PHIL', unit: 'PKT', cost: 280, sell: 450, tax: 0, reorder: 20 },
    { code: 'P087', name: 'Car Air Freshener Vanillic', cat: 'AUTO', brand: 'PHIL', unit: 'EA', cost: 180, sell: 290, tax: 0, reorder: 30 },
    { code: 'P088', name: 'Tyre Inflator 12V Digital', cat: 'AUTO', brand: 'PHIL', unit: 'EA', cost: 3200, sell: 5000, tax: 0, reorder: 5 },
    { code: 'P089', name: 'Dashboard Camera HD 1080p', cat: 'AUTO', brand: 'SONY', unit: 'EA', cost: 8500, sell: 13000, tax: 0, reorder: 3 },
    { code: 'P090', name: 'Car Phone Holder Magnetic', cat: 'AUTO', brand: 'PHIL', unit: 'EA', cost: 480, sell: 780, tax: 0, reorder: 20 },
    // Toys & Games
    { code: 'P091', name: 'LEGO Classic Set 200 pcs', cat: 'TOYS', brand: 'PHIL', unit: 'EA', cost: 3500, sell: 5500, tax: 0, reorder: 5 },
    { code: 'P092', name: 'Remote Control Car 4WD', cat: 'TOYS', brand: 'PHIL', unit: 'EA', cost: 2800, sell: 4500, tax: 0, reorder: 5 },
    { code: 'P093', name: 'Board Game Monopoly', cat: 'TOYS', brand: 'PHIL', unit: 'EA', cost: 1800, sell: 2900, tax: 0, reorder: 5 },
    { code: 'P094', name: 'Puzzle 500 Pieces', cat: 'TOYS', brand: 'PHIL', unit: 'EA', cost: 680, sell: 1100, tax: 0, reorder: 8 },
    { code: 'P095', name: 'Badminton Racket Set 2', cat: 'SPRT', brand: 'NIKE', unit: 'EA', cost: 2200, sell: 3500, tax: 0, reorder: 5 },
    // More Electronics
    { code: 'P096', name: 'Philips LED Tube 18W 4ft', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 380, sell: 580, tax: 0, reorder: 30 },
    { code: 'P097', name: 'Extension Cord 5 Socket 5m', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 680, sell: 1050, tax: 0, reorder: 20 },
    { code: 'P098', name: 'UPS 650VA APC', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 8500, sell: 12500, tax: 0, reorder: 5 },
    { code: 'P099', name: 'HDMI Cable 1.5m 4K', cat: 'ELEC', brand: 'SAMS', unit: 'EA', cost: 480, sell: 750, tax: 0, reorder: 25 },
    { code: 'P100', name: 'Digital Weighing Scale 5kg', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 2200, sell: 3400, tax: 0, reorder: 8 },
    // More Food
    { code: 'P101', name: 'Nestlé Nespray Full Cream 1kg', cat: 'FOOD', brand: 'NESTL', unit: 'PKT', cost: 1150, sell: 1650, tax: 0, reorder: 15 },
    { code: 'P102', name: 'Maliban Chocolate Biscuits 200g', cat: 'FOOD', brand: 'MALIB', unit: 'PKT', cost: 105, sell: 160, tax: 0, reorder: 60 },
    { code: 'P103', name: 'Prima Wheat Flour 1kg', cat: 'FOOD', brand: 'PRIMA', unit: 'PKT', cost: 165, sell: 250, tax: 0, reorder: 40 },
    { code: 'P104', name: 'Keells Chicken Nuggets 400g', cat: 'FOOD', brand: 'KEELL', unit: 'PKT', cost: 420, sell: 650, tax: 0, reorder: 15 },
    { code: 'P105', name: 'Munchee Choco Leibniz 100g', cat: 'FOOD', brand: 'MUNCH', unit: 'PKT', cost: 120, sell: 185, tax: 0, reorder: 40 },
    { code: 'P106', name: 'Ceylon Coconut Oil 500ml', cat: 'FOOD', brand: 'CEYLO', unit: 'EA', cost: 420, sell: 650, tax: 0, reorder: 20 },
    { code: 'P107', name: 'Anchor Cheese Slices 200g', cat: 'FOOD', brand: 'ANCHM', unit: 'PKT', cost: 380, sell: 580, tax: 0, reorder: 15 },
    { code: 'P108', name: 'Keells Fish Fingers 300g', cat: 'FOOD', brand: 'KEELL', unit: 'PKT', cost: 320, sell: 490, tax: 0, reorder: 15 },
    // More Health
    { code: 'P109', name: 'Ponds Face Wash 100g', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 185, sell: 285, tax: 0, reorder: 30 },
    { code: 'P110', name: 'Dove Conditioner 180ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 295, sell: 450, tax: 0, reorder: 25 },
    { code: 'P111', name: 'Signal Toothpaste 160g', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 145, sell: 225, tax: 0, reorder: 40 },
    { code: 'P112', name: 'Clear Shampoo Anti-Dandruff 350ml', cat: 'HLTH', brand: 'UNILV', unit: 'EA', cost: 345, sell: 530, tax: 0, reorder: 25 },
    // More Stationery
    { code: 'P113', name: 'Sticky Notes 75x75mm Pack 5', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 145, sell: 225, tax: 0, reorder: 20 },
    { code: 'P114', name: 'Highlighter Set 5 Colors', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 220, sell: 350, tax: 0, reorder: 15 },
    { code: 'P115', name: 'File Folder A4 Pack 10', cat: 'STAT', brand: 'PHIL', unit: 'PKT', cost: 280, sell: 430, tax: 0, reorder: 15 },
    // More Appliances
    { code: 'P116', name: 'Hitachi Water Heater 15L', cat: 'APPL', brand: 'HTACH', unit: 'EA', cost: 22000, sell: 32000, tax: 0, reorder: 2 },
    { code: 'P117', name: 'Philips Vacuum Cleaner 1800W', cat: 'APPL', brand: 'PHIL', unit: 'EA', cost: 18500, sell: 27000, tax: 0, reorder: 3 },
    { code: 'P118', name: 'LG Dishwasher 10 Place', cat: 'APPL', brand: 'LG', unit: 'EA', cost: 55000, sell: 75000, tax: 0, reorder: 1 },
    { code: 'P119', name: 'Panasonic Air Purifier', cat: 'APPL', brand: 'PANSO', unit: 'EA', cost: 32000, sell: 46000, tax: 0, reorder: 2 },
    { code: 'P120', name: 'Hitachi Toaster 4-Slice', cat: 'APPL', brand: 'HTACH', unit: 'EA', cost: 4800, sell: 7200, tax: 0, reorder: 5 },
    // Bonus extras
    { code: 'P121', name: 'Sony Headphones WH-1000XM4', cat: 'ELEC', brand: 'SONY', unit: 'EA', cost: 38000, sell: 52000, tax: 0, reorder: 3 },
    { code: 'P122', name: 'Philips Smart Bulb Wi-Fi 10W', cat: 'ELEC', brand: 'PHIL', unit: 'EA', cost: 1200, sell: 1900, tax: 0, reorder: 15 },
    { code: 'P123', name: 'Samsung Galaxy Tab A8', cat: 'MOBI', brand: 'SAMS', unit: 'EA', cost: 52000, sell: 70000, tax: 0, reorder: 3 },
    { code: 'P124', name: 'Apple iPad 10th Gen', cat: 'MOBI', brand: 'APPL', unit: 'EA', cost: 95000, sell: 128000, tax: 0, reorder: 2 },
    { code: 'P125', name: 'Adidas Running Shorts M', cat: 'SPRT', brand: 'ADIDS', unit: 'EA', cost: 1500, sell: 2400, tax: 0, reorder: 10 },
  ];

  // ─── CLIENT GROUPS ────────────────────────────────────────────────────────
  const clientGroupDefs = [
    { code: 'RETAIL',   name: 'Retail Customer',    creditLimit: 0,       discount: 0 },
    { code: 'WHOLE',    name: 'Wholesale Customer',  creditLimit: 500000,  discount: 5 },
    { code: 'CORP',     name: 'Corporate Client',    creditLimit: 2000000, discount: 10 },
    { code: 'GOLD',     name: 'Gold Member',         creditLimit: 100000,  discount: 3 },
    { code: 'PLATINUM', name: 'Platinum Member',     creditLimit: 500000,  discount: 7 },
    { code: 'GOVT',     name: 'Government Entity',   creditLimit: 5000000, discount: 0 },
  ];

  // ─── CLIENT DEFINITIONS (125+) ────────────────────────────────────────────
  const sriLankaCities = ['Colombo', 'Kandy', 'Galle', 'Negombo', 'Jaffna', 'Trincomalee', 'Matara', 'Kurunegala', 'Anuradhapura', 'Ratnapura', 'Badulla', 'Batticaloa', 'Hambantota', 'Vavuniya', 'Polonnaruwa'];
  const clientGroupCodes = ['RETAIL', 'WHOLE', 'CORP', 'GOLD', 'PLATINUM', 'GOVT'];

  const clientDefs = [
    { code: 'C001', name: 'Sunshine Supermarket (Pvt) Ltd', contact: 'Kasun Perera', email: 'kasun@sunshinesm.lk', phone: '0112345678', city: 'Colombo', group: 'WHOLE', credit: 250000 },
    { code: 'C002', name: 'Kandy City Traders', contact: 'Nalini Silva', email: 'nalini@kctraders.lk', phone: '0812345678', city: 'Kandy', group: 'WHOLE', credit: 150000 },
    { code: 'C003', name: 'Galle Fort Stores', contact: 'Priya Fernando', email: 'priya@gallestores.lk', phone: '0912345678', city: 'Galle', group: 'RETAIL', credit: 0 },
    { code: 'C004', name: 'Tech Solutions Lanka (Pvt) Ltd', contact: 'Dinesh Wickramasinghe', email: 'dinesh@techsolutions.lk', phone: '0113344556', city: 'Colombo', group: 'CORP', credit: 1000000 },
    { code: 'C005', name: 'Negombo Fisheries Export Co', contact: 'Sunil Mendis', email: 'sunil@negombofisheries.lk', phone: '0312345678', city: 'Negombo', group: 'CORP', credit: 800000 },
    { code: 'C006', name: 'Northern Province Traders', contact: 'Rajan Selvam', email: 'rajan@northerntraders.lk', phone: '0212345678', city: 'Jaffna', group: 'WHOLE', credit: 200000 },
    { code: 'C007', name: 'Trinco Shipping & Logistics', contact: 'Chamara Bandara', email: 'chamara@trincoship.lk', phone: '0262345678', city: 'Trincomalee', group: 'CORP', credit: 1500000 },
    { code: 'C008', name: 'Matara Electronics Hub', contact: 'Samith Jayawardena', email: 'samith@mataraelec.lk', phone: '0412345678', city: 'Matara', group: 'WHOLE', credit: 120000 },
    { code: 'C009', name: 'Kurunegala Wholesale Market', contact: 'Amara Rathnayake', email: 'amara@kuruwholesale.lk', phone: '0372345678', city: 'Kurunegala', group: 'WHOLE', credit: 300000 },
    { code: 'C010', name: 'Sri Lanka Telecom PLC', contact: 'Chandrika Dissanayake', email: 'procurement@slt.lk', phone: '0112333333', city: 'Colombo', group: 'GOVT', credit: 5000000 },
    { code: 'C011', name: 'Anuradhapura Heritage Stores', contact: 'Bhagya Gunasekara', email: 'bhagya@ahstores.lk', phone: '0252345678', city: 'Anuradhapura', group: 'RETAIL', credit: 0 },
    { code: 'C012', name: 'Ratnapura Gems & Trading', contact: 'Lasantha Senanayake', email: 'lasantha@ratnapuragems.lk', phone: '0452345678', city: 'Ratnapura', group: 'CORP', credit: 600000 },
    { code: 'C013', name: 'Badulla Hill Country Retail', contact: 'Nirosha Karunaratne', email: 'nirosha@hillretail.lk', phone: '0552345678', city: 'Badulla', group: 'RETAIL', credit: 0 },
    { code: 'C014', name: 'Eastern Province Traders Ltd', contact: 'Krishnan Murugan', email: 'krishnan@eptraders.lk', phone: '0652345678', city: 'Batticaloa', group: 'WHOLE', credit: 180000 },
    { code: 'C015', name: 'Hambantota Port Supplies', contact: 'Mahesh Gamage', email: 'mahesh@hbtsupplies.lk', phone: '0472345678', city: 'Hambantota', group: 'CORP', credit: 2000000 },
    { code: 'C016', name: 'Lanka Grocery Distributors', contact: 'Shantha Dharmasena', email: 'shantha@lgd.lk', phone: '0114455667', city: 'Colombo', group: 'WHOLE', credit: 400000 },
    { code: 'C017', name: 'Colombo Pharma Retail Ltd', contact: 'Dr. Pradeep Samarakoon', email: 'pradeep@cpharma.lk', phone: '0115566778', city: 'Colombo', group: 'CORP', credit: 750000 },
    { code: 'C018', name: 'Vavuniya Northern Supplies', contact: 'Tamil Selvan', email: 'tamilselvan@vvnisupplies.lk', phone: '0242345678', city: 'Vavuniya', group: 'WHOLE', credit: 150000 },
    { code: 'C019', name: 'Kandy Royal Hotel', contact: 'Dilshan Rajapaksa', email: 'dilshan@kandyroyal.lk', phone: '0812367890', city: 'Kandy', group: 'CORP', credit: 500000 },
    { code: 'C020', name: 'Galle Fashion Boutique', contact: 'Sandya Perera', email: 'sandya@gallefashion.lk', phone: '0912367890', city: 'Galle', group: 'RETAIL', credit: 0 },
    { code: 'C021', name: 'Ministry of Education', contact: 'R.M. Jayasuriya', email: 'procurement@moe.gov.lk', phone: '0112785600', city: 'Colombo', group: 'GOVT', credit: 5000000 },
    { code: 'C022', name: 'Ceylon Electricity Board', contact: 'Eng. Susantha Kumara', email: 'supplies@ceb.lk', phone: '0112447000', city: 'Colombo', group: 'GOVT', credit: 5000000 },
    { code: 'C023', name: 'Softlogic Holdings PLC', contact: 'Arjuna Herath', email: 'arjuna@softlogic.lk', phone: '0116100000', city: 'Colombo', group: 'CORP', credit: 3000000 },
    { code: 'C024', name: 'Cargills Food City Colombo', contact: 'Manel Fernando', email: 'manel@cargills.lk', phone: '0112392000', city: 'Colombo', group: 'CORP', credit: 2500000 },
    { code: 'C025', name: 'Keells Super Kandy Branch', contact: 'Thusitha Abeywickrama', email: 'thusitha@keells.lk', phone: '0812345000', city: 'Kandy', group: 'CORP', credit: 2000000 },
    { code: 'C026', name: 'Walk-In Customer', contact: '', email: '', phone: '', city: 'Colombo', group: 'RETAIL', credit: 0 },
    { code: 'C027', name: 'Gamini Supermart', contact: 'Gamini Weerasinghe', email: 'gamini@gaminisupermart.lk', phone: '0114567891', city: 'Colombo', group: 'RETAIL', credit: 50000 },
    { code: 'C028', name: 'Perera & Sons Trading Co', contact: 'Nihal Perera', email: 'nihal@pererasonstrade.lk', phone: '0114678902', city: 'Colombo', group: 'WHOLE', credit: 200000 },
    { code: 'C029', name: 'Silva Brothers Hardware', contact: 'Samantha Silva', email: 'samantha@silvahardware.lk', phone: '0114789013', city: 'Colombo', group: 'WHOLE', credit: 180000 },
    { code: 'C030', name: 'Jayawardena Electronics', contact: 'Charith Jayawardena', email: 'charith@jayaelec.lk', phone: '0114890124', city: 'Colombo', group: 'RETAIL', credit: 0 },
    { code: 'C031', name: 'De Silva Household Goods', contact: 'Anula De Silva', email: 'anula@desilvahg.lk', phone: '0812456789', city: 'Kandy', group: 'RETAIL', credit: 0 },
    { code: 'C032', name: 'Kandyan Spice Traders', contact: 'Bandula Rajapaksa', email: 'bandula@kandyanspice.lk', phone: '0812567890', city: 'Kandy', group: 'WHOLE', credit: 120000 },
    { code: 'C033', name: 'Central Province Distributors', contact: 'Wimala Fernando', email: 'wimala@cpdistr.lk', phone: '0812678901', city: 'Kandy', group: 'WHOLE', credit: 250000 },
    { code: 'C034', name: 'Upland Tea Estates Ltd', contact: 'Ruwan Gunawardena', email: 'ruwan@uplandtea.lk', phone: '0812789012', city: 'Kandy', group: 'CORP', credit: 1200000 },
    { code: 'C035', name: 'Royal Palace Restaurant Kandy', contact: 'Sachini Peiris', email: 'sachini@royalpalacekandy.lk', phone: '0812890123', city: 'Kandy', group: 'CORP', credit: 300000 },
    { code: 'C036', name: 'Southern Spice Exports', contact: 'Deepal Pathirana', email: 'deepal@sspiceexp.lk', phone: '0912456789', city: 'Galle', group: 'CORP', credit: 900000 },
    { code: 'C037', name: 'Coastal Coir Products', contact: 'Nalaka Siriwardena', email: 'nalaka@coastalcoir.lk', phone: '0912567890', city: 'Galle', group: 'CORP', credit: 600000 },
    { code: 'C038', name: 'South Ceylon Apparels', contact: 'Saman Karunaratne', email: 'saman@southceylonapparels.lk', phone: '0912678901', city: 'Galle', group: 'CORP', credit: 500000 },
    { code: 'C039', name: 'Galle Organic Farms', contact: 'Kanthi Ranasinghe', email: 'kanthi@galleorganicfarm.lk', phone: '0912789012', city: 'Galle', group: 'WHOLE', credit: 100000 },
    { code: 'C040', name: 'Unawatuna Beach Supplies', contact: 'Nishantha Amarasinghe', email: 'nishantha@unawatunasupplies.lk', phone: '0912890123', city: 'Galle', group: 'RETAIL', credit: 0 },
    { code: 'C041', name: 'National Water Supply Board', contact: 'Eng. Sumudu Abeykoon', email: 'sumudu@nwsdb.lk', phone: '0112444555', city: 'Colombo', group: 'GOVT', credit: 5000000 },
    { code: 'C042', name: 'Sri Lanka Railways', contact: 'W.P. Dharmasiri', email: 'wp.dharmasiri@railway.gov.lk', phone: '0112421281', city: 'Colombo', group: 'GOVT', credit: 4000000 },
    { code: 'C043', name: 'Colombo Municipal Council', contact: 'R.L. Bandara', email: 'rl.bandara@cmc.lk', phone: '0112691111', city: 'Colombo', group: 'GOVT', credit: 3000000 },
    { code: 'C044', name: 'ABC Garments (Pvt) Ltd', contact: 'Tharushi Perera', email: 'tharushi@abcgarments.lk', phone: '0113344567', city: 'Colombo', group: 'CORP', credit: 800000 },
    { code: 'C045', name: 'Lanka Tiles PLC', contact: 'Nayani Weerakoon', email: 'nayani@lankatiles.lk', phone: '0113455678', city: 'Colombo', group: 'CORP', credit: 1500000 },
    { code: 'C046', name: 'Hasalaka Agri Products', contact: 'Prasad Ranatunga', email: 'prasad@hasalakaagri.lk', phone: '0662345678', city: 'Badulla', group: 'WHOLE', credit: 80000 },
    { code: 'C047', name: 'Polonnaruwa Heritage Traders', contact: 'Rukshan Herath', email: 'rukshan@phtraders.lk', phone: '0272345678', city: 'Polonnaruwa', group: 'RETAIL', credit: 0 },
    { code: 'C048', name: 'Nuwara Eliya Hill Fresh Produce', contact: 'Samadhi Wijesuriya', email: 'samadhi@hillfresh.lk', phone: '0522345678', city: 'Badulla', group: 'WHOLE', credit: 120000 },
    { code: 'C049', name: 'Moratuwa Furniture Makers', contact: 'Ravi Jayakody', email: 'ravi@moratuwafurniture.lk', phone: '0112923456', city: 'Colombo', group: 'CORP', credit: 700000 },
    { code: 'C050', name: 'Ambalangoda Mask Craft', contact: 'Sujeewa Amarakoon', email: 'sujeewa@ambalangodomask.lk', phone: '0912923456', city: 'Galle', group: 'WHOLE', credit: 60000 },
    // 51-125 continued
    { code: 'C051', name: 'National Hospital Colombo', contact: 'Dr. Isuru Bandara', email: 'isuru.bandara@nhsl.gov.lk', phone: '0112691111', city: 'Colombo', group: 'GOVT', credit: 5000000 },
    { code: 'C052', name: 'Browns Investments Ltd', contact: 'Thilak Karunanayake', email: 'thilak@brownsinv.lk', phone: '0113566789', city: 'Colombo', group: 'CORP', credit: 2000000 },
    { code: 'C053', name: 'Aitken Spence PLC', contact: 'Harsha Amarawardena', email: 'harsha@aitkenspence.lk', phone: '0113308308', city: 'Colombo', group: 'CORP', credit: 3000000 },
    { code: 'C054', name: 'Hemas Holdings PLC', contact: 'Dilnoza Perera', email: 'dilnoza@hemas.lk', phone: '0114731731', city: 'Colombo', group: 'CORP', credit: 2500000 },
    { code: 'C055', name: 'Central Finance PLC', contact: 'Kavindu Weerasekara', email: 'kavindu@centralfinance.lk', phone: '0114700700', city: 'Kandy', group: 'CORP', credit: 1000000 },
    { code: 'C056', name: 'Kalutara Retail Hub', contact: 'Sanduni Samarasinghe', email: 'sanduni@kalutararetail.lk', phone: '0342345678', city: 'Colombo', group: 'RETAIL', credit: 0 },
    { code: 'C057', name: 'Panadura Superstore', contact: 'Ishara Liyanage', email: 'ishara@panadurasuperstore.lk', phone: '0382345678', city: 'Colombo', group: 'RETAIL', credit: 30000 },
    { code: 'C058', name: 'Kelaniya Valley Traders', contact: 'Dimuth Kumara', email: 'dimuth@kvtraders.lk', phone: '0116789012', city: 'Colombo', group: 'WHOLE', credit: 160000 },
    { code: 'C059', name: 'Dehiwala Marine Exports', contact: 'Rasika Gunasena', email: 'rasika@dehiwalamarineexp.lk', phone: '0117890123', city: 'Colombo', group: 'CORP', credit: 900000 },
    { code: 'C060', name: 'Kotte Office Supplies', contact: 'Dilan Madushanka', email: 'dilan@kotteofficesupplies.lk', phone: '0118901234', city: 'Colombo', group: 'RETAIL', credit: 0 },
    { code: 'C061', name: 'Ampara Eastern Traders', contact: 'Mohamed Farook', email: 'farook@amparatraders.lk', phone: '0632345678', city: 'Batticaloa', group: 'WHOLE', credit: 100000 },
    { code: 'C062', name: 'Puttalam Salt Industries', contact: 'Kumari Vithanage', email: 'kumari@puttulamsalt.lk', phone: '0322345678', city: 'Kurunegala', group: 'CORP', credit: 400000 },
    { code: 'C063', name: 'Chilaw Coconut Processors', contact: 'Suneth Rathnasiri', email: 'suneth@chilawcoconut.lk', phone: '0322456789', city: 'Kurunegala', group: 'CORP', credit: 500000 },
    { code: 'C064', name: 'Mannar Fisheries Co-op', contact: 'Francis Navaratnam', email: 'francis@mannarfisheries.lk', phone: '0232345678', city: 'Vavuniya', group: 'WHOLE', credit: 80000 },
    { code: 'C065', name: 'Mullaitivu Agri Trading', contact: 'Sivasamy Thilagan', email: 'thilagan@mullaitivuagri.lk', phone: '0212456789', city: 'Vavuniya', group: 'WHOLE', credit: 70000 },
    { code: 'C066', name: 'Mirissa Beach Resorts Pvt Ltd', contact: 'Chaminda Senanayake', email: 'chaminda@mirissaresorts.lk', phone: '0412456789', city: 'Matara', group: 'CORP', credit: 350000 },
    { code: 'C067', name: 'Weligama Surf Shop', contact: 'Duminda Jayasena', email: 'duminda@weligamasurf.lk', phone: '0412567890', city: 'Matara', group: 'RETAIL', credit: 0 },
    { code: 'C068', name: 'Tangalle Hotel Supplies', contact: 'Lahiru Rodrigo', email: 'lahiru@tangallehotels.lk', phone: '0472456789', city: 'Hambantota', group: 'CORP', credit: 400000 },
    { code: 'C069', name: 'Dambulla Vegetable Market', contact: 'Senarath Dissanayake', email: 'senarath@dambulaveg.lk', phone: '0662456789', city: 'Anuradhapura', group: 'WHOLE', credit: 200000 },
    { code: 'C070', name: 'Sigiriya Souvenir Shop', contact: 'Ruwani Jayasinghe', email: 'ruwani@sigiriyasouvenir.lk', phone: '0272456789', city: 'Polonnaruwa', group: 'RETAIL', credit: 0 },
    { code: 'C071', name: 'Colombo University Campus Store', contact: 'Dr. Prasanna Kumara', email: 'prasanna@uoc.lk', phone: '0112581835', city: 'Colombo', group: 'GOVT', credit: 1000000 },
    { code: 'C072', name: 'Peradeniya University Stores', contact: 'Dr. Amara Ekanayake', email: 'amara@pdn.ac.lk', phone: '0812388301', city: 'Kandy', group: 'GOVT', credit: 800000 },
    { code: 'C073', name: 'Kelani Cables PLC', contact: 'Malith Gunawardene', email: 'malith@kelanicables.lk', phone: '0115753753', city: 'Colombo', group: 'CORP', credit: 2000000 },
    { code: 'C074', name: 'Dipped Products PLC', contact: 'Vasantha Fernando', email: 'vasantha@dippedproducts.lk', phone: '0115900900', city: 'Colombo', group: 'CORP', credit: 1800000 },
    { code: 'C075', name: 'Union Chemicals Lanka PLC', contact: 'Thilini Wickramasekara', email: 'thilini@unionchemicals.lk', phone: '0113393393', city: 'Colombo', group: 'CORP', credit: 1200000 },
    { code: 'C076', name: 'Nathasha Boutique', contact: 'Nathasha Bandara', email: 'nathasha@natashaboutique.lk', phone: '0772345678', city: 'Colombo', group: 'GOLD', credit: 75000 },
    { code: 'C077', name: 'Ruwan Computers', contact: 'Ruwan Seneviratne', email: 'ruwan@ruwancomp.lk', phone: '0773456789', city: 'Kandy', group: 'GOLD', credit: 80000 },
    { code: 'C078', name: 'Chami Cosmetics', contact: 'Chamini Perera', email: 'chamini@chamicosmetics.lk', phone: '0774567890', city: 'Galle', group: 'GOLD', credit: 60000 },
    { code: 'C079', name: 'Saman Jewellers', contact: 'Saman Kularatne', email: 'saman@samanjewellers.lk', phone: '0775678901', city: 'Colombo', group: 'PLATINUM', credit: 300000 },
    { code: 'C080', name: 'Nilufar Fashion House', contact: 'Nilufar Hassan', email: 'nilufar@nilufarfashion.lk', phone: '0776789012', city: 'Colombo', group: 'PLATINUM', credit: 250000 },
    { code: 'C081', name: 'Pradeep Electronics City', contact: 'Pradeep Marasinghe', email: 'pradeep@pradeepelec.lk', phone: '0777890123', city: 'Kurunegala', group: 'WHOLE', credit: 160000 },
    { code: 'C082', name: 'Susantha Grocery Mart', contact: 'Susantha Rathnasiri', email: 'susantha@susanthagrocery.lk', phone: '0778901234', city: 'Kandy', group: 'RETAIL', credit: 0 },
    { code: 'C083', name: 'Prabha Stationery & Books', contact: 'Prabha Mudalige', email: 'prabha@prabhastat.lk', phone: '0779012345', city: 'Galle', group: 'RETAIL', credit: 0 },
    { code: 'C084', name: 'Lanka Salu Sala', contact: 'Ramani Wijetunga', email: 'ramani@lankasalusala.lk', phone: '0771234567', city: 'Colombo', group: 'WHOLE', credit: 200000 },
    { code: 'C085', name: 'Minuwangoda Textile Hub', contact: 'Anusha Ranatunge', email: 'anusha@minutextilehub.lk', phone: '0772345670', city: 'Colombo', group: 'WHOLE', credit: 180000 },
    { code: 'C086', name: 'Beruwala Gem Trading Co', contact: 'Mohamed Riyaz', email: 'riyaz@beruwalagems.lk', phone: '0342456789', city: 'Colombo', group: 'CORP', credit: 400000 },
    { code: 'C087', name: 'Piliyandala Agro Chemicals', contact: 'Gayan Jayantha', email: 'gayan@piliyandalaagro.lk', phone: '0113987654', city: 'Colombo', group: 'WHOLE', credit: 120000 },
    { code: 'C088', name: 'Maharagama Tech Park Supplies', contact: 'Isuru Bandara', email: 'isuru@mhtechpark.lk', phone: '0113876543', city: 'Colombo', group: 'CORP', credit: 600000 },
    { code: 'C089', name: 'Rathnapura Mining Supplies', contact: 'Chamara Jayalath', email: 'chamara@ratnapuramining.lk', phone: '0452456789', city: 'Ratnapura', group: 'CORP', credit: 700000 },
    { code: 'C090', name: 'Embilipitiya Agri Traders', contact: 'Namal Rajapaksa', email: 'namal@embilipitiyaagri.lk', phone: '0472567890', city: 'Hambantota', group: 'WHOLE', credit: 90000 },
    { code: 'C091', name: 'Arugam Bay Surf Supplies', contact: 'Chanaka Wickramaratne', email: 'chanaka@arugambaysurf.lk', phone: '0632456789', city: 'Batticaloa', group: 'RETAIL', credit: 0 },
    { code: 'C092', name: 'Hikkaduwa Aqua Sports', contact: 'Dakshitha Fernando', email: 'dakshitha@hikkaduwaqua.lk', phone: '0912456780', city: 'Galle', group: 'RETAIL', credit: 30000 },
    { code: 'C093', name: 'Nuwara Eliya Tea Boutique', contact: 'Prasadini Ratnasiri', email: 'prasadini@neteaboutique.lk', phone: '0522456789', city: 'Badulla', group: 'RETAIL', credit: 0 },
    { code: 'C094', name: 'Ella Adventure Travel', contact: 'Namal Herath', email: 'namal@ellaadventure.lk', phone: '0552456789', city: 'Badulla', group: 'RETAIL', credit: 0 },
    { code: 'C095', name: 'Anuradhapura Craft Village', contact: 'Sandali Abeynayake', email: 'sandali@adacraftvillage.lk', phone: '0252456789', city: 'Anuradhapura', group: 'RETAIL', credit: 0 },
    { code: 'C096', name: 'Vihara Road Medical Centre', contact: 'Dr. Kumuduni Jayasekara', email: 'kumuduni@viharamedical.lk', phone: '0113765432', city: 'Colombo', group: 'CORP', credit: 400000 },
    { code: 'C097', name: 'Mount Lavinia Sea View Hotel', contact: 'Asanka Munasinghe', email: 'asanka@mlseaview.lk', phone: '0112718234', city: 'Colombo', group: 'CORP', credit: 500000 },
    { code: 'C098', name: 'Nalanda International School', contact: 'M.P. Senanayake', email: 'mp.senanayake@nalanda.lk', phone: '0113655678', city: 'Colombo', group: 'GOVT', credit: 800000 },
    { code: 'C099', name: 'Royal Institute Colombo', contact: 'Roshini Perea', email: 'roshini@royalinstitute.lk', phone: '0113544567', city: 'Colombo', group: 'CORP', credit: 300000 },
    { code: 'C100', name: 'Lanka Filling Station Network', contact: 'Upul Bandara', email: 'upul@lankafilling.lk', phone: '0113433456', city: 'Colombo', group: 'CORP', credit: 1000000 },
    { code: 'C101', name: 'Island Fresh Bakers', contact: 'Sithara Gunathilaka', email: 'sithara@islandfreshbakers.lk', phone: '0113322345', city: 'Colombo', group: 'WHOLE', credit: 80000 },
    { code: 'C102', name: 'Lake View Supermarket Kandy', contact: 'Naveen Udugama', email: 'naveen@lakeviewkandy.lk', phone: '0812789345', city: 'Kandy', group: 'RETAIL', credit: 50000 },
    { code: 'C103', name: 'Peradeniya Garden Supplies', contact: 'Saman Heenatigala', email: 'saman@peradeniyagardens.lk', phone: '0812678234', city: 'Kandy', group: 'RETAIL', credit: 0 },
    { code: 'C104', name: 'Kandy Ice Cream Parlour', contact: 'Irosha Ekanayake', email: 'irosha@kandyicecream.lk', phone: '0812567123', city: 'Kandy', group: 'RETAIL', credit: 0 },
    { code: 'C105', name: 'Matale Spice Garden', contact: 'Kanthi Athukorala', email: 'kanthi@matalespiicegarden.lk', phone: '0662567234', city: 'Kandy', group: 'WHOLE', credit: 60000 },
    { code: 'C106', name: 'Nawalapitiya Tea Factory', contact: 'Jayantha Dunuwila', email: 'jayantha@nawalapitiyatea.lk', phone: '0542345678', city: 'Kandy', group: 'CORP', credit: 600000 },
    { code: 'C107', name: 'Hatton Tea Estates Ltd', contact: 'Richard Soyza', email: 'richard@hattontea.lk', phone: '0512345678', city: 'Badulla', group: 'CORP', credit: 800000 },
    { code: 'C108', name: 'Ambewela Farm Products', contact: 'Manori Wijayasinghe', email: 'manori@ambewelafarmer.lk', phone: '0522567890', city: 'Badulla', group: 'WHOLE', credit: 100000 },
    { code: 'C109', name: 'Galoya Agri Co-op', contact: 'S.B. Dissanayake', email: 'sb.dissanayake@galoyaagri.lk', phone: '0272567890', city: 'Polonnaruwa', group: 'WHOLE', credit: 80000 },
    { code: 'C110', name: 'Hambantota Port Duty Free', contact: 'Priyanka Jayathilaka', email: 'priyanka@hbtportdutyfree.lk', phone: '0472678901', city: 'Hambantota', group: 'CORP', credit: 1500000 },
    { code: 'C111', name: 'Tissamaharama Agri Traders', contact: 'Deepika Ranasinghe', email: 'deepika@tissa amaagri.lk', phone: '0472789012', city: 'Hambantota', group: 'WHOLE', credit: 70000 },
    { code: 'C112', name: 'Tangalle Coconut Products', contact: 'Nalin Rathnasiri', email: 'nalin@tangallecoconut.lk', phone: '0472890123', city: 'Hambantota', group: 'CORP', credit: 350000 },
    { code: 'C113', name: 'Wellawaya Rice Mill', contact: 'Chandima Jayarathna', email: 'chandima@wellawayarice.lk', phone: '0552678901', city: 'Badulla', group: 'CORP', credit: 400000 },
    { code: 'C114', name: 'Bandarawela Hill Country Stores', contact: 'Kasun Ruwanpathirana', email: 'kasun@bwahillstores.lk', phone: '0572345678', city: 'Badulla', group: 'RETAIL', credit: 0 },
    { code: 'C115', name: 'Trinco Bay Resort Supplies', contact: 'Ajith Premachandra', email: 'ajith@trincobaresort.lk', phone: '0262567890', city: 'Trincomalee', group: 'CORP', credit: 300000 },
    { code: 'C116', name: 'Nilaveli Beach Hotel', contact: 'Lasanthi Senaratne', email: 'lasanthi@nilavelihotel.lk', phone: '0262678901', city: 'Trincomalee', group: 'CORP', credit: 250000 },
    { code: 'C117', name: 'Passikudah Resort & Spa', contact: 'Malaka Gunasekara', email: 'malaka@passikudahresort.lk', phone: '0652456789', city: 'Batticaloa', group: 'CORP', credit: 400000 },
    { code: 'C118', name: 'Kalmunai Business Centre', contact: 'Fawzan Rafeek', email: 'fawzan@kalmunaibiz.lk', phone: '0672345678', city: 'Batticaloa', group: 'WHOLE', credit: 100000 },
    { code: 'C119', name: 'Point Pedro Fisheries Export', contact: 'Arumugam Kanesh', email: 'kanesh@ppfisheries.lk', phone: '0212567890', city: 'Jaffna', group: 'CORP', credit: 500000 },
    { code: 'C120', name: 'Jaffna Kingdom Traders', contact: 'Sivasubramaniam Raja', email: 'raja@jaffnakingdom.lk', phone: '0212456789', city: 'Jaffna', group: 'WHOLE', credit: 180000 },
    { code: 'C121', name: 'Chavakachcheri Agri Supplies', contact: 'Thayanithi Krishnaswamy', email: 'thayanithi@chavaagri.lk', phone: '0212678901', city: 'Jaffna', group: 'WHOLE', credit: 90000 },
    { code: 'C122', name: 'Kilinochchi Cooperative', contact: 'Shanmugam Param', email: 'param@kilinochthico-op.lk', phone: '0212789012', city: 'Vavuniya', group: 'WHOLE', credit: 80000 },
    { code: 'C123', name: 'Colombo Gold Member 1', contact: 'Harsha Perera', email: 'harsha.perera@gmail.com', phone: '0711234567', city: 'Colombo', group: 'GOLD', credit: 100000 },
    { code: 'C124', name: 'Kandy Gold Member 1', contact: 'Nilusha De Mel', email: 'nilusha.demel@gmail.com', phone: '0712345678', city: 'Kandy', group: 'GOLD', credit: 80000 },
    { code: 'C125', name: 'Galle Platinum Member 1', contact: 'Ravindu Gunasekara', email: 'ravindu.g@gmail.com', phone: '0713456789', city: 'Galle', group: 'PLATINUM', credit: 350000 },
  ];

  // ─── SEED EACH TENANT ─────────────────────────────────────────────────────
  for (const tenant of tenants) {
    const tenantId = tenant.id;
    console.log(`\nSeeding tenant: ${tenant.tenant_code} (${tenantId})`);

    // Units
    const unitIds: Record<string, string> = {};
    for (const u of unitDefs) {
      const existing = await ds.query('SELECT id FROM product_units WHERE tenant_id = ? AND unit_code = ?', [tenantId, u.code]);
      if (existing.length > 0) { unitIds[u.code] = existing[0].id; continue; }
      const id = uuid();
      await ds.query('INSERT INTO product_units (id, tenant_id, unit_code, unit_name, is_active) VALUES (?,?,?,?,1)', [id, tenantId, u.code, u.name]);
      unitIds[u.code] = id;
    }
    console.log(`  ✓ ${unitDefs.length} units`);

    // Categories
    const catIds: Record<string, string> = {};
    for (const c of categoryDefs) {
      const existing = await ds.query('SELECT id FROM product_categories WHERE tenant_id = ? AND category_code = ?', [tenantId, c.code]);
      if (existing.length > 0) { catIds[c.code] = existing[0].id; continue; }
      const id = uuid();
      await ds.query('INSERT INTO product_categories (id, tenant_id, category_code, category_name, is_active) VALUES (?,?,?,?,1)', [id, tenantId, c.code, c.name]);
      catIds[c.code] = id;
    }
    console.log(`  ✓ ${categoryDefs.length} categories`);

    // Brands
    const brandIds: Record<string, string> = {};
    for (const b of brandDefs) {
      const existing = await ds.query('SELECT id FROM product_brands WHERE tenant_id = ? AND brand_code = ?', [tenantId, b.code]);
      if (existing.length > 0) { brandIds[b.code] = existing[0].id; continue; }
      const id = uuid();
      await ds.query('INSERT INTO product_brands (id, tenant_id, brand_code, brand_name, is_active) VALUES (?,?,?,?,1)', [id, tenantId, b.code, b.name]);
      brandIds[b.code] = id;
    }
    console.log(`  ✓ ${brandDefs.length} brands`);

    // Products + Stocks
    let productCount = 0;
    for (const p of productDefs) {
      const existing = await ds.query('SELECT id FROM products WHERE tenant_id = ? AND product_code = ?', [tenantId, p.code]);
      let productId: string;
      if (existing.length > 0) {
        productId = existing[0].id;
      } else {
        productId = uuid();
        await ds.query(
          `INSERT INTO products (id, tenant_id, product_code, product_name, category_id, brand_id, unit_id, product_type, cost_price, selling_price, tax_percentage, reorder_level, is_active, is_tracked)
           VALUES (?,?,?,?,?,?,?,'simple',?,?,?,?,1,1)`,
          [productId, tenantId, p.code, p.name, catIds[p.cat] ?? null, brandIds[p.brand] ?? null, unitIds[p.unit] ?? null, p.cost, p.sell, p.tax, p.reorder],
        );
        productCount++;
      }

      // Stock
      const stockExists = await ds.query('SELECT id FROM product_stocks WHERE tenant_id = ? AND product_id = ?', [tenantId, productId]);
      if (stockExists.length === 0) {
        const qtyOnHand = Math.floor(Math.random() * 200) + 20;
        await ds.query(
          'INSERT INTO product_stocks (id, tenant_id, product_id, qty_on_hand, qty_reserved, qty_on_order) VALUES (?,?,?,?,0,0)',
          [uuid(), tenantId, productId, qtyOnHand],
        );
      }
    }
    console.log(`  ✓ ${productCount} new products + stocks (${productDefs.length} total)`);

    // Client Groups
    const groupIds: Record<string, string> = {};
    for (const g of clientGroupDefs) {
      const existing = await ds.query('SELECT id FROM client_groups WHERE tenant_id = ? AND group_code = ?', [tenantId, g.code]);
      if (existing.length > 0) { groupIds[g.code] = existing[0].id; continue; }
      const id = uuid();
      await ds.query(
        'INSERT INTO client_groups (id, tenant_id, group_code, group_name, default_credit_limit, discount_percentage, is_active) VALUES (?,?,?,?,?,?,1)',
        [id, tenantId, g.code, g.name, g.creditLimit, g.discount],
      );
      groupIds[g.code] = id;
    }
    console.log(`  ✓ ${clientGroupDefs.length} client groups`);

    // Clients
    let clientCount = 0;
    for (const c of clientDefs) {
      const existing = await ds.query('SELECT id FROM clients WHERE tenant_id = ? AND client_code = ?', [tenantId, c.code]);
      if (existing.length > 0) continue;
      await ds.query(
        `INSERT INTO clients (id, tenant_id, client_code, client_name, client_group_id, contact_person, email, phone, city, country, credit_limit, current_balance, loyalty_points, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,'Sri Lanka',?,0,0,1)`,
        [uuid(), tenantId, c.code, c.name, groupIds[c.group] ?? null, c.contact, c.email, c.phone, c.city, c.credit],
      );
      clientCount++;
    }
    console.log(`  ✓ ${clientCount} new clients (${clientDefs.length} total)`);
  }

  console.log('\n✅ Data seed complete!');
  console.log(`   ${productDefs.length} products × ${tenants.length} tenants`);
  console.log(`   ${clientDefs.length} clients × ${tenants.length} tenants`);
  await ds.destroy();
}

seedData().catch(e => { console.error(e); process.exit(1); });
