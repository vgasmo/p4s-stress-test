-- Análise de documentos com IA (ferramenta interna da equipa P4S).
--
-- O ficheiro NUNCA é guardado. Fica só o que identifica o documento (nome, tamanho e
-- impressão digital SHA-256), o que a IA extraiu e as citações literais que sustentam cada
-- exigência. Uma citação só conta depois de o servidor a ter encontrado no texto do documento
-- (quote_verified) e de um consultor a ter confirmado (review_status = 'confirmed').

CREATE TYPE document_analysis_status AS ENUM ('processing', 'done', 'failed');
CREATE TYPE document_finding_review AS ENUM ('pending', 'confirmed', 'rejected');
CREATE TYPE document_finding_obligation AS ENUM ('mandatory', 'recommended', 'unclear');

CREATE TABLE document_analyses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    file_kind VARCHAR(10) NOT NULL CHECK (file_kind IN ('pdf', 'docx', 'txt')),
    file_size INTEGER NOT NULL CHECK (file_size > 0),
    file_sha256 CHAR(64) NOT NULL,
    -- Só os PDF têm páginas. Nos outros formatos fica NULL.
    page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
    char_count INTEGER NOT NULL CHECK (char_count >= 0),
    status document_analysis_status NOT NULL DEFAULT 'processing',
    failure_code VARCHAR(40),
    failure_message TEXT,
    issuer VARCHAR(255),
    document_type VARCHAR(160),
    document_language VARCHAR(60),
    document_date DATE,
    summary TEXT,
    -- Modelo que respondeu de facto (pode ser o de recurso, se o pedido tiver sido recusado pelo principal).
    model VARCHAR(80),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);

CREATE INDEX idx_document_analyses_company ON document_analyses (company_id, created_at DESC);
-- O mesmo ficheiro não se analisa duas vezes para a mesma empresa (as análises falhadas não contam).
CREATE UNIQUE INDEX document_analyses_one_per_file
    ON document_analyses (company_id, file_sha256)
    WHERE status <> 'failed';

CREATE TABLE document_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_id UUID NOT NULL REFERENCES document_analyses(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    -- Requisito do stress test a que a exigência corresponde. NULL: fora dos cinco requisitos.
    requirement_code VARCHAR(40)
        CHECK (requirement_code IN ('ecovadis', 'carbon_scope_1_2', 'carbon_scope_3', 'banking_esg', 'information_security')),
    -- O que a IA propôs, para se saber quando o consultor reclassificou.
    suggested_requirement_code VARCHAR(40)
        CHECK (suggested_requirement_code IN ('ecovadis', 'carbon_scope_1_2', 'carbon_scope_3', 'banking_esg', 'information_security')),
    topic VARCHAR(200) NOT NULL,
    request TEXT NOT NULL,
    obligation document_finding_obligation NOT NULL DEFAULT 'unclear',
    deadline DATE,
    deadline_text VARCHAR(300),
    consequence TEXT,
    quote TEXT NOT NULL,
    quote_verified BOOLEAN NOT NULL,
    quote_page INTEGER CHECK (quote_page IS NULL OR quote_page > 0),
    review_status document_finding_review NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    -- Uma citação que o servidor não encontrou no documento nunca chega a evidência.
    CHECK (review_status <> 'confirmed' OR quote_verified),
    UNIQUE (analysis_id, position)
);

CREATE INDEX idx_document_findings_company ON document_findings (company_id, review_status);
