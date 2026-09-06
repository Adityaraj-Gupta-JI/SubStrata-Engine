-- SubStrata Engine: Core EAV Database Schema
-- Normalization Target: BCNF (Boyce-Codd Normal Form)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants Table
CREATE TABLE tenants (
    tenant_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(100) NOT NULL UNIQUE,
    api_key_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Customers Table
CREATE TABLE customers (
    customer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    email VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_tenant_customer_email UNIQUE (tenant_id, email)
);

-- 3. Products Table (Core Entity)
CREATE TABLE products (
    product_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    sku VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    base_price NUMERIC(10, 2) NOT NULL CHECK (base_price >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT idx_tenant_product_sku UNIQUE (tenant_id, sku)
);

-- 4. Attributes Table (EAV Dynamic Attributes)
CREATE TABLE attributes (
    attribute_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    attribute_name VARCHAR(100) NOT NULL,
    data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'json')),
    CONSTRAINT idx_tenant_attribute_name UNIQUE (tenant_id, attribute_name)
);

-- 5. Product Values Table (EAV Junction)
CREATE TABLE product_values (
    product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attributes(attribute_id) ON DELETE CASCADE,
    attribute_value TEXT NOT NULL,
    PRIMARY KEY (product_id, attribute_id)
);

-- 6. Subscriptions Table
CREATE TABLE subscriptions (
    subscription_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
    billing_cycle_days INT NOT NULL DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row-Level Security (RLS) for Multi-Tenancy Enforcement
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Security Policies
CREATE POLICY tenant_isolation_customers ON customers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_products ON products
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_attributes ON attributes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY tenant_isolation_subscriptions ON subscriptions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);