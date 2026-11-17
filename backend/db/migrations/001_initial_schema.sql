CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM ('admin', 'consultant', 'company_user');
CREATE TYPE assessment_status AS ENUM ('draft', 'processing', 'completed');
CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE task_status AS ENUM ('backlog', 'in_progress', 'review', 'completed');
CREATE TYPE task_domain AS ENUM ('carbon_footprint', 'ecovadis', 'banking_esg', 'information_security', 'circular_economy');
CREATE TYPE task_executor AS ENUM ('internal', 'p4s', 'partner');

CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    nif VARCHAR(20) UNIQUE NOT NULL,
    cae VARCHAR(10) NOT NULL,
    annual_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    export_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role user_role DEFAULT 'company_user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    conducted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status assessment_status DEFAULT 'draft',
    risk_score NUMERIC(5, 2) DEFAULT 0.00,
    revenue_at_risk NUMERIC(15, 2) DEFAULT 0.00,
    raw_responses JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    domain task_domain NOT NULL,
    priority task_priority NOT NULL DEFAULT 'medium',
    status task_status NOT NULL DEFAULT 'backlog',
    executor_type task_executor DEFAULT 'p4s',
    estimated_cost NUMERIC(10, 2) DEFAULT 0.00,
    deadline DATE,
    assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tasks_company ON tasks(company_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_assessments_company ON assessments(company_id);
