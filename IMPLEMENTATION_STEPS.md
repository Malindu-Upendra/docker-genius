# DOCKER-GENIUS: Implementation Steps

**Project:** DOCKER-GENIUS – Proactive Vertical Elasticity Engine for Monolithic SaaS ERP  
**Student:** Y.A. Malindu Upendra | MS25906158 | SLIIT MSc IT  
**Supervisor:** Mr. Jagath Wickramarathne

---

## Overview

The full system consists of four major implementation layers built in this order:

1. **ERP Monolithic Application** — The simulated target application
2. **Telemetry & Monitoring Layer** — cAdvisor + data pipeline
3. **LSTM Prediction Model** — Time series forecasting engine
4. **Monolith Governor (Rule Engine + Docker API)** — The DOCKER-GENIUS control plane

> Start with the ERP system first. Everything else depends on it running inside Docker.

---

## Repository Structure

```
docker-genius/
├── erp-app/                    # Phase 1: Monolithic ERP application
│   ├── src/
│   │   ├── modules/
│   │   │   ├── products/       # Products module (Tier-3 capable)
│   │   │   ├── clients/        # Clients module
│   │   │   ├── pos/            # POS module (Tier-1 critical)
│   │   │   ├── inventory/      # GRN/GRUN module (Tier-3 heavy)
│   │   │   ├── reports/        # Reports module (Tier-3 heavy)
│   │   │   ├── invoicing/      # Invoicing module
│   │   │   └── tenants/        # Multi-tenancy management
│   │   ├── middleware/
│   │   │   └── semantic-logger.middleware.ts   # Semantic priority tagging
│   │   ├── common/
│   │   │   └── priority.enum.ts
│   │   └── main.ts
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── governor/                   # Phase 3 & 4: DOCKER-GENIUS control plane
│   ├── telemetry/
│   │   └── cadvisor_collector.py
│   ├── lstm/
│   │   ├── model.py
│   │   ├── train.py
│   │   └── predict.py
│   ├── rule_engine/
│   │   └── governor.py
│   └── docker_api/
│       └── docker_controller.py
│
├── load-tests/                 # Phase 5: Apache JMeter test plans
│   ├── control-group.jmx
│   ├── reactive-only.jmx
│   └── proactive-hybrid.jmx
│
└── analysis/                   # Phase 6: Statistical analysis scripts
    └── statistical_analysis.py
```

---

## PHASE 1: ERP Monolithic Application

> **Current focus.** Build this first and get it running stably in Docker.

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | NestJS |
| Database | MySQL 8.0 |
| ORM | TypeORM |
| Container | Docker + Docker Compose |
| Language | TypeScript |

### Step 1.1 — Project Scaffold

```bash
# Install NestJS CLI
npm i -g @nestjs/cli

# Create the monolithic ERP app
cd docker-genius/
nest new erp-app

cd erp-app
npm install @nestjs/typeorm typeorm mysql2
npm install @nestjs/config class-validator class-transformer
npm install uuid
```

### Step 1.2 — Database Schema

Create the full MySQL schema for the ERP. Core tables needed:

#### Core Tables (create in this order due to FK dependencies)

```sql
-- Tenants (multi-tenancy)
CREATE TABLE tenants (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    status TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Product Categories
CREATE TABLE product_categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    category_name VARCHAR(255) NOT NULL,
    status TINYINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Product Brands
CREATE TABLE product_brands (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    brand_name VARCHAR(255) NOT NULL,
    status TINYINT DEFAULT 1,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Product Units
CREATE TABLE product_units (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    unit_name VARCHAR(100) NOT NULL,
    short_code VARCHAR(20)
);

-- Products
CREATE TABLE products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    product_code VARCHAR(50) NOT NULL,
    barcode VARCHAR(100),
    product_name VARCHAR(255) NOT NULL,
    category_id BIGINT,
    brand_id BIGINT,
    unit_id BIGINT,
    cost_price DECIMAL(10,2) DEFAULT 0,
    selling_price DECIMAL(10,2) DEFAULT 0,
    reorder_level INT DEFAULT 0,
    tax_percentage DECIMAL(5,2) DEFAULT 0,
    description TEXT,
    image_url TEXT,
    status TINYINT DEFAULT 1,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_code (tenant_id, product_code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (category_id) REFERENCES product_categories(id),
    FOREIGN KEY (brand_id) REFERENCES product_brands(id)
);

-- Product Stock
CREATE TABLE product_stocks (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    available_qty DECIMAL(10,2) DEFAULT 0,
    reserved_qty DECIMAL(10,2) DEFAULT 0,
    damaged_qty DECIMAL(10,2) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Clients
CREATE TABLE clients (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    client_code VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    mobile VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    credit_limit DECIMAL(12,2) DEFAULT 0,
    current_balance DECIMAL(12,2) DEFAULT 0,
    loyalty_points DECIMAL(12,2) DEFAULT 0,
    status TINYINT DEFAULT 1,
    deleted_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_client (tenant_id, client_code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- Invoices
CREATE TABLE invoices (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    invoice_number VARCHAR(100) NOT NULL,
    client_id BIGINT,
    subtotal DECIMAL(12,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) DEFAULT 0,
    paid_amount DECIMAL(12,2) DEFAULT 0,
    balance DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Invoice Line Items
CREATE TABLE invoice_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    invoice_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    tax_percentage DECIMAL(5,2) DEFAULT 0,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- GRN (Goods Received Note)
CREATE TABLE grn_headers (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    grn_number VARCHAR(100) NOT NULL,
    supplier_name VARCHAR(255),
    received_date DATE,
    total_amount DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE grn_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    grn_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    received_qty DECIMAL(10,2) NOT NULL,
    cost_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (grn_id) REFERENCES grn_headers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- POS Sessions
CREATE TABLE pos_sessions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    session_code VARCHAR(100),
    cashier_name VARCHAR(255),
    opening_amount DECIMAL(12,2) DEFAULT 0,
    closing_amount DECIMAL(12,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'open',
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- POS Transactions (Tier-1 critical)
CREATE TABLE pos_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT NOT NULL,
    session_id BIGINT NOT NULL,
    transaction_code VARCHAR(100) UNIQUE NOT NULL,
    client_id BIGINT NULL,
    subtotal DECIMAL(12,2) DEFAULT 0,
    discount DECIMAL(12,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL,
    paid_amount DECIMAL(12,2) NOT NULL,
    change_amount DECIMAL(12,2) DEFAULT 0,
    payment_method VARCHAR(50),
    status VARCHAR(50) DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (session_id) REFERENCES pos_sessions(id)
);

CREATE TABLE pos_transaction_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    transaction_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- Request Semantic Log (for DOCKER-GENIUS classifier)
CREATE TABLE semantic_request_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id BIGINT,
    request_id VARCHAR(100),
    http_method VARCHAR(10),
    endpoint_path VARCHAR(500),
    priority_tier VARCHAR(20),   -- 'TIER_1', 'TIER_2', 'TIER_3'
    response_time_ms INT,
    status_code INT,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tier (priority_tier),
    INDEX idx_logged_at (logged_at)
);
```

### Step 1.3 — Priority Tier Classification

This is critical for the research. Every HTTP request must be tagged with its semantic priority.

#### Priority Rules

| Tier | Label | Endpoints | Justification |
|---|---|---|---|
| TIER_1 | Mission-Critical | `POST /pos/checkout`, `POST /pos/transactions`, `GET /pos/products/scan` | Real-time POS — SLA-bound, revenue-generating |
| TIER_2 | Standard | `GET/POST /invoices`, `GET/POST /clients`, `GET/POST /products` | Normal CRUD — important but not real-time |
| TIER_3 | Background | `POST /reports/financial/aggregate`, `POST /inventory/bulk-sync`, `GET /reports/sales/monthly` | Heavy background — can tolerate delay |

#### `priority.enum.ts`

```typescript
export enum PriorityTier {
  TIER_1 = 'TIER_1',   // Mission-critical: POS checkout
  TIER_2 = 'TIER_2',   // Standard: Invoices, clients
  TIER_3 = 'TIER_3',   // Background: Reports, bulk operations
}

export const ENDPOINT_PRIORITY_MAP: Record<string, PriorityTier> = {
  // TIER_1 – POS (latency-sensitive)
  'POST:/api/pos/checkout': PriorityTier.TIER_1,
  'POST:/api/pos/transactions': PriorityTier.TIER_1,
  'GET:/api/pos/products/scan': PriorityTier.TIER_1,
  'GET:/api/pos/sessions/active': PriorityTier.TIER_1,

  // TIER_3 – Heavy background operations
  'POST:/api/reports/financial/aggregate': PriorityTier.TIER_3,
  'GET:/api/reports/sales/monthly': PriorityTier.TIER_3,
  'POST:/api/inventory/bulk-sync': PriorityTier.TIER_3,
  'GET:/api/reports/stock/valuation': PriorityTier.TIER_3,
  'POST:/api/grn/process-bulk': PriorityTier.TIER_3,
};
```

#### `semantic-logger.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ENDPOINT_PRIORITY_MAP, PriorityTier } from '../common/priority.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SemanticRequestLog } from '../entities/semantic-request-log.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SemanticLoggerMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(SemanticRequestLog)
    private readonly logRepo: Repository<SemanticRequestLog>,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = uuidv4();
    const key = `${req.method}:${req.path}`;
    const tier = ENDPOINT_PRIORITY_MAP[key] ?? PriorityTier.TIER_2;

    // Attach to request for downstream use
    (req as any).priorityTier = tier;
    (req as any).requestId = requestId;

    res.on('finish', () => {
      const responseTimeMs = Date.now() - startTime;
      const tenantId = (req as any).tenantId ?? null;

      // Async fire-and-forget — do NOT await, must not block response
      this.logRepo.insert({
        tenantId,
        requestId,
        httpMethod: req.method,
        endpointPath: req.path,
        priorityTier: tier,
        responseTimeMs,
        statusCode: res.statusCode,
        loggedAt: new Date(),
      }).catch(() => {});
    });

    next();
  }
}
```

### Step 1.4 — ERP Modules to Implement

Build these modules in order (dependencies go top to bottom):

#### Module Build Order

```
1. Tenants Module          → Foundation for multi-tenancy
2. Products Module         → Core entity (see existing md docs)
3. Clients Module          → Customer management (see existing md docs)
4. GRN Module              → Stock receiving (Tier-3)
5. Invoicing Module        → Sales invoices
6. POS Module              → Point-of-Sale (Tier-1 critical)
7. Reports Module          → Heavy aggregation endpoints (Tier-3)
```

#### NestJS Module Generation Commands

```bash
nest g module modules/tenants
nest g module modules/products
nest g module modules/clients
nest g module modules/grn
nest g module modules/invoicing
nest g module modules/pos
nest g module modules/reports
```

### Step 1.5 — POS Module (Tier-1 — Critical)

The POS module is the most important for the research. The checkout endpoint MUST simulate real latency and be classified as TIER_1.

#### Key POS Endpoints

```typescript
// pos.controller.ts

@Post('checkout')
async checkout(@Body() dto: CheckoutDto, @Req() req) {
  // This is TIER_1 — latency sensitive
  // Should complete in < 500ms under normal conditions
  return this.posService.processCheckout(dto);
}

@Get('products/scan')
async scanProduct(@Query('barcode') barcode: string) {
  // Fast barcode lookup — TIER_1
  return this.posService.findProductByBarcode(barcode);
}
```

#### POS Checkout Service Logic

```typescript
async processCheckout(dto: CheckoutDto): Promise<CheckoutResult> {
  return this.dataSource.transaction(async (manager) => {
    // 1. Validate all products exist and have stock
    // 2. Calculate totals (subtotal, tax, discount, total)
    // 3. Deduct stock for each item
    // 4. Create pos_transaction record
    // 5. Create pos_transaction_items records
    // 6. Update client loyalty points if applicable
    // 7. Return receipt data
  });
}
```

### Step 1.6 — Reports Module (Tier-3 — Heavy Background)

These endpoints deliberately perform expensive SQL operations to simulate the "noisy neighbor" effect.

#### Heavy Endpoints to Implement

```typescript
// reports.controller.ts

@Post('financial/aggregate')
async financialAggregate(@Body() dto: FinancialAggregateDto) {
  // TIER_3 — deliberately heavy, multi-table join
  // Should consume significant CPU/RAM
  return this.reportsService.generateFinancialAggregate(dto);
}

@Get('sales/monthly')
async monthlySalesReport(@Query() query: MonthlySalesDto) {
  // TIER_3 — heavy GROUP BY across large dataset
  return this.reportsService.getMonthlySalesReport(query);
}

@Get('stock/valuation')
async stockValuation() {
  // TIER_3 — full inventory valuation join
  return this.reportsService.calculateStockValuation();
}
```

#### Heavy SQL (financial aggregate — intentionally costly)

```sql
-- This should be a complex multi-join query
SELECT
    t.tenant_code,
    p.product_name,
    pc.category_name,
    SUM(ii.quantity) AS total_sold_qty,
    SUM(ii.line_total) AS total_revenue,
    SUM(ii.quantity * p.cost_price) AS total_cogs,
    SUM(ii.line_total) - SUM(ii.quantity * p.cost_price) AS gross_profit,
    COUNT(DISTINCT i.id) AS invoice_count,
    AVG(ii.unit_price) AS avg_selling_price
FROM invoice_items ii
JOIN invoices i ON i.id = ii.invoice_id
JOIN products p ON p.id = ii.product_id
JOIN product_categories pc ON pc.id = p.category_id
JOIN tenants t ON t.id = i.tenant_id
WHERE i.created_at BETWEEN :startDate AND :endDate
GROUP BY t.tenant_code, p.id, pc.category_name
ORDER BY total_revenue DESC;
```

### Step 1.7 — Inventory Bulk Sync (Tier-3 — Heavy)

```typescript
@Post('bulk-sync')
async bulkInventorySync(@Body() dto: BulkSyncDto) {
  // TIER_3 — iterates thousands of product records
  // Simulates a real ERP bulk synchronization operation
  return this.inventoryService.processBulkSync(dto);
}
```

```typescript
// inventory.service.ts — deliberately CPU/IO intensive
async processBulkSync(dto: BulkSyncDto): Promise<SyncResult> {
  const products = await this.productRepo.find({ where: { tenantId: dto.tenantId } });

  const results = [];
  for (const product of products) {
    // Simulate complex reconciliation logic per product
    const currentStock = await this.stockRepo.findOne({ where: { productId: product.id } });
    const syncedStock = dto.stockData.find(s => s.productCode === product.productCode);

    if (syncedStock) {
      await this.stockRepo.update(
        { productId: product.id },
        { availableQty: syncedStock.qty }
      );
      results.push({ productCode: product.productCode, synced: true });
    }
    // Intentional: no bulk update — process one-by-one to consume more resources
  }

  return { totalProcessed: results.length, results };
}
```

### Step 1.8 — Dockerize the ERP Application

#### `Dockerfile`

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

#### `docker-compose.yml`

```yaml
version: '3.8'

services:
  erp-app:
    build: .
    container_name: erp_monolith
    ports:
      - "3000:3000"
    environment:
      - DB_HOST=mysql
      - DB_PORT=3306
      - DB_USER=erp_user
      - DB_PASS=erp_pass
      - DB_NAME=erp_research
      - NODE_ENV=production
    depends_on:
      - mysql
    # Initial static resource limits (Control Group baseline)
    cpu_shares: 1024       # Default Docker cpu-shares
    mem_limit: 2g          # 2GB memory limit
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G

  mysql:
    image: mysql:8.0
    container_name: erp_mysql
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: erp_research
      MYSQL_USER: erp_user
      MYSQL_PASSWORD: erp_pass
    volumes:
      - mysql_data:/var/lib/mysql
      - ./schema.sql:/docker-entrypoint-initdb.d/schema.sql
    ports:
      - "3306:3306"

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: cadvisor
    ports:
      - "8080:8080"
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:rw
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    depends_on:
      - erp-app

volumes:
  mysql_data:
```

### Step 1.9 — Seed Data for Multi-Tenant Testing

```typescript
// seed.ts — create multiple test tenants with products and clients
async function seed() {
  const tenants = ['TENANT_001', 'TENANT_002', 'TENANT_003'];

  for (const tenantCode of tenants) {
    const tenant = await tenantRepo.save({ tenantCode, companyName: `Company ${tenantCode}` });

    // Seed 500 products per tenant (enough to make bulk sync heavy)
    for (let i = 1; i <= 500; i++) {
      await productRepo.save({
        tenantId: tenant.id,
        productCode: `PRD-${String(i).padStart(5, '0')}`,
        productName: `Product ${i}`,
        sellingPrice: Math.random() * 1000,
        costPrice: Math.random() * 500,
      });
    }

    // Seed 200 clients per tenant
    for (let i = 1; i <= 200; i++) {
      await clientRepo.save({
        tenantId: tenant.id,
        clientCode: `CLT-${String(i).padStart(4, '0')}`,
        fullName: `Client ${i}`,
        mobile: `07${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      });
    }
  }
}
```

### Step 1.10 — Verify ERP is Running

```bash
# Build and start
docker-compose up --build -d

# Check container is running
docker ps

# Test a Tier-1 endpoint (POS scan)
curl http://localhost:3000/api/pos/products/scan?barcode=PRD-00001

# Test a Tier-3 endpoint (monthly report)
curl http://localhost:3000/api/reports/sales/monthly?month=5&year=2026

# Check cAdvisor metrics
curl http://localhost:8080/metrics | grep container_cpu
```

---

## PHASE 2: Telemetry & Monitoring Layer

> Start collecting data immediately after Phase 1 is stable. You need at minimum 2 weeks of data before LSTM training.

### Step 2.1 — cAdvisor Integration

cAdvisor is already in `docker-compose.yml`. It auto-discovers the `erp_monolith` container.

Key metrics to collect (at 100ms intervals):

| Metric | cAdvisor Key |
|---|---|
| CPU Usage % | `container_cpu_usage_seconds_total` |
| RAM Usage (bytes) | `container_memory_usage_bytes` |
| RAM Limit (bytes) | `container_spec_memory_limit_bytes` |
| CPU Shares | `container_spec_cpu_shares` |
| Network I/O | `container_network_receive_bytes_total` |

### Step 2.2 — Telemetry Collector Script

```python
# governor/telemetry/cadvisor_collector.py

import requests
import time
import csv
import os
from datetime import datetime

CADVISOR_URL = "http://localhost:8080/api/v1.3/containers/docker/erp_monolith"
POLL_INTERVAL_MS = 100  # 100ms polling
OUTPUT_CSV = "data/telemetry_raw.csv"

def collect():
    os.makedirs("data", exist_ok=True)

    with open(OUTPUT_CSV, 'a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['timestamp', 'cpu_usage_pct', 'ram_usage_bytes',
                         'ram_limit_bytes', 'ram_usage_pct'])

        while True:
            try:
                resp = requests.get(CADVISOR_URL, timeout=1)
                data = resp.json()
                stats = data['stats'][-1]  # Latest snapshot

                cpu_usage = stats['cpu']['usage']['total']
                ram_usage = stats['memory']['usage']
                ram_limit = data['spec']['memory']['limit']
                ram_pct = (ram_usage / ram_limit) * 100 if ram_limit > 0 else 0

                row = [
                    datetime.utcnow().isoformat(),
                    round(cpu_usage / 1e9, 4),  # nanoseconds → seconds
                    ram_usage,
                    ram_limit,
                    round(ram_pct, 2),
                ]
                writer.writerow(row)
                f.flush()

            except Exception as e:
                pass  # Silent fail — do not block collection loop

            time.sleep(POLL_INTERVAL_MS / 1000)

if __name__ == "__main__":
    collect()
```

### Step 2.3 — Pre-Experiment Observation Period

Run the collector for **at least 2 weeks** under normal workload to build LSTM training data.

```bash
python governor/telemetry/cadvisor_collector.py &
```

Ensure you collect data during:
- Morning login surges (daily pattern)
- Midday POS peak hours
- End-of-month report runs
- Overnight bulk sync operations

---

## PHASE 3: LSTM Time Series Model

### Step 3.1 — Environment Setup

```bash
cd governor/
python3 -m venv venv
source venv/bin/activate

pip install tensorflow==2.15.0
pip install scikit-learn pandas numpy matplotlib
pip install docker   # Docker Python SDK for Phase 4
```

### Step 3.2 — Data Preprocessing

```python
# governor/lstm/preprocess.py

import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler

WINDOW_SIZE = 18000      # 30 minutes at 100ms = 18,000 samples
FORECAST_HORIZON = 3000  # 5 minutes ahead = 3,000 samples

def load_and_preprocess(csv_path: str):
    df = pd.read_csv(csv_path, parse_dates=['timestamp'])
    df = df.sort_values('timestamp')

    # Features: cpu_usage_pct + ram_usage_pct
    features = df[['cpu_usage_pct', 'ram_usage_pct']].values

    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(features)

    X, y = [], []
    for i in range(WINDOW_SIZE, len(scaled) - FORECAST_HORIZON):
        X.append(scaled[i - WINDOW_SIZE:i])
        y.append(scaled[i + FORECAST_HORIZON])   # Predict state at +5min

    return np.array(X), np.array(y), scaler
```

### Step 3.3 — LSTM Model Architecture

```python
# governor/lstm/model.py

from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, BatchNormalization

def build_model(window_size: int, n_features: int, forecast_outputs: int):
    model = Sequential([
        LSTM(128, return_sequences=True, input_shape=(window_size, n_features)),
        Dropout(0.2),
        BatchNormalization(),
        LSTM(64, return_sequences=False),
        Dropout(0.2),
        Dense(32, activation='relu'),
        Dense(forecast_outputs),  # Output: [cpu_pct, ram_pct] at +5min
    ])

    model.compile(optimizer='adam', loss='mse', metrics=['mae'])
    return model
```

### Step 3.4 — Training Pipeline

```python
# governor/lstm/train.py

from preprocess import load_and_preprocess
from model import build_model
import numpy as np
import pickle

X, y, scaler = load_and_preprocess('../data/telemetry_raw.csv')

# 70/15/15 split
n = len(X)
X_train, y_train = X[:int(n*0.7)], y[:int(n*0.7)]
X_val, y_val = X[int(n*0.7):int(n*0.85)], y[int(n*0.7):int(n*0.85)]
X_test, y_test = X[int(n*0.85):], y[int(n*0.85):]

model = build_model(window_size=18000, n_features=2, forecast_outputs=2)

history = model.fit(
    X_train, y_train,
    validation_data=(X_val, y_val),
    epochs=50,
    batch_size=32,
    callbacks=[
        tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),
        tf.keras.callbacks.ModelCheckpoint('models/lstm_best.h5', save_best_only=True),
    ]
)

# Evaluate on test set
from sklearn.metrics import mean_absolute_error, mean_squared_error
preds = model.predict(X_test)
mae = mean_absolute_error(y_test, preds)
rmse = np.sqrt(mean_squared_error(y_test, preds))
print(f"MAE: {mae:.4f} | RMSE: {rmse:.4f}")

# Save scaler
with open('models/scaler.pkl', 'wb') as f:
    pickle.dump(scaler, f)
```

---

## PHASE 4: Rule Engine & Docker API Integration

### Step 4.1 — Docker Controller

```python
# governor/docker_api/docker_controller.py

import docker

client = docker.from_env()
CONTAINER_NAME = "erp_monolith"

def update_container_resources(cpu_shares: int, mem_limit_bytes: int):
    container = client.containers.get(CONTAINER_NAME)
    container.update(
        cpu_shares=cpu_shares,
        mem_limit=mem_limit_bytes,
    )
    print(f"[DockerCtrl] Updated: cpu_shares={cpu_shares}, mem_limit={mem_limit_bytes // (1024**3)}GB")
```

### Step 4.2 — Governance Rules

The four rules from the proposal, implemented exactly:

```python
# governor/rule_engine/governor.py

# Resource tiers (bytes)
MEM_UPPER_BOUNDARY = 4 * 1024**3   # 4GB
MEM_BASELINE       = 2 * 1024**3   # 2GB baseline

class GovernanceRule:
    RULE_1_CPU_THRESHOLD = 80.0   # Predicted CPU % triggers pre-emption
    RULE_3_CPU_REACTIVE  = 85.0   # Actual CPU % triggers reactive fallback
    RULE_4_CPU_SAFE      = 50.0   # Predicted CPU — safe to restore

class MonolithGovernor:
    def evaluate(self, predicted_cpu: float, current_cpu: float, has_tier1_requests: bool):
        """
        Rule 1: Predicted CPU > 80% AND Tier-1 active → escalate max
        Rule 2: Predicted CPU > 80% AND no Tier-1     → moderate pre-caution
        Rule 3: Current CPU > 85% (no prediction)     → reactive escalate
        Rule 4: Predicted CPU < 50% AND current < 60% → restore baseline
        """
        if predicted_cpu > GovernanceRule.RULE_1_CPU_THRESHOLD and has_tier1_requests:
            # Rule 1 — Maximum escalation
            update_container_resources(cpu_shares=2048, mem_limit_bytes=MEM_UPPER_BOUNDARY)
            return "RULE_1_FIRED"

        elif predicted_cpu > GovernanceRule.RULE_1_CPU_THRESHOLD and not has_tier1_requests:
            # Rule 2 — Moderate precaution
            update_container_resources(cpu_shares=1536, mem_limit_bytes=MEM_BASELINE)
            return "RULE_2_FIRED"

        elif current_cpu > GovernanceRule.RULE_3_CPU_REACTIVE:
            # Rule 3 — Reactive fallback (anomalous spike)
            update_container_resources(cpu_shares=2048, mem_limit_bytes=MEM_UPPER_BOUNDARY)
            return "RULE_3_FIRED"

        elif predicted_cpu < GovernanceRule.RULE_4_CPU_SAFE and current_cpu < 60.0 and not has_tier1_requests:
            # Rule 4 — Restore baseline
            update_container_resources(cpu_shares=1024, mem_limit_bytes=MEM_BASELINE)
            return "RULE_4_FIRED"

        return "NO_ACTION"
```

### Step 4.3 — Main Governor Loop

```python
# governor/rule_engine/main.py

import time
from cadvisor_collector import get_current_metrics
from predict import get_forecast
from semantic_reader import get_priority_queue_state
from governor import MonolithGovernor

governor = MonolithGovernor()
DECISION_INTERVAL_S = 30  # Evaluate every 30 seconds

while True:
    current_cpu, current_ram = get_current_metrics()
    predicted_cpu, predicted_ram = get_forecast()
    has_tier1_requests = get_priority_queue_state()

    action = governor.evaluate(predicted_cpu, current_cpu, has_tier1_requests)
    print(f"[Governor] Action: {action} | Predicted CPU: {predicted_cpu:.1f}% | Current CPU: {current_cpu:.1f}%")

    time.sleep(DECISION_INTERVAL_S)
```

---

## PHASE 5: Load Testing with Apache JMeter

### Step 5.1 — Install JMeter

```bash
# macOS
brew install jmeter

# Or download from: https://jmeter.apache.org/download_jmeter.cgi
```

### Step 5.2 — Test Plan Structure

Each `.jmx` file should have two thread groups running concurrently:

**Thread Group 1 — Tier-1 POS Load (constant)**
- 10 concurrent threads
- Loop forever for test duration (30 minutes)
- Target: `POST http://localhost:3000/api/pos/checkout`
- Measure: Response time + error rate

**Thread Group 2 — Tier-3 Background Load (stochastic)**
- Gaussian Random Timer (mean 30s, deviation 10s)
- Target: `POST http://localhost:3000/api/reports/financial/aggregate`
- Purpose: Induce noisy neighbor contention

### Step 5.3 — Three Experimental Groups

| Group | Config | Description |
|---|---|---|
| Control | Fixed `cpu_shares=1024`, `mem_limit=2g` | Static — never adjusted |
| Reactive-Only | Rule Engine on live CPU only (no LSTM) | Reacts AFTER threshold crossed |
| Proactive Hybrid | Full DOCKER-GENIUS (LSTM + Rules) | Predicts and acts BEFORE spike |

Run each group for **30 minutes** with identical workload. Repeat **5 times** each for statistical validity.

---

## PHASE 6: Statistical Analysis

```python
# analysis/statistical_analysis.py
# Tools: scipy.stats, pandas, matplotlib

from scipy.stats import mannwhitneyu, kruskal
import pandas as pd

# Load latency results from JMeter reports
control = pd.read_csv('results/control_tier1_latency.csv')['latency_ms']
reactive = pd.read_csv('results/reactive_tier1_latency.csv')['latency_ms']
proactive = pd.read_csv('results/proactive_tier1_latency.csv')['latency_ms']

# Kruskal-Wallis across all three groups
stat, p = kruskal(control, reactive, proactive)
print(f"Kruskal-Wallis: H={stat:.3f}, p={p:.6f}")

# Pairwise Mann-Whitney U tests
u1, p1 = mannwhitneyu(control, proactive, alternative='greater')
u2, p2 = mannwhitneyu(reactive, proactive, alternative='greater')
print(f"Control vs Proactive: U={u1}, p={p1:.6f}")
print(f"Reactive vs Proactive: U={u2}, p={p2:.6f}")

# Percentile analysis
for name, data in [('Control', control), ('Reactive', reactive), ('Proactive', proactive)]:
    print(f"{name}: P95={data.quantile(0.95):.0f}ms | P99={data.quantile(0.99):.0f}ms")
```

---

## Current Status Tracker

| Phase | Component | Status |
|---|---|---|
| Phase 1 | ERP Project Scaffold | [ ] Not Started |
| Phase 1 | Database Schema | [ ] Not Started |
| Phase 1 | Semantic Logger Middleware | [ ] Not Started |
| Phase 1 | Tenants Module | [ ] Not Started |
| Phase 1 | Products Module | [ ] Not Started |
| Phase 1 | Clients Module | [ ] Not Started |
| Phase 1 | GRN Module | [ ] Not Started |
| Phase 1 | Invoicing Module | [ ] Not Started |
| Phase 1 | POS Module (Tier-1) | [ ] Not Started |
| Phase 1 | Reports Module (Tier-3) | [ ] Not Started |
| Phase 1 | Inventory Bulk Sync (Tier-3) | [ ] Not Started |
| Phase 1 | Docker Setup | [ ] Not Started |
| Phase 1 | Seed Data | [ ] Not Started |
| Phase 2 | cAdvisor Setup | [ ] Not Started |
| Phase 2 | Telemetry Collector | [ ] Not Started |
| Phase 3 | Data Preprocessing | [ ] Not Started |
| Phase 3 | LSTM Model Build | [ ] Not Started |
| Phase 3 | LSTM Training | [ ] Not Started |
| Phase 4 | Docker Controller | [ ] Not Started |
| Phase 4 | Rule Engine | [ ] Not Started |
| Phase 4 | Governor Main Loop | [ ] Not Started |
| Phase 5 | JMeter Test Plans | [ ] Not Started |
| Phase 6 | Statistical Analysis | [ ] Not Started |

---

## Key Implementation Notes

1. **The ERP must remain monolithic** — do not split into microservices. Single NestJS process, single Docker container.

2. **Multi-tenancy via tenant_id column** — not separate databases. All tenants share the same schema.

3. **Tier-3 endpoints must be genuinely heavy** — avoid optimizations. Use unoptimized queries, no caching, sequential processing. The goal is to consume CPU/RAM to trigger the noisy neighbor effect.

4. **Middleware must be async fire-and-forget** — semantic logging must NOT add latency to Tier-1 responses.

5. **cAdvisor must run on Linux host** — Docker Desktop on Mac has limitations with cgroups. Use a Linux VM or cloud instance for actual experiments.

6. **LSTM needs 2+ weeks of data** — start collecting telemetry on Day 1 of Phase 2.

7. **The Docker Update API adjusts limits without restart** — this is the core mechanism. Verify it works: `docker update --cpu-shares 2048 erp_monolith`.
