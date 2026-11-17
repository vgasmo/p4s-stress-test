-- Reforço de integridade sobre 001 e 002, sem alterar o significado de nenhuma coluna.
-- Todas as colunas tornadas NOT NULL já tinham DEFAULT, por isso nada muda para quem insere.

ALTER TABLE users
    ALTER COLUMN role SET NOT NULL,
    ALTER COLUMN is_active SET NOT NULL,
    -- Um utilizador da empresa tem de pertencer a uma empresa. Admins e consultores P4S podem não ter.
    ADD CONSTRAINT users_company_user_has_company
        CHECK (role <> 'company_user' OR company_id IS NOT NULL);

ALTER TABLE assessments
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN risk_score SET NOT NULL,
    ALTER COLUMN revenue_at_risk SET NOT NULL,
    ALTER COLUMN credit_line_to_refinance SET NOT NULL,
    ALTER COLUMN estimated_spread_penalty SET NOT NULL,
    ADD CONSTRAINT assessments_risk_score_range CHECK (risk_score BETWEEN 0 AND 100),
    ADD CONSTRAINT assessments_revenue_at_risk_non_negative CHECK (revenue_at_risk >= 0),
    ADD CONSTRAINT assessments_credit_line_non_negative CHECK (credit_line_to_refinance >= 0),
    ADD CONSTRAINT assessments_spread_penalty_non_negative CHECK (estimated_spread_penalty >= 0);

ALTER TABLE tasks
    ALTER COLUMN executor_type SET NOT NULL,
    ALTER COLUMN estimated_cost SET NOT NULL,
    ALTER COLUMN included_in_proposal SET NOT NULL,
    ADD CONSTRAINT tasks_estimated_cost_non_negative CHECK (estimated_cost >= 0);

ALTER TABLE companies
    ADD CONSTRAINT companies_annual_revenue_non_negative CHECK (annual_revenue >= 0),
    ADD CONSTRAINT companies_export_percentage_range CHECK (export_percentage BETWEEN 0 AND 100);

-- A FK tasks.assessment_id não tinha índice (cascatas e listagem por avaliação).
CREATE INDEX idx_tasks_assessment ON tasks(assessment_id);
