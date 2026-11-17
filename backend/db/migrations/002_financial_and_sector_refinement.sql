-- Fase 2: perfis setoriais, separação entre risco comercial e risco bancário,
-- e faseamento orçamental das tarefas.

CREATE TYPE sector_profile AS ENUM ('automotive_molds', 'agro_packaging', 'heavy_process', 'general_industrial');
CREATE TYPE task_phase AS ENUM ('phase_1_urgent', 'phase_2_structural');

-- Setor por omissão da empresa. Cada avaliação guarda o setor com que foi calculada.
ALTER TABLE companies
    ADD COLUMN sector_profile sector_profile NOT NULL DEFAULT 'general_industrial';

-- revenue_at_risk passa a significar apenas faturação comercial em risco (€).
-- O risco bancário é um sobrecusto anual e fica numa coluna própria.
ALTER TABLE assessments
    ADD COLUMN sector_profile sector_profile NOT NULL DEFAULT 'general_industrial',
    ADD COLUMN credit_line_to_refinance NUMERIC(15, 2) DEFAULT 0.00,
    ADD COLUMN estimated_spread_penalty NUMERIC(15, 2) DEFAULT 0.00;

COMMENT ON COLUMN assessments.revenue_at_risk IS 'Faturação comercial em risco (€)';
COMMENT ON COLUMN assessments.credit_line_to_refinance IS 'Crédito a renovar nos próximos 18 meses (€)';
COMMENT ON COLUMN assessments.estimated_spread_penalty IS 'Sobrecusto financeiro anual por agravamento de spread (€/ano)';

ALTER TABLE tasks
    ADD COLUMN phase task_phase NOT NULL DEFAULT 'phase_1_urgent',
    ADD COLUMN included_in_proposal BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN tasks.included_in_proposal IS 'Entregável incluído na proposta comercial (configurável em reunião)';
