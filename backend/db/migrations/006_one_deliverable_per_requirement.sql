-- Cada lacuna de um diagnóstico tem, no máximo, um entregável a responder-lhe. É o que
-- permite ligar a matriz de conformidade ao plano e repor um entregável eliminado sem duplicar.
CREATE UNIQUE INDEX tasks_one_per_requirement
    ON tasks (assessment_id, requirement_code)
    WHERE requirement_code IS NOT NULL;
