-- ============================================================
-- DOCKER-GENIUS ERP Research System — backend_changes.sql
-- NestJS + MySQL 8.0 + TypeORM
-- Research Tiers:
--   TIER_1 = POS checkout, scan, session management (must be fast)
--   TIER_2 = Standard CRUD, reports, lookups
--   TIER_3 = Reports, bulk sync, GRN/GRUN approvals (deliberately heavy)
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ============================================================
-- DROP TABLES (reverse dependency order for clean reset)
-- ============================================================
DROP TABLE IF EXISTS semantic_request_logs;
DROP TABLE IF EXISTS payment_reminders;
DROP TABLE IF EXISTS payment_audit_logs;
DROP TABLE IF EXISTS bank_deposit_items;
DROP TABLE IF EXISTS bank_deposits;
DROP TABLE IF EXISTS cheques;
DROP TABLE IF EXISTS advance_credits;
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS currencies;
DROP TABLE IF EXISTS payment_terms;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS held_transactions;
DROP TABLE IF EXISTS pos_payments;
DROP TABLE IF EXISTS pos_transaction_items;
DROP TABLE IF EXISTS pos_transactions;
DROP TABLE IF EXISTS pos_sessions;
DROP TABLE IF EXISTS invoice_audit_logs;
DROP TABLE IF EXISTS credit_notes;
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS grun_audit_logs;
DROP TABLE IF EXISTS grun_items;
DROP TABLE IF EXISTS grun_headers;
DROP TABLE IF EXISTS grn_audit_logs;
DROP TABLE IF EXISTS grn_landed_costs;
DROP TABLE IF EXISTS grn_items;
DROP TABLE IF EXISTS grn_headers;
DROP TABLE IF EXISTS po_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS client_communication_history;
DROP TABLE IF EXISTS client_audit_logs;
DROP TABLE IF EXISTS client_notes;
DROP TABLE IF EXISTS client_contacts;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS client_groups;
DROP TABLE IF EXISTS stock_adjustments;
DROP TABLE IF EXISTS product_suppliers;
DROP TABLE IF EXISTS product_bundles;
DROP TABLE IF EXISTS product_audit_logs;
DROP TABLE IF EXISTS product_tag_mappings;
DROP TABLE IF EXISTS product_tags;
DROP TABLE IF EXISTS product_batch_numbers;
DROP TABLE IF EXISTS product_serials;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS product_prices;
DROP TABLE IF EXISTS product_stocks;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS product_units;
DROP TABLE IF EXISTS product_brands;
DROP TABLE IF EXISTS product_categories;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- MODULE 00: FOUNDATION — TENANTS, USERS, SETTINGS
-- ============================================================

CREATE TABLE tenants (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_code         VARCHAR(50)     NOT NULL,
    business_name       VARCHAR(255)    NOT NULL,
    business_type       VARCHAR(100)    NULL,
    address             TEXT            NULL,
    city                VARCHAR(100)    NULL,
    country             VARCHAR(100)    NULL DEFAULT 'LK',
    phone               VARCHAR(50)     NULL,
    email               VARCHAR(255)    NULL,
    logo_url            VARCHAR(500)    NULL,
    currency_code       CHAR(3)         NOT NULL DEFAULT 'LKR',
    timezone            VARCHAR(100)    NOT NULL DEFAULT 'Asia/Colombo',
    fiscal_year_start   DATE            NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '1=active, 0=inactive',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_code (tenant_code),
    KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Root tenant/organisation table';


CREATE TABLE users (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    username            VARCHAR(100)    NOT NULL,
    email               VARCHAR(255)    NOT NULL,
    password_hash       VARCHAR(255)    NOT NULL,
    full_name           VARCHAR(255)    NOT NULL,
    role                ENUM('admin','cashier','inventory_manager','accountant') NOT NULL DEFAULT 'cashier',
    phone               VARCHAR(50)     NULL,
    avatar_url          VARCHAR(500)    NULL,
    last_login_at       TIMESTAMP       NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_username (tenant_id, username),
    UNIQUE KEY uq_tenant_email (tenant_id, email),
    KEY idx_tenant_id (tenant_id),
    KEY idx_role (role),
    KEY idx_status (status),
    CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='System users per tenant';


CREATE TABLE system_settings (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NULL COMMENT 'NULL = global setting',
    setting_key         VARCHAR(200)    NOT NULL,
    setting_value       TEXT            NULL,
    data_type           ENUM('string','integer','boolean','json','decimal') NOT NULL DEFAULT 'string',
    description         VARCHAR(500)    NULL,
    is_editable         TINYINT(1)      NOT NULL DEFAULT 1,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by          BIGINT          NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_key (tenant_id, setting_key),
    KEY idx_tenant_id (tenant_id),
    KEY idx_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Global and tenant-specific configuration';


-- ============================================================
-- MODULE 01: PRODUCTS
-- ============================================================

CREATE TABLE product_categories (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    category_name       VARCHAR(255)    NOT NULL,
    category_code       VARCHAR(50)     NULL,
    parent_category_id  BIGINT          NULL,
    description         TEXT            NULL,
    image_url           VARCHAR(500)    NULL,
    sort_order          INT             NOT NULL DEFAULT 0,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_parent (parent_category_id),
    KEY idx_status (status),
    CONSTRAINT fk_pcat_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_pcat_parent FOREIGN KEY (parent_category_id) REFERENCES product_categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Hierarchical product categories';


CREATE TABLE product_brands (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    brand_name          VARCHAR(255)    NOT NULL,
    brand_code          VARCHAR(50)     NULL,
    logo_url            VARCHAR(500)    NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_status (status),
    CONSTRAINT fk_pbrand_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Product brands';


CREATE TABLE product_units (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    unit_name           VARCHAR(100)    NOT NULL,
    short_code          VARCHAR(20)     NOT NULL,
    is_fractional       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT 'Allows decimal quantities',
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_short_code (short_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Units of measure';


CREATE TABLE products (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    product_code        VARCHAR(100)    NOT NULL,
    barcode             VARCHAR(100)    NULL,
    product_name        VARCHAR(255)    NOT NULL,
    category_id         BIGINT          NULL,
    brand_id            BIGINT          NULL,
    unit_id             BIGINT          NULL,
    cost_price          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    selling_price       DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    reorder_level       DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    tax_percentage      DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
    has_variants        TINYINT(1)      NOT NULL DEFAULT 0,
    has_serial          TINYINT(1)      NOT NULL DEFAULT 0,
    has_batch           TINYINT(1)      NOT NULL DEFAULT 0,
    has_expiry          TINYINT(1)      NOT NULL DEFAULT 0,
    description         TEXT            NULL,
    image_url           VARCHAR(500)    NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    deleted_at          TIMESTAMP       NULL DEFAULT NULL,
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_product_code (tenant_id, product_code),
    KEY idx_tenant_id (tenant_id),
    KEY idx_barcode (barcode),
    KEY idx_category (category_id),
    KEY idx_brand (brand_id),
    KEY idx_unit (unit_id),
    KEY idx_status (status),
    KEY idx_deleted_at (deleted_at),
    FULLTEXT KEY ft_product_name (product_name),
    CONSTRAINT fk_product_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES product_categories (id) ON DELETE SET NULL,
    CONSTRAINT fk_product_brand FOREIGN KEY (brand_id) REFERENCES product_brands (id) ON DELETE SET NULL,
    CONSTRAINT fk_product_unit FOREIGN KEY (unit_id) REFERENCES product_units (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Master product catalogue';


CREATE TABLE product_stocks (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    variant_id          BIGINT          NULL,
    available_qty       DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    reserved_qty        DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    damaged_qty         DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_stock_product_variant (tenant_id, product_id, variant_id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_product_id (product_id),
    KEY idx_available_qty (available_qty),
    CONSTRAINT fk_stock_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_stock_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Real-time stock levels (TIER_1 read path)';


CREATE TABLE product_prices (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    product_id          BIGINT          NOT NULL,
    price_type          ENUM('retail','wholesale','dealer') NOT NULL DEFAULT 'retail',
    amount              DECIMAL(12,2)   NOT NULL,
    effective_from      DATE            NOT NULL,
    effective_to        DATE            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_product_id (product_id),
    KEY idx_price_type (price_type),
    KEY idx_effective_from (effective_from),
    CONSTRAINT fk_price_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tiered pricing history';


CREATE TABLE product_variants (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    product_id          BIGINT          NOT NULL,
    variant_name        VARCHAR(100)    NOT NULL,
    variant_value       VARCHAR(255)    NOT NULL,
    barcode             VARCHAR(100)    NULL,
    selling_price       DECIMAL(12,2)   NULL,
    cost_price          DECIMAL(12,2)   NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_product_id (product_id),
    KEY idx_barcode (barcode),
    CONSTRAINT fk_variant_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Product variants (size, colour, etc.)';


CREATE TABLE product_serials (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    serial_number       VARCHAR(255)    NOT NULL,
    status              ENUM('available','sold','returned') NOT NULL DEFAULT 'available',
    invoice_id          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_serial (tenant_id, serial_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_product_id (product_id),
    KEY idx_status (status),
    CONSTRAINT fk_serial_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_serial_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Serial number tracking';


CREATE TABLE product_batch_numbers (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    batch_number        VARCHAR(100)    NOT NULL,
    manufactured_date   DATE            NULL,
    expiry_date         DATE            NULL,
    received_qty        DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    remaining_qty       DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_batch (tenant_id, product_id, batch_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_product_id (product_id),
    KEY idx_expiry_date (expiry_date),
    CONSTRAINT fk_batch_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_batch_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Batch / lot tracking with expiry';


CREATE TABLE product_tags (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tag_name            VARCHAR(100)    NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_tag (tenant_id, tag_name),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_tag_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Searchable product tags';


CREATE TABLE product_tag_mappings (
    product_id          BIGINT          NOT NULL,
    tag_id              BIGINT          NOT NULL,
    PRIMARY KEY (product_id, tag_id),
    KEY idx_tag_id (tag_id),
    CONSTRAINT fk_ptm_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT fk_ptm_tag FOREIGN KEY (tag_id) REFERENCES product_tags (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Many-to-many: products ↔ tags';


CREATE TABLE product_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    product_id          BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action_type         ENUM('CREATE','UPDATE','DELETE','STOCK_ADJUST') NOT NULL,
    old_values          JSON            NULL,
    new_values          JSON            NULL,
    changed_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_product_id (product_id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_action_type (action_type),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_paudit_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT fk_paudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Immutable product change audit trail';


CREATE TABLE product_bundles (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    bundle_product_id   BIGINT          NOT NULL COMMENT 'The parent/bundle product',
    child_product_id    BIGINT          NOT NULL COMMENT 'Component product',
    quantity            DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_bundle_child (bundle_product_id, child_product_id),
    KEY idx_bundle_product (bundle_product_id),
    KEY idx_child_product (child_product_id),
    CONSTRAINT fk_bundle_parent FOREIGN KEY (bundle_product_id) REFERENCES products (id) ON DELETE CASCADE,
    CONSTRAINT fk_bundle_child FOREIGN KEY (child_product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Product bundle composition';


CREATE TABLE product_suppliers (
    id                          BIGINT          NOT NULL AUTO_INCREMENT,
    product_id                  BIGINT          NOT NULL,
    supplier_id                 BIGINT          NOT NULL,
    supplier_product_code       VARCHAR(100)    NULL,
    lead_time_days              INT             NOT NULL DEFAULT 0,
    is_preferred                TINYINT(1)      NOT NULL DEFAULT 0,
    created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_supplier (product_id, supplier_id),
    KEY idx_product_id (product_id),
    KEY idx_supplier_id (supplier_id),
    CONSTRAINT fk_ps_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Product-supplier preferred vendor list';


CREATE TABLE stock_adjustments (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    variant_id          BIGINT          NULL,
    adjustment_qty      DECIMAL(10,2)   NOT NULL,
    adjustment_type     ENUM('add','subtract') NOT NULL,
    reason              TEXT            NULL,
    reference_number    VARCHAR(100)    NULL,
    adjusted_by         BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_product_id (product_id),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_sadj_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_sadj_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Manual stock adjustment records';


-- ============================================================
-- MODULE 02: CLIENTS
-- ============================================================

CREATE TABLE client_groups (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    group_name          VARCHAR(255)    NOT NULL,
    discount_percentage DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
    price_type          ENUM('retail','wholesale','dealer') NOT NULL DEFAULT 'retail',
    credit_limit        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_cgroup_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Client pricing groups';


CREATE TABLE clients (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    client_code         VARCHAR(100)    NOT NULL,
    full_name           VARCHAR(255)    NOT NULL,
    company_name        VARCHAR(255)    NULL,
    mobile              VARCHAR(50)     NULL,
    email               VARCHAR(255)    NULL,
    nic_passport        VARCHAR(100)    NULL,
    address             TEXT            NULL,
    city                VARCHAR(100)    NULL,
    country             VARCHAR(100)    NULL DEFAULT 'LK',
    client_group_id     BIGINT          NULL,
    credit_limit        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    current_balance     DECIMAL(12,2)   NOT NULL DEFAULT 0.00 COMMENT 'Positive = owes us',
    loyalty_points      DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    sales_rep_id        BIGINT          NULL,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    deleted_at          TIMESTAMP       NULL DEFAULT NULL,
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_client_code (tenant_id, client_code),
    KEY idx_tenant_id (tenant_id),
    KEY idx_mobile (mobile),
    KEY idx_email (email),
    KEY idx_client_group (client_group_id),
    KEY idx_status (status),
    KEY idx_deleted_at (deleted_at),
    FULLTEXT KEY ft_client_name (full_name, company_name),
    CONSTRAINT fk_client_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_client_group FOREIGN KEY (client_group_id) REFERENCES client_groups (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Customer / client master';


CREATE TABLE client_contacts (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    client_id           BIGINT          NOT NULL,
    contact_name        VARCHAR(255)    NOT NULL,
    mobile              VARCHAR(50)     NULL,
    email               VARCHAR(255)    NULL,
    designation         VARCHAR(100)    NULL,
    is_primary          TINYINT(1)      NOT NULL DEFAULT 0,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_client_id (client_id),
    CONSTRAINT fk_cc_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Multiple contacts per client';


CREATE TABLE client_notes (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    client_id           BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    note_text           TEXT            NOT NULL,
    noted_by            BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_client_id (client_id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_cnote_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    CONSTRAINT fk_cnote_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE client_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    client_id           BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action_type         VARCHAR(50)     NOT NULL,
    old_values          JSON            NULL,
    new_values          JSON            NULL,
    changed_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_client_id (client_id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_caudit_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    CONSTRAINT fk_caudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE client_communication_history (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    client_id           BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    comm_type           ENUM('call','email','meeting','sms') NOT NULL,
    subject             VARCHAR(255)    NULL,
    notes               TEXT            NULL,
    comm_date           DATETIME        NOT NULL,
    logged_by           BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_client_id (client_id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_comm_date (comm_date),
    CONSTRAINT fk_ccomm_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    CONSTRAINT fk_ccomm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CRM communication log';


-- ============================================================
-- MODULE 03: SUPPLIERS + GRN
-- ============================================================

CREATE TABLE suppliers (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    supplier_code       VARCHAR(100)    NOT NULL,
    supplier_name       VARCHAR(255)    NOT NULL,
    mobile              VARCHAR(50)     NULL,
    email               VARCHAR(255)    NULL,
    address             TEXT            NULL,
    city                VARCHAR(100)    NULL,
    country             VARCHAR(100)    NULL DEFAULT 'LK',
    payment_terms       VARCHAR(50)     NULL,
    credit_limit        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    current_balance     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    status              TINYINT(1)      NOT NULL DEFAULT 1,
    deleted_at          TIMESTAMP       NULL DEFAULT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_supplier_code (tenant_id, supplier_code),
    KEY idx_tenant_id (tenant_id),
    KEY idx_status (status),
    CONSTRAINT fk_supplier_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Supplier master';


CREATE TABLE purchase_orders (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    po_number           VARCHAR(100)    NOT NULL,
    supplier_id         BIGINT          NOT NULL,
    expected_date       DATE            NULL,
    total_amount        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    notes               TEXT            NULL,
    status              ENUM('draft','submitted','partial','fulfilled','cancelled') NOT NULL DEFAULT 'draft',
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_po_number (tenant_id, po_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_supplier_id (supplier_id),
    KEY idx_status (status),
    CONSTRAINT fk_po_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Purchase order headers';


CREATE TABLE po_items (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    po_id               BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    ordered_qty         DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    received_qty        DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    unit_cost           DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    line_total          DECIMAL(12,2)   GENERATED ALWAYS AS (ordered_qty * unit_cost) STORED,
    PRIMARY KEY (id),
    KEY idx_po_id (po_id),
    KEY idx_product_id (product_id),
    CONSTRAINT fk_poi_po FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE CASCADE,
    CONSTRAINT fk_poi_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Purchase order line items';


CREATE TABLE grn_headers (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    grn_number          VARCHAR(100)    NOT NULL,
    supplier_id         BIGINT          NOT NULL,
    po_id               BIGINT          NULL,
    received_date       DATE            NOT NULL,
    reference_number    VARCHAR(100)    NULL,
    warehouse           VARCHAR(100)    NULL,
    notes               TEXT            NULL,
    subtotal            DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    landed_cost         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    total_amount        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    status              ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
    submitted_by        BIGINT          NULL,
    approved_by         BIGINT          NULL,
    submitted_at        TIMESTAMP       NULL DEFAULT NULL,
    approved_at         TIMESTAMP       NULL DEFAULT NULL,
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_grn_number (tenant_id, grn_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_supplier_id (supplier_id),
    KEY idx_po_id (po_id),
    KEY idx_status (status),
    KEY idx_received_date (received_date),
    CONSTRAINT fk_grn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_grn_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_grn_po FOREIGN KEY (po_id) REFERENCES purchase_orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Goods Receipt Note headers';


CREATE TABLE grn_items (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    grn_id              BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    batch_number        VARCHAR(100)    NULL,
    expiry_date         DATE            NULL,
    ordered_qty         DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    received_qty        DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    damaged_qty         DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    unit_cost           DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    line_total          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    discrepancy_note    TEXT            NULL,
    PRIMARY KEY (id),
    KEY idx_grn_id (grn_id),
    KEY idx_product_id (product_id),
    KEY idx_expiry_date (expiry_date),
    CONSTRAINT fk_grni_grn FOREIGN KEY (grn_id) REFERENCES grn_headers (id) ON DELETE CASCADE,
    CONSTRAINT fk_grni_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='GRN line items';


CREATE TABLE grn_landed_costs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    grn_id              BIGINT          NOT NULL,
    cost_type           ENUM('freight','insurance','customs','other') NOT NULL,
    amount              DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    notes               VARCHAR(500)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_grn_id (grn_id),
    CONSTRAINT fk_glc_grn FOREIGN KEY (grn_id) REFERENCES grn_headers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Landed cost allocations per GRN';


CREATE TABLE grn_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    grn_id              BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action              VARCHAR(100)    NOT NULL,
    performed_by        BIGINT          NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_grn_id (grn_id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_grnaudit_grn FOREIGN KEY (grn_id) REFERENCES grn_headers (id) ON DELETE CASCADE,
    CONSTRAINT fk_grnaudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='GRN audit trail';


-- ============================================================
-- MODULE 04: GRUN (Goods Return to Supplier Note)
-- ============================================================

CREATE TABLE grun_headers (
    id                      BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id               BIGINT          NOT NULL,
    grun_number             VARCHAR(100)    NOT NULL,
    grn_id                  BIGINT          NULL COMMENT 'Original GRN being reversed',
    supplier_id             BIGINT          NOT NULL,
    return_date             DATE            NOT NULL,
    notes                   TEXT            NULL,
    total_return_value      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    refund_type             ENUM('credit_note','cash_refund','replacement') NOT NULL DEFAULT 'credit_note',
    status                  ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
    submitted_by            BIGINT          NULL,
    approved_by             BIGINT          NULL,
    submitted_at            TIMESTAMP       NULL DEFAULT NULL,
    approved_at             TIMESTAMP       NULL DEFAULT NULL,
    created_by              BIGINT          NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_grun_number (tenant_id, grun_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_supplier_id (supplier_id),
    KEY idx_grn_id (grn_id),
    KEY idx_status (status),
    CONSTRAINT fk_grun_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_grun_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_grun_grn FOREIGN KEY (grn_id) REFERENCES grn_headers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Goods Return to Supplier headers';


CREATE TABLE grun_items (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    grun_id             BIGINT          NOT NULL,
    grn_item_id         BIGINT          NULL,
    product_id          BIGINT          NOT NULL,
    return_qty          DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    unit_cost           DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    line_total          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    return_reason       ENUM('damaged','wrong_item','quality_issue','excess_stock','expired','other') NOT NULL DEFAULT 'other',
    item_condition      ENUM('damaged','expired','good') NOT NULL DEFAULT 'good',
    notes               VARCHAR(500)    NULL,
    PRIMARY KEY (id),
    KEY idx_grun_id (grun_id),
    KEY idx_product_id (product_id),
    CONSTRAINT fk_gruni_grun FOREIGN KEY (grun_id) REFERENCES grun_headers (id) ON DELETE CASCADE,
    CONSTRAINT fk_gruni_grn_item FOREIGN KEY (grn_item_id) REFERENCES grn_items (id) ON DELETE SET NULL,
    CONSTRAINT fk_gruni_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='GRUN line items';


CREATE TABLE grun_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    grun_id             BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action              VARCHAR(100)    NOT NULL,
    performed_by        BIGINT          NULL,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_grun_id (grun_id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_grunaudit_grun FOREIGN KEY (grun_id) REFERENCES grun_headers (id) ON DELETE CASCADE,
    CONSTRAINT fk_grunaudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='GRUN audit trail';


-- ============================================================
-- MODULE 05: INVOICING (ADMIN + POS)
-- ============================================================

CREATE TABLE invoices (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    invoice_number      VARCHAR(100)    NOT NULL,
    client_id           BIGINT          NULL,
    invoice_date        DATE            NOT NULL,
    due_date            DATE            NULL,
    subtotal            DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    discount_type       ENUM('flat','percentage') NULL,
    discount_value      DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    discount_amount     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    tax_amount          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    grand_total         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    paid_amount         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    balance             DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    notes               TEXT            NULL,
    status              ENUM('draft','confirmed','partially_paid','paid','void') NOT NULL DEFAULT 'draft',
    voided_by           BIGINT          NULL,
    void_reason         TEXT            NULL,
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_invoice_number (tenant_id, invoice_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_client_id (client_id),
    KEY idx_invoice_date (invoice_date),
    KEY idx_due_date (due_date),
    KEY idx_status (status),
    KEY idx_balance (balance),
    CONSTRAINT fk_invoice_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_invoice_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Sales invoice headers';


CREATE TABLE invoice_items (
    id                          BIGINT          NOT NULL AUTO_INCREMENT,
    invoice_id                  BIGINT          NOT NULL,
    product_id                  BIGINT          NOT NULL,
    variant_id                  BIGINT          NULL,
    serial_number_id            BIGINT          NULL,
    description_override        VARCHAR(255)    NULL,
    quantity                    DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
    unit_price                  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    discount_type               ENUM('flat','percentage') NULL,
    discount_value              DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
    discount_amount             DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    tax_percentage              DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
    tax_amount                  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    line_total                  DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id),
    KEY idx_invoice_id (invoice_id),
    KEY idx_product_id (product_id),
    CONSTRAINT fk_invitem_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
    CONSTRAINT fk_invitem_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
    CONSTRAINT fk_invitem_variant FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL,
    CONSTRAINT fk_invitem_serial FOREIGN KEY (serial_number_id) REFERENCES product_serials (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Invoice line items';


CREATE TABLE credit_notes (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    credit_note_number  VARCHAR(100)    NOT NULL,
    invoice_id          BIGINT          NOT NULL,
    client_id           BIGINT          NOT NULL,
    amount              DECIMAL(12,2)   NOT NULL,
    reason              TEXT            NULL,
    status              ENUM('open','applied','void') NOT NULL DEFAULT 'open',
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_cn_number (tenant_id, credit_note_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_invoice_id (invoice_id),
    KEY idx_client_id (client_id),
    CONSTRAINT fk_cn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cn_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT,
    CONSTRAINT fk_cn_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Credit notes against invoices';


CREATE TABLE invoice_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    invoice_id          BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action              VARCHAR(100)    NOT NULL,
    old_values          JSON            NULL,
    new_values          JSON            NULL,
    performed_by        BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_invoice_id (invoice_id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_invaudit_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
    CONSTRAINT fk_invaudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- POS TABLES (TIER_1 — minimal joins, hot path)

CREATE TABLE pos_sessions (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    session_code        VARCHAR(100)    NOT NULL,
    cashier_id          BIGINT          NOT NULL,
    opening_amount      DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    closing_amount      DECIMAL(12,2)   NULL,
    expected_amount     DECIMAL(12,2)   NULL,
    variance            DECIMAL(12,2)   NULL,
    status              ENUM('open','closed') NOT NULL DEFAULT 'open',
    opened_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           TIMESTAMP       NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_session_code (tenant_id, session_code),
    KEY idx_tenant_id (tenant_id),
    KEY idx_cashier_id (cashier_id),
    KEY idx_status (status),
    CONSTRAINT fk_sess_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_sess_cashier FOREIGN KEY (cashier_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='POS session / drawer (TIER_1)';


CREATE TABLE pos_transactions (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    session_id          BIGINT          NOT NULL,
    transaction_code    VARCHAR(100)    NOT NULL,
    client_id           BIGINT          NULL,
    subtotal            DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    discount_amount     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    tax_amount          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    grand_total         DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    notes               TEXT            NULL,
    status              ENUM('completed','refunded','voided') NOT NULL DEFAULT 'completed',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_txn_code (tenant_id, transaction_code),
    KEY idx_tenant_id (tenant_id),
    KEY idx_session_id (session_id),
    KEY idx_client_id (client_id),
    KEY idx_status (status),
    KEY idx_created_at (created_at),
    CONSTRAINT fk_ptxn_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ptxn_session FOREIGN KEY (session_id) REFERENCES pos_sessions (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ptxn_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='POS transaction headers (TIER_1)';


CREATE TABLE pos_transaction_items (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    transaction_id      BIGINT          NOT NULL,
    product_id          BIGINT          NOT NULL,
    variant_id          BIGINT          NULL,
    serial_number_id    BIGINT          NULL,
    quantity            DECIMAL(10,2)   NOT NULL DEFAULT 1.00,
    unit_price          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    discount_amount     DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    line_total          DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    PRIMARY KEY (id),
    KEY idx_transaction_id (transaction_id),
    KEY idx_product_id (product_id),
    CONSTRAINT fk_ptxni_txn FOREIGN KEY (transaction_id) REFERENCES pos_transactions (id) ON DELETE CASCADE,
    CONSTRAINT fk_ptxni_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='POS line items (TIER_1)';


CREATE TABLE pos_payments (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    transaction_id      BIGINT          NOT NULL,
    payment_method_id   BIGINT          NOT NULL,
    amount              DECIMAL(12,2)   NOT NULL,
    reference           VARCHAR(100)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_transaction_id (transaction_id),
    KEY idx_payment_method_id (payment_method_id),
    CONSTRAINT fk_ppay_txn FOREIGN KEY (transaction_id) REFERENCES pos_transactions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='POS payment splits (TIER_1)';


CREATE TABLE held_transactions (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    session_id          BIGINT          NOT NULL,
    hold_reference      VARCHAR(100)    NOT NULL,
    cart_data           JSON            NOT NULL,
    client_id           BIGINT          NULL,
    held_by             BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_hold_ref (tenant_id, hold_reference),
    KEY idx_session_id (session_id),
    CONSTRAINT fk_held_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_held_session FOREIGN KEY (session_id) REFERENCES pos_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Parked / held POS carts (TIER_1)';


-- ============================================================
-- MODULE 06: PAYMENTS
-- ============================================================

CREATE TABLE payment_methods (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    method_name         VARCHAR(100)    NOT NULL,
    method_code         VARCHAR(50)     NOT NULL,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    requires_reference  TINYINT(1)      NOT NULL DEFAULT 0,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_method_code (tenant_id, method_code),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_pm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Payment method catalogue';


CREATE TABLE payment_terms (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    term_name           VARCHAR(100)    NOT NULL,
    days_due            INT             NOT NULL DEFAULT 0,
    description         VARCHAR(255)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_pterm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE currencies (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    currency_code       CHAR(3)         NOT NULL,
    currency_name       VARCHAR(100)    NOT NULL,
    exchange_rate       DECIMAL(15,6)   NOT NULL DEFAULT 1.000000,
    is_base             TINYINT(1)      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_currency_code (currency_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Currency exchange rates';


CREATE TABLE payments (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    payment_number      VARCHAR(100)    NOT NULL,
    client_id           BIGINT          NOT NULL,
    payment_date        DATE            NOT NULL,
    total_amount        DECIMAL(12,2)   NOT NULL,
    payment_method_id   BIGINT          NOT NULL,
    currency_id         BIGINT          NULL,
    exchange_rate       DECIMAL(15,6)   NULL,
    base_amount         DECIMAL(12,2)   NOT NULL,
    reference_number    VARCHAR(100)    NULL,
    cheque_number       VARCHAR(100)    NULL,
    bank_name           VARCHAR(255)    NULL,
    notes               TEXT            NULL,
    status              ENUM('active','voided') NOT NULL DEFAULT 'active',
    voided_by           BIGINT          NULL,
    void_reason         TEXT            NULL,
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_payment_number (tenant_id, payment_number),
    KEY idx_tenant_id (tenant_id),
    KEY idx_client_id (client_id),
    KEY idx_payment_date (payment_date),
    KEY idx_status (status),
    CONSTRAINT fk_pay_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_pay_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT,
    CONSTRAINT fk_pay_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods (id) ON DELETE RESTRICT,
    CONSTRAINT fk_pay_currency FOREIGN KEY (currency_id) REFERENCES currencies (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Client payment receipts';


CREATE TABLE invoice_payments (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    payment_id          BIGINT          NOT NULL,
    invoice_id          BIGINT          NOT NULL,
    allocated_amount    DECIMAL(12,2)   NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_payment_id (payment_id),
    KEY idx_invoice_id (invoice_id),
    CONSTRAINT fk_invpay_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE,
    CONSTRAINT fk_invpay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Payment-to-invoice allocation';


CREATE TABLE advance_credits (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    client_id           BIGINT          NOT NULL,
    payment_id          BIGINT          NOT NULL,
    original_amount     DECIMAL(12,2)   NOT NULL,
    remaining_amount    DECIMAL(12,2)   NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_tenant_id (tenant_id),
    KEY idx_client_id (client_id),
    KEY idx_payment_id (payment_id),
    CONSTRAINT fk_advcr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT fk_advcr_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE RESTRICT,
    CONSTRAINT fk_advcr_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Unallocated advance credits';


CREATE TABLE cheques (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    payment_id          BIGINT          NOT NULL,
    cheque_number       VARCHAR(100)    NOT NULL,
    bank_name           VARCHAR(255)    NOT NULL,
    branch              VARCHAR(255)    NULL,
    due_date            DATE            NOT NULL,
    amount              DECIMAL(12,2)   NOT NULL,
    status              ENUM('pending','cleared','bounced') NOT NULL DEFAULT 'pending',
    cleared_at          TIMESTAMP       NULL DEFAULT NULL,
    bounced_at          TIMESTAMP       NULL DEFAULT NULL,
    bounce_reason       TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_payment_id (payment_id),
    KEY idx_due_date (due_date),
    KEY idx_status (status),
    CONSTRAINT fk_cheque_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Cheque clearing tracker';


CREATE TABLE bank_deposits (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    tenant_id           BIGINT          NOT NULL,
    deposit_reference   VARCHAR(100)    NOT NULL,
    bank_name           VARCHAR(255)    NOT NULL,
    deposit_date        DATE            NOT NULL,
    total_amount        DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
    status              ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
    created_by          BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tenant_deposit_ref (tenant_id, deposit_reference),
    KEY idx_tenant_id (tenant_id),
    KEY idx_deposit_date (deposit_date),
    CONSTRAINT fk_bdep_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bank deposit batches';


CREATE TABLE bank_deposit_items (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    deposit_id          BIGINT          NOT NULL,
    payment_id          BIGINT          NOT NULL,
    amount              DECIMAL(12,2)   NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_deposit_id (deposit_id),
    KEY idx_payment_id (payment_id),
    CONSTRAINT fk_bditem_deposit FOREIGN KEY (deposit_id) REFERENCES bank_deposits (id) ON DELETE CASCADE,
    CONSTRAINT fk_bditem_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE payment_audit_logs (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    payment_id          BIGINT          NOT NULL,
    tenant_id           BIGINT          NOT NULL,
    action              VARCHAR(100)    NOT NULL,
    old_values          JSON            NULL,
    new_values          JSON            NULL,
    performed_by        BIGINT          NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_payment_id (payment_id),
    KEY idx_tenant_id (tenant_id),
    CONSTRAINT fk_payaudit_payment FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE,
    CONSTRAINT fk_payaudit_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE payment_reminders (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    client_id           BIGINT          NOT NULL,
    invoice_id          BIGINT          NOT NULL,
    sent_at             DATETIME        NOT NULL,
    reminder_type       ENUM('3day','7day','30day','custom') NOT NULL DEFAULT '7day',
    channel             ENUM('email','sms','whatsapp') NOT NULL DEFAULT 'email',
    notes               VARCHAR(500)    NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_client_id (client_id),
    KEY idx_invoice_id (invoice_id),
    CONSTRAINT fk_prem_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
    CONSTRAINT fk_prem_invoice FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Payment reminder history';


-- ============================================================
-- MODULE 07: SEMANTIC LOGGING (for DOCKER-GENIUS classifier)
-- ============================================================

CREATE TABLE semantic_request_logs (
    id                  VARCHAR(36)     NOT NULL,
    tenant_id           VARCHAR(36)     NULL,
    request_id          VARCHAR(36)     NOT NULL UNIQUE,
    http_method         VARCHAR(10)     NOT NULL,
    endpoint_path       VARCHAR(500)    NOT NULL,
    priority_tier       ENUM('TIER_1','TIER_2','TIER_3') NOT NULL DEFAULT 'TIER_2',
    response_time_ms    INT             NOT NULL DEFAULT 0,
    status_code         SMALLINT        NOT NULL DEFAULT 200,
    logged_at           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_tier (priority_tier),
    INDEX idx_logged_at (logged_at),
    INDEX idx_tenant (tenant_id),
    INDEX idx_endpoint (endpoint_path(100)),
    INDEX idx_response_time (response_time_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='DOCKER-GENIUS traffic classifier logs';


-- ============================================================
-- ============================================================
-- KEY QUERIES PER MODULE
-- ============================================================
-- ============================================================

-- ============================================================
-- MODULE 01 QUERIES: PRODUCTS
-- ============================================================

-- [TIER_3] Low-stock alert: products below reorder level
-- Used in daily stock alert reports and bulk re-order generation
SELECT
    p.id                            AS product_id,
    p.product_code,
    p.product_name,
    pc.category_name,
    pb.brand_name,
    pu.short_code                   AS unit,
    ps.available_qty,
    ps.reserved_qty,
    ps.damaged_qty,
    p.reorder_level,
    (ps.available_qty - ps.reserved_qty) AS net_available,
    (p.reorder_level - (ps.available_qty - ps.reserved_qty)) AS shortage_qty
FROM products p
INNER JOIN product_stocks ps
    ON ps.product_id = p.id
    AND ps.tenant_id = p.tenant_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
LEFT JOIN product_brands pb     ON pb.id = p.brand_id
LEFT JOIN product_units pu      ON pu.id = p.unit_id
WHERE
    p.tenant_id   = :tenantId
    AND p.status  = 1
    AND p.deleted_at IS NULL
    AND (ps.available_qty - ps.reserved_qty) < p.reorder_level
ORDER BY shortage_qty DESC;


-- [TIER_3] Expiry alert: batch items expiring within N days
SELECT
    p.id            AS product_id,
    p.product_code,
    p.product_name,
    pbn.batch_number,
    pbn.expiry_date,
    pbn.remaining_qty,
    DATEDIFF(pbn.expiry_date, CURDATE()) AS days_to_expiry,
    pc.category_name
FROM product_batch_numbers pbn
INNER JOIN products p   ON p.id = pbn.product_id AND p.tenant_id = pbn.tenant_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE
    pbn.tenant_id       = :tenantId
    AND pbn.remaining_qty > 0
    AND pbn.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL :daysAhead DAY)
ORDER BY pbn.expiry_date ASC;


-- [TIER_3] Stock valuation report (cost-basis)
SELECT
    pc.category_name,
    p.id            AS product_id,
    p.product_code,
    p.product_name,
    p.cost_price,
    p.selling_price,
    ps.available_qty,
    ps.damaged_qty,
    (ps.available_qty * p.cost_price)    AS stock_value_cost,
    (ps.available_qty * p.selling_price) AS stock_value_retail,
    ((ps.available_qty * p.selling_price) - (ps.available_qty * p.cost_price)) AS potential_margin
FROM products p
INNER JOIN product_stocks ps
    ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE
    p.tenant_id = :tenantId
    AND p.status = 1
    AND p.deleted_at IS NULL
ORDER BY stock_value_cost DESC;


-- [TIER_3] Stock movement history for a product over a date range
SELECT
    'GRN'               AS movement_type,
    gh.grn_number       AS reference,
    gh.received_date    AS movement_date,
    gi.received_qty     AS qty_in,
    0                   AS qty_out,
    gi.unit_cost        AS unit_cost,
    s.supplier_name     AS party_name
FROM grn_items gi
INNER JOIN grn_headers gh ON gh.id = gi.grn_id
INNER JOIN suppliers s    ON s.id = gh.supplier_id
WHERE gi.product_id = :productId AND gh.tenant_id = :tenantId AND gh.status = 'approved'
  AND gh.received_date BETWEEN :dateFrom AND :dateTo

UNION ALL

SELECT
    'INVOICE'           AS movement_type,
    inv.invoice_number  AS reference,
    inv.invoice_date    AS movement_date,
    0                   AS qty_in,
    ii.quantity         AS qty_out,
    ii.unit_price       AS unit_cost,
    COALESCE(c.full_name, 'Walk-in') AS party_name
FROM invoice_items ii
INNER JOIN invoices inv ON inv.id = ii.invoice_id
LEFT JOIN clients c     ON c.id = inv.client_id
WHERE ii.product_id = :productId AND inv.tenant_id = :tenantId AND inv.status != 'void'
  AND inv.invoice_date BETWEEN :dateFrom AND :dateTo

UNION ALL

SELECT
    CONCAT('ADJUSTMENT_', UPPER(sa.adjustment_type)) AS movement_type,
    COALESCE(sa.reference_number, 'MANUAL')           AS reference,
    DATE(sa.created_at)                               AS movement_date,
    IF(sa.adjustment_type='add', sa.adjustment_qty, 0)       AS qty_in,
    IF(sa.adjustment_type='subtract', sa.adjustment_qty, 0)  AS qty_out,
    0                                                 AS unit_cost,
    'ADJUSTMENT'                                      AS party_name
FROM stock_adjustments sa
WHERE sa.product_id = :productId AND sa.tenant_id = :tenantId
  AND DATE(sa.created_at) BETWEEN :dateFrom AND :dateTo

ORDER BY movement_date ASC;


-- ============================================================
-- MODULE 02 QUERIES: CLIENTS
-- ============================================================

-- [TIER_3] Aged receivables (buckets: current, 1-30, 31-60, 61-90, 90+)
SELECT
    c.id                AS client_id,
    c.client_code,
    c.full_name,
    c.company_name,
    c.mobile,
    SUM(CASE WHEN DATEDIFF(CURDATE(), inv.due_date) <= 0  THEN inv.balance ELSE 0 END) AS current_amt,
    SUM(CASE WHEN DATEDIFF(CURDATE(), inv.due_date) BETWEEN 1  AND 30 THEN inv.balance ELSE 0 END) AS days_1_30,
    SUM(CASE WHEN DATEDIFF(CURDATE(), inv.due_date) BETWEEN 31 AND 60 THEN inv.balance ELSE 0 END) AS days_31_60,
    SUM(CASE WHEN DATEDIFF(CURDATE(), inv.due_date) BETWEEN 61 AND 90 THEN inv.balance ELSE 0 END) AS days_61_90,
    SUM(CASE WHEN DATEDIFF(CURDATE(), inv.due_date) > 90             THEN inv.balance ELSE 0 END) AS days_over_90,
    SUM(inv.balance)    AS total_outstanding
FROM clients c
INNER JOIN invoices inv
    ON inv.client_id = c.id
    AND inv.tenant_id = c.tenant_id
    AND inv.status IN ('confirmed','partially_paid')
    AND inv.balance > 0
WHERE c.tenant_id = :tenantId
GROUP BY c.id, c.client_code, c.full_name, c.company_name, c.mobile
HAVING total_outstanding > 0
ORDER BY total_outstanding DESC;


-- [TIER_3] Outstanding balance summary per client
SELECT
    c.id            AS client_id,
    c.client_code,
    c.full_name,
    c.company_name,
    c.credit_limit,
    c.current_balance,
    c.loyalty_points,
    COUNT(inv.id)       AS open_invoice_count,
    SUM(inv.grand_total) AS total_invoiced,
    SUM(inv.paid_amount) AS total_paid,
    SUM(inv.balance)     AS total_balance,
    (c.credit_limit - SUM(inv.balance)) AS available_credit
FROM clients c
LEFT JOIN invoices inv
    ON inv.client_id = c.id
    AND inv.status IN ('confirmed','partially_paid')
WHERE c.tenant_id = :tenantId AND c.status = 1
GROUP BY c.id
ORDER BY total_balance DESC;


-- ============================================================
-- MODULE 03 QUERIES: GRN
-- ============================================================

-- [TIER_3] Bulk approve GRN and update stock (stored procedure)
DELIMITER $$
CREATE PROCEDURE sp_approve_grn (
    IN  p_grn_id        BIGINT,
    IN  p_approved_by   BIGINT,
    OUT p_result        VARCHAR(100)
)
BEGIN
    DECLARE v_tenant_id     BIGINT;
    DECLARE v_status        VARCHAR(50);
    DECLARE v_done          INT DEFAULT 0;
    DECLARE v_product_id    BIGINT;
    DECLARE v_received_qty  DECIMAL(10,2);
    DECLARE v_batch_number  VARCHAR(100);
    DECLARE v_expiry_date   DATE;
    DECLARE v_unit_cost     DECIMAL(10,2);

    DECLARE cur_items CURSOR FOR
        SELECT gi.product_id, gi.received_qty, gi.batch_number, gi.expiry_date, gi.unit_cost
        FROM grn_items gi
        WHERE gi.grn_id = p_grn_id;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_result = 'ERROR: Transaction rolled back';
    END;

    -- Validate GRN exists and is in submitted state
    SELECT tenant_id, status
    INTO v_tenant_id, v_status
    FROM grn_headers
    WHERE id = p_grn_id
    FOR UPDATE;

    IF v_status != 'submitted' THEN
        SET p_result = CONCAT('INVALID_STATUS:', v_status);
        LEAVE sp_approve_grn;
    END IF;

    START TRANSACTION;

    -- Approve header
    UPDATE grn_headers
    SET status       = 'approved',
        approved_by  = p_approved_by,
        approved_at  = NOW()
    WHERE id = p_grn_id;

    -- Process each line item
    OPEN cur_items;
    read_loop: LOOP
        FETCH cur_items INTO v_product_id, v_received_qty, v_batch_number, v_expiry_date, v_unit_cost;
        IF v_done THEN LEAVE read_loop; END IF;

        -- Upsert stock
        INSERT INTO product_stocks (tenant_id, product_id, available_qty, reserved_qty, damaged_qty)
        VALUES (v_tenant_id, v_product_id, v_received_qty, 0, 0)
        ON DUPLICATE KEY UPDATE
            available_qty = available_qty + VALUES(available_qty),
            updated_at    = NOW();

        -- Update product cost price (weighted average placeholder)
        UPDATE products
        SET cost_price = v_unit_cost
        WHERE id = v_product_id AND tenant_id = v_tenant_id;

        -- Update batch if applicable
        IF v_batch_number IS NOT NULL THEN
            INSERT INTO product_batch_numbers
                (tenant_id, product_id, batch_number, expiry_date, received_qty, remaining_qty)
            VALUES
                (v_tenant_id, v_product_id, v_batch_number, v_expiry_date, v_received_qty, v_received_qty)
            ON DUPLICATE KEY UPDATE
                received_qty  = received_qty + VALUES(received_qty),
                remaining_qty = remaining_qty + VALUES(received_qty);
        END IF;

    END LOOP;
    CLOSE cur_items;

    -- Audit log
    INSERT INTO grn_audit_logs (grn_id, tenant_id, action, performed_by, notes)
    VALUES (p_grn_id, v_tenant_id, 'APPROVED', p_approved_by, 'Stock updated via sp_approve_grn');

    COMMIT;
    SET p_result = 'OK';
END$$
DELIMITER ;


-- [TIER_3] Supplier performance report (GRN delivery vs PO)
SELECT
    s.id                    AS supplier_id,
    s.supplier_code,
    s.supplier_name,
    COUNT(DISTINCT gh.id)   AS total_grn_count,
    SUM(gi.ordered_qty)     AS total_ordered_qty,
    SUM(gi.received_qty)    AS total_received_qty,
    SUM(gi.damaged_qty)     AS total_damaged_qty,
    ROUND(100.0 * SUM(gi.received_qty) / NULLIF(SUM(gi.ordered_qty), 0), 2) AS fill_rate_pct,
    ROUND(100.0 * SUM(gi.damaged_qty) / NULLIF(SUM(gi.received_qty), 0), 2) AS damage_rate_pct,
    SUM(gh.total_amount)    AS total_purchase_value,
    AVG(DATEDIFF(gh.received_date, po.expected_date)) AS avg_days_late
FROM suppliers s
INNER JOIN grn_headers gh   ON gh.supplier_id = s.id AND gh.tenant_id = s.tenant_id AND gh.status = 'approved'
INNER JOIN grn_items gi     ON gi.grn_id = gh.id
LEFT JOIN purchase_orders po ON po.id = gh.po_id
WHERE
    s.tenant_id = :tenantId
    AND gh.received_date BETWEEN :dateFrom AND :dateTo
GROUP BY s.id, s.supplier_code, s.supplier_name
ORDER BY total_purchase_value DESC;


-- ============================================================
-- MODULE 04 QUERIES: GRUN
-- ============================================================

-- [TIER_3] GRUN approval and stock deduction (stored procedure)
DELIMITER $$
CREATE PROCEDURE sp_approve_grun (
    IN  p_grun_id       BIGINT,
    IN  p_approved_by   BIGINT,
    OUT p_result        VARCHAR(100)
)
BEGIN
    DECLARE v_tenant_id     BIGINT;
    DECLARE v_status        VARCHAR(50);
    DECLARE v_done          INT DEFAULT 0;
    DECLARE v_product_id    BIGINT;
    DECLARE v_return_qty    DECIMAL(10,2);

    DECLARE cur_items CURSOR FOR
        SELECT product_id, return_qty FROM grun_items WHERE grun_id = p_grun_id;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        SET p_result = 'ERROR: Transaction rolled back';
    END;

    SELECT tenant_id, status INTO v_tenant_id, v_status
    FROM grun_headers WHERE id = p_grun_id FOR UPDATE;

    IF v_status != 'submitted' THEN
        SET p_result = CONCAT('INVALID_STATUS:', v_status);
        LEAVE sp_approve_grun;
    END IF;

    START TRANSACTION;

    UPDATE grun_headers
    SET status      = 'approved',
        approved_by = p_approved_by,
        approved_at = NOW()
    WHERE id = p_grun_id;

    OPEN cur_items;
    read_loop: LOOP
        FETCH cur_items INTO v_product_id, v_return_qty;
        IF v_done THEN LEAVE read_loop; END IF;

        UPDATE product_stocks
        SET available_qty = GREATEST(available_qty - v_return_qty, 0),
            updated_at    = NOW()
        WHERE product_id = v_product_id AND tenant_id = v_tenant_id;

    END LOOP;
    CLOSE cur_items;

    INSERT INTO grun_audit_logs (grun_id, tenant_id, action, performed_by, notes)
    VALUES (p_grun_id, v_tenant_id, 'APPROVED', p_approved_by, 'Stock deducted via sp_approve_grun');

    COMMIT;
    SET p_result = 'OK';
END$$
DELIMITER ;


-- ============================================================
-- MODULE 05 QUERIES: INVOICING
-- ============================================================

-- [TIER_3] Invoice aging with bucket breakdown (standalone version)
SELECT
    inv.id                      AS invoice_id,
    inv.invoice_number,
    inv.invoice_date,
    inv.due_date,
    c.client_code,
    c.full_name                 AS client_name,
    c.company_name,
    inv.grand_total,
    inv.paid_amount,
    inv.balance,
    DATEDIFF(CURDATE(), inv.due_date) AS days_overdue,
    CASE
        WHEN DATEDIFF(CURDATE(), inv.due_date) <= 0  THEN 'Current'
        WHEN DATEDIFF(CURDATE(), inv.due_date) <= 30 THEN '1-30 Days'
        WHEN DATEDIFF(CURDATE(), inv.due_date) <= 60 THEN '31-60 Days'
        WHEN DATEDIFF(CURDATE(), inv.due_date) <= 90 THEN '61-90 Days'
        ELSE '90+ Days'
    END AS aging_bucket
FROM invoices inv
LEFT JOIN clients c ON c.id = inv.client_id
WHERE
    inv.tenant_id = :tenantId
    AND inv.status IN ('confirmed','partially_paid')
    AND inv.balance > 0
ORDER BY days_overdue DESC;


-- [TIER_3] POS session summary report
SELECT
    ps.id           AS session_id,
    ps.session_code,
    u.full_name     AS cashier_name,
    ps.opened_at,
    ps.closed_at,
    ps.opening_amount,
    ps.closing_amount,
    ps.expected_amount,
    ps.variance,
    COUNT(pt.id)                AS transaction_count,
    SUM(pt.grand_total)         AS total_sales,
    SUM(pt.discount_amount)     AS total_discounts,
    SUM(pt.tax_amount)          AS total_tax,
    SUM(CASE WHEN pt.status = 'refunded' THEN pt.grand_total ELSE 0 END) AS total_refunds
FROM pos_sessions ps
INNER JOIN users u ON u.id = ps.cashier_id
LEFT JOIN pos_transactions pt ON pt.session_id = ps.id
WHERE ps.tenant_id = :tenantId
  AND DATE(ps.opened_at) BETWEEN :dateFrom AND :dateTo
GROUP BY ps.id
ORDER BY ps.opened_at DESC;


-- ============================================================
-- MODULE 06 QUERIES: PAYMENTS
-- ============================================================

-- [TIER_3] Payment collection report by method
SELECT
    pm.method_name,
    pm.method_code,
    COUNT(p.id)         AS payment_count,
    SUM(p.base_amount)  AS total_collected,
    AVG(p.base_amount)  AS avg_payment,
    MIN(p.base_amount)  AS min_payment,
    MAX(p.base_amount)  AS max_payment
FROM payments p
INNER JOIN payment_methods pm ON pm.id = p.payment_method_id
WHERE
    p.tenant_id     = :tenantId
    AND p.status    = 'active'
    AND p.payment_date BETWEEN :dateFrom AND :dateTo
GROUP BY pm.id, pm.method_name, pm.method_code
ORDER BY total_collected DESC;


-- [TIER_3] Aged receivables with last payment date
SELECT
    c.id            AS client_id,
    c.client_code,
    c.full_name,
    c.company_name,
    c.mobile,
    c.credit_limit,
    COUNT(inv.id)           AS open_invoices,
    SUM(inv.balance)        AS total_outstanding,
    MIN(inv.due_date)       AS oldest_due_date,
    MAX(p.payment_date)     AS last_payment_date,
    DATEDIFF(CURDATE(), MIN(inv.due_date)) AS max_days_overdue
FROM clients c
INNER JOIN invoices inv
    ON inv.client_id = c.id
    AND inv.status IN ('confirmed','partially_paid')
    AND inv.balance > 0
LEFT JOIN invoice_payments ip ON ip.invoice_id = inv.id
LEFT JOIN payments p ON p.id = ip.payment_id AND p.status = 'active'
WHERE c.tenant_id = :tenantId
GROUP BY c.id
HAVING total_outstanding > 0
ORDER BY max_days_overdue DESC;


-- [TIER_3] Cheques due in next 7 days
SELECT
    ch.id               AS cheque_id,
    ch.cheque_number,
    ch.bank_name,
    ch.branch,
    ch.due_date,
    ch.amount,
    ch.status,
    c.full_name         AS client_name,
    c.mobile,
    p.payment_number,
    p.payment_date
FROM cheques ch
INNER JOIN payments p ON p.id = ch.payment_id
INNER JOIN clients c  ON c.id = p.client_id
WHERE
    p.tenant_id = :tenantId
    AND ch.status = 'pending'
    AND ch.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
ORDER BY ch.due_date ASC;


-- ============================================================
-- MODULE 07 QUERIES: REPORTS (TIER_3 Heavy Aggregates)
-- ============================================================

-- [TIER_3] Financial aggregate — monthly P&L style (multi-join)
SELECT
    t.business_name,
    DATE_FORMAT(inv.invoice_date, '%Y-%m')  AS month,
    COUNT(DISTINCT inv.id)                  AS invoice_count,
    SUM(inv.grand_total)                    AS gross_revenue,
    SUM(inv.discount_amount)                AS total_discounts,
    SUM(inv.tax_amount)                     AS total_tax_collected,
    SUM(inv.paid_amount)                    AS total_collected,
    SUM(inv.balance)                        AS total_outstanding,
    SUM(ii.quantity * p.cost_price)         AS total_cogs,
    SUM(inv.grand_total) - SUM(ii.quantity * p.cost_price) AS gross_profit,
    ROUND(100.0 * (SUM(inv.grand_total) - SUM(ii.quantity * p.cost_price))
          / NULLIF(SUM(inv.grand_total), 0), 2)            AS gross_margin_pct,
    COUNT(DISTINCT inv.client_id)           AS unique_customers,
    SUM(inv.grand_total) / NULLIF(COUNT(DISTINCT inv.id), 0) AS avg_invoice_value
FROM invoices inv
INNER JOIN tenants t        ON t.id = inv.tenant_id
INNER JOIN invoice_items ii ON ii.invoice_id = inv.id
INNER JOIN products p       ON p.id = ii.product_id
WHERE
    inv.tenant_id   = :tenantId
    AND inv.status  != 'void'
    AND inv.invoice_date BETWEEN :dateFrom AND :dateTo
GROUP BY t.business_name, DATE_FORMAT(inv.invoice_date, '%Y-%m')
ORDER BY month ASC;


-- [TIER_3] Monthly sales by category
SELECT
    DATE_FORMAT(inv.invoice_date, '%Y-%m')  AS month,
    pc.category_name,
    COUNT(DISTINCT inv.id)                  AS invoice_count,
    SUM(ii.quantity)                        AS units_sold,
    SUM(ii.line_total)                      AS revenue,
    SUM(ii.quantity * p.cost_price)         AS cogs,
    SUM(ii.line_total) - SUM(ii.quantity * p.cost_price) AS margin,
    ROUND(100.0 * SUM(ii.line_total) / NULLIF(
        SUM(SUM(ii.line_total)) OVER (PARTITION BY DATE_FORMAT(inv.invoice_date, '%Y-%m')),
    0), 2) AS revenue_share_pct
FROM invoices inv
INNER JOIN invoice_items ii ON ii.invoice_id = inv.id
INNER JOIN products p       ON p.id = ii.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
WHERE
    inv.tenant_id = :tenantId
    AND inv.status != 'void'
    AND inv.invoice_date BETWEEN :dateFrom AND :dateTo
GROUP BY DATE_FORMAT(inv.invoice_date, '%Y-%m'), pc.category_name
ORDER BY month ASC, revenue DESC;


-- [TIER_3] Top 20 products by revenue
SELECT
    p.id            AS product_id,
    p.product_code,
    p.product_name,
    pc.category_name,
    pb.brand_name,
    SUM(ii.quantity)            AS total_units_sold,
    SUM(ii.line_total)          AS total_revenue,
    SUM(ii.quantity * p.cost_price) AS total_cogs,
    SUM(ii.line_total) - SUM(ii.quantity * p.cost_price) AS total_profit,
    ROUND(100.0 * (SUM(ii.line_total) - SUM(ii.quantity * p.cost_price))
          / NULLIF(SUM(ii.line_total), 0), 2) AS margin_pct,
    COUNT(DISTINCT inv.client_id) AS unique_buyers
FROM invoice_items ii
INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.status != 'void'
INNER JOIN products p   ON p.id = ii.product_id
LEFT JOIN product_categories pc ON pc.id = p.category_id
LEFT JOIN product_brands pb     ON pb.id = p.brand_id
WHERE inv.tenant_id = :tenantId
  AND inv.invoice_date BETWEEN :dateFrom AND :dateTo
GROUP BY p.id, p.product_code, p.product_name, pc.category_name, pb.brand_name
ORDER BY total_revenue DESC
LIMIT 20;


-- [TIER_3] Semantic log performance summary (DOCKER-GENIUS research)
SELECT
    priority_tier,
    endpoint_path,
    COUNT(*)                            AS request_count,
    AVG(response_time_ms)               AS avg_ms,
    MAX(response_time_ms)               AS max_ms,
    MIN(response_time_ms)               AS min_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)
                                        AS p95_ms,
    SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS error_5xx_count,
    ROUND(100.0 * SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) / COUNT(*), 2) AS error_rate_pct
FROM semantic_request_logs
WHERE logged_at BETWEEN :dateFrom AND :dateTo
  AND (tenant_id = :tenantId OR :tenantId IS NULL)
GROUP BY priority_tier, endpoint_path
ORDER BY priority_tier ASC, avg_ms DESC;


-- ============================================================
-- ============================================================
-- SEED DATA
-- ============================================================
-- ============================================================

-- ============================================================
-- SEED: Tenants
-- ============================================================
INSERT INTO tenants (tenant_code, business_name, business_type, address, city, country, phone, email, currency_code, timezone, status)
VALUES
    ('TENANT_001', 'Colombo Retail Hub Pvt Ltd',  'Retail',     '45 Galle Road, Colombo 03', 'Colombo',    'LK', '+94112345678', 'admin@colomboretail.lk',  'LKR', 'Asia/Colombo', 1),
    ('TENANT_002', 'Kandy Wholesale Traders',      'Wholesale',  '12 Peradeniya Road, Kandy', 'Kandy',      'LK', '+94812345678', 'admin@kandytraders.lk',   'LKR', 'Asia/Colombo', 1),
    ('TENANT_003', 'Galle Electronics Ltd',        'Electronics','78 Matara Road, Galle',     'Galle',      'LK', '+94912345678', 'admin@galleelec.lk',       'LKR', 'Asia/Colombo', 1);


-- ============================================================
-- SEED: Admin users (1 per tenant) — passwords are bcrypt of 'Admin@1234'
-- ============================================================
INSERT INTO users (tenant_id, username, email, password_hash, full_name, role, status)
VALUES
    (1, 'admin_colombo', 'admin@colomboretail.lk',  '$2b$12$KIX9zOA1P5L5YH1z3xQ6cOc6YdF3gMJ5D2.zGsKHdN7fAlRvBm6Eq', 'Colombo Admin',  'admin', 1),
    (2, 'admin_kandy',   'admin@kandytraders.lk',   '$2b$12$KIX9zOA1P5L5YH1z3xQ6cOc6YdF3gMJ5D2.zGsKHdN7fAlRvBm6Eq', 'Kandy Admin',    'admin', 1),
    (3, 'admin_galle',   'admin@galleelec.lk',      '$2b$12$KIX9zOA1P5L5YH1z3xQ6cOc6YdF3gMJ5D2.zGsKHdN7fAlRvBm6Eq', 'Galle Admin',    'admin', 1);


-- ============================================================
-- SEED: Currencies
-- ============================================================
INSERT INTO currencies (currency_code, currency_name, exchange_rate, is_base)
VALUES
    ('LKR', 'Sri Lankan Rupee',  1.000000, 1),
    ('USD', 'US Dollar',         320.500000, 0),
    ('EUR', 'Euro',              348.750000, 0),
    ('GBP', 'British Pound',     406.250000, 0),
    ('SGD', 'Singapore Dollar',  238.000000, 0);


-- ============================================================
-- SEED: Product Units
-- ============================================================
INSERT INTO product_units (unit_name, short_code, is_fractional)
VALUES
    ('Piece',       'PCS',  0),
    ('Kilogram',    'KG',   1),
    ('Litre',       'LTR',  1),
    ('Box',         'BOX',  0),
    ('Metre',       'MTR',  1),
    ('Dozen',       'DZN',  0),
    ('Pack',        'PCK',  0),
    ('Gram',        'GRM',  1),
    ('Millilitre',  'ML',   1),
    ('Pair',        'PR',   0);


-- ============================================================
-- SEED: Product Categories (10) — per tenant 1 as sample
-- ============================================================
INSERT INTO product_categories (tenant_id, category_name, category_code, parent_category_id, status)
VALUES
    (1, 'Electronics',          'CAT-ELEC',  NULL, 1),
    (1, 'Mobile Phones',        'CAT-MOB',   1,    1),
    (1, 'Accessories',          'CAT-ACC',   1,    1),
    (1, 'Food & Beverages',     'CAT-FOOD',  NULL, 1),
    (1, 'Beverages',            'CAT-BEV',   4,    1),
    (1, 'Snacks',               'CAT-SNK',   4,    1),
    (1, 'Household',            'CAT-HH',    NULL, 1),
    (1, 'Cleaning Products',    'CAT-CLN',   7,    1),
    (1, 'Stationery',           'CAT-STAT',  NULL, 1),
    (1, 'Health & Beauty',      'CAT-HB',    NULL, 1);


-- ============================================================
-- SEED: Product Brands (5) — per tenant 1
-- ============================================================
INSERT INTO product_brands (tenant_id, brand_name, brand_code, status)
VALUES
    (1, 'Samsung',      'BRAND-SAM',  1),
    (1, 'Apple',        'BRAND-APL',  1),
    (1, 'Unilever',     'BRAND-UNI',  1),
    (1, 'Nestlé',       'BRAND-NST',  1),
    (1, 'Generic',      'BRAND-GEN',  1);


-- ============================================================
-- SEED: Payment Methods (per tenant 1 as sample)
-- ============================================================
INSERT INTO payment_methods (tenant_id, method_name, method_code, is_active, requires_reference)
VALUES
    (1, 'Cash',             'CASH',         1, 0),
    (1, 'Credit Card',      'CARD',         1, 1),
    (1, 'Bank Transfer',    'BANK_TRF',     1, 1),
    (1, 'Cheque',           'CHEQUE',       1, 1),
    (1, 'Mobile Payment',   'MOBILE_PAY',   1, 1),
    (2, 'Cash',             'CASH',         1, 0),
    (2, 'Credit Card',      'CARD',         1, 1),
    (2, 'Bank Transfer',    'BANK_TRF',     1, 1),
    (2, 'Cheque',           'CHEQUE',       1, 1),
    (3, 'Cash',             'CASH',         1, 0),
    (3, 'Credit Card',      'CARD',         1, 1),
    (3, 'Bank Transfer',    'BANK_TRF',     1, 1),
    (3, 'Cheque',           'CHEQUE',       1, 1);


-- ============================================================
-- SEED: Payment Terms
-- ============================================================
INSERT INTO payment_terms (tenant_id, term_name, days_due, description)
VALUES
    (1, 'Immediate',   0,  'Payment due on receipt'),
    (1, 'Net 7',       7,  'Payment due within 7 days'),
    (1, 'Net 15',      15, 'Payment due within 15 days'),
    (1, 'Net 30',      30, 'Payment due within 30 days'),
    (1, 'Net 60',      60, 'Payment due within 60 days'),
    (2, 'Immediate',   0,  'Payment due on receipt'),
    (2, 'Net 30',      30, 'Payment due within 30 days'),
    (3, 'Immediate',   0,  'Payment due on receipt'),
    (3, 'Net 30',      30, 'Payment due within 30 days');


-- ============================================================
-- SEED: Client Groups
-- ============================================================
INSERT INTO client_groups (tenant_id, group_name, discount_percentage, price_type)
VALUES
    (1, 'Walk-in',      0.00, 'retail'),
    (1, 'Regular',      5.00, 'retail'),
    (1, 'Wholesale',   10.00, 'wholesale'),
    (1, 'VIP Dealer',  15.00, 'dealer'),
    (2, 'Walk-in',      0.00, 'retail'),
    (2, 'Distributor', 12.00, 'wholesale'),
    (3, 'Retail',       0.00, 'retail'),
    (3, 'Corporate',    8.00, 'wholesale');


-- ============================================================
-- SEED: System Settings
-- ============================================================
INSERT INTO system_settings (tenant_id, setting_key, setting_value, data_type, description)
VALUES
    -- Global settings
    (NULL, 'app.version',                '1.0.0',        'string',  'Application version'),
    (NULL, 'app.maintenance_mode',       '0',            'boolean', 'Toggle maintenance mode'),
    (NULL, 'app.default_currency',       'LKR',          'string',  'System default currency'),
    (NULL, 'app.default_timezone',       'Asia/Colombo', 'string',  'System default timezone'),
    -- Tenant 1 settings
    (1, 'invoice.prefix',                'INV',          'string',  'Invoice number prefix'),
    (1, 'invoice.next_number',           '1001',         'integer', 'Next invoice sequential number'),
    (1, 'pos.receipt_footer',            'Thank you for shopping with us!', 'string', 'POS receipt footer text'),
    (1, 'pos.auto_print_receipt',        '1',            'boolean', 'Auto-print POS receipt after sale'),
    (1, 'stock.low_stock_alert_email',   'manager@colomboretail.lk', 'string', 'Email for low-stock alerts'),
    (1, 'tax.default_rate',              '0.00',         'decimal', 'Default tax percentage'),
    (1, 'loyalty.points_per_lkr',        '1',            'integer', '1 point per LKR spent'),
    (1, 'loyalty.points_redemption_rate','100',          'integer', '100 points = 1 LKR discount'),
    (1, 'grn.require_approval',          '1',            'boolean', 'Require manager approval for GRN'),
    (1, 'grun.require_approval',         '1',            'boolean', 'Require manager approval for GRUN'),
    -- Tenant 2 settings
    (2, 'invoice.prefix',                'KWT',          'string',  'Invoice number prefix'),
    (2, 'invoice.next_number',           '2001',         'integer', 'Next invoice sequential number'),
    (2, 'grn.require_approval',          '1',            'boolean', 'Require manager approval for GRN'),
    (2, 'tax.default_rate',              '0.00',         'decimal', 'Default tax percentage'),
    -- Tenant 3 settings
    (3, 'invoice.prefix',                'GLE',          'string',  'Invoice number prefix'),
    (3, 'invoice.next_number',           '3001',         'integer', 'Next invoice sequential number'),
    (3, 'grn.require_approval',          '1',            'boolean', 'Require manager approval for GRN'),
    (3, 'tax.default_rate',              '0.00',         'decimal', 'Default tax percentage'),
    -- DOCKER-GENIUS research settings
    (NULL, 'docker_genius.tier1_sla_ms',  '200',  'integer', 'TIER_1 SLA target in milliseconds'),
    (NULL, 'docker_genius.tier2_sla_ms',  '1000', 'integer', 'TIER_2 SLA target in milliseconds'),
    (NULL, 'docker_genius.tier3_sla_ms',  '10000','integer', 'TIER_3 SLA target in milliseconds (deliberately heavy)'),
    (NULL, 'docker_genius.log_all_tiers', '1',    'boolean', 'Log all tiers to semantic_request_logs');


-- ============================================================
-- SEED: Sample supplier (Tenant 1)
-- ============================================================
INSERT INTO suppliers (tenant_id, supplier_code, supplier_name, mobile, email, address, city, payment_terms, status)
VALUES
    (1, 'SUP-001', 'Tech Distributors Lanka',     '+94112200001', 'sales@techdist.lk',    '10 Vauxhall Street, Colombo 02', 'Colombo', 'Net 30', 1),
    (1, 'SUP-002', 'Island Food Suppliers Ltd',   '+94112200002', 'orders@islandfood.lk', '22 Grandpass Road, Colombo 14',  'Colombo', 'Net 15', 1),
    (2, 'SUP-001', 'Kandy Goods Wholesale',       '+94812200001', 'info@kandygoods.lk',   '5 Dalada Road, Kandy',           'Kandy',   'Net 30', 1);


-- ============================================================
-- SEED: Sample Walk-in client per tenant
-- ============================================================
INSERT INTO clients (tenant_id, client_code, full_name, company_name, mobile, client_group_id, credit_limit, current_balance, status)
VALUES
    (1, 'CLI-001', 'Walk-in Customer',  NULL, NULL, 1, 0.00, 0.00, 1),
    (1, 'CLI-002', 'Nimal Perera',      NULL, '+94771234567', 2, 50000.00, 0.00, 1),
    (2, 'CLI-001', 'Walk-in Customer',  NULL, NULL, 5, 0.00, 0.00, 1),
    (3, 'CLI-001', 'Walk-in Customer',  NULL, NULL, 7, 0.00, 0.00, 1);


-- ============================================================
-- SEED: Sample products (Tenant 1)
-- ============================================================
INSERT INTO products (tenant_id, product_code, barcode, product_name, category_id, brand_id, unit_id, cost_price, selling_price, reorder_level, tax_percentage, has_variants, has_serial, has_batch, has_expiry, status)
VALUES
    (1, 'PRD-001', '8901234567890', 'Samsung Galaxy A15',        2, 1, 1, 28000.00, 35000.00, 5,  0.00, 0, 1, 0, 0, 1),
    (1, 'PRD-002', '8901234567891', 'Apple iPhone 15 Case',      3, 2, 1, 800.00,   1500.00,  10, 0.00, 0, 0, 0, 0, 1),
    (1, 'PRD-003', '8901234567892', 'Nestlé Milo 200g',          6, 4, 1, 120.00,   165.00,   50, 0.00, 0, 0, 1, 1, 1),
    (1, 'PRD-004', '8901234567893', 'Sunlight Dishwash 400ml',   8, 3, 9, 95.00,    140.00,   30, 0.00, 0, 0, 1, 1, 1),
    (1, 'PRD-005', '8901234567894', 'A4 Paper Ream 500 Sheets',  9, 5, 4, 750.00,   950.00,   20, 0.00, 0, 0, 0, 0, 1);

-- Seed stock for sample products
INSERT INTO product_stocks (tenant_id, product_id, available_qty, reserved_qty, damaged_qty)
VALUES
    (1, 1, 25.00, 0.00, 0.00),
    (1, 2, 50.00, 0.00, 0.00),
    (1, 3, 200.00, 0.00, 5.00),
    (1, 4, 150.00, 0.00, 0.00),
    (1, 5, 45.00, 0.00, 0.00);


-- ============================================================
-- END OF backend_changes.sql
-- ============================================================
-- Total modules: 7
-- Total tables:  ~55
-- Stored procedures: sp_approve_grn, sp_approve_grun
-- Key queries: 15+
-- Seed records: tenants(3), users(3), currencies(5), units(10),
--               categories(10), brands(5), payment_methods(13),
--               payment_terms(9), client_groups(8), settings(24),
--               suppliers(3), clients(4), products(5), stocks(5)
-- ============================================================
