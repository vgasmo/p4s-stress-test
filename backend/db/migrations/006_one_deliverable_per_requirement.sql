-- Cada lacuna de um diagnóstico tem, no máximo, um entregável a responder-lhe. É o que
-- permite ligar a matriz de conformidade ao plano e repor um entregável eliminado sem duplicar.
--
-- A 005 já liga uma só tarefa a cada lacuna. Se mesmo assim houver duas (dados ligados à mão),
-- fica a que foi criada com o diagnóstico, ou a mais antiga, e as outras passam a tarefas
-- da P4S sem lacuna: a migração não falha a meio por causa disso.
UPDATE tasks t
SET requirement_code = NULL, origin = 'p4s'
FROM (
    SELECT t2.id,
           row_number() OVER (
               PARTITION BY t2.assessment_id, t2.requirement_code
               ORDER BY (t2.created_at = a.created_at) DESC, t2.created_at, t2.id
           ) AS position
    FROM tasks t2
    JOIN assessments a ON a.id = t2.assessment_id
    WHERE t2.requirement_code IS NOT NULL
) ranked
WHERE t.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX tasks_one_per_requirement
    ON tasks (assessment_id, requirement_code)
    WHERE requirement_code IS NOT NULL;
