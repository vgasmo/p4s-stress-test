-- Origem das tarefas e ligação ao requisito, registo de quem criou e alterou,
-- data de emissão da proposta e unicidade do email sem distinguir maiúsculas.

CREATE TYPE task_origin AS ENUM ('assessment', 'p4s', 'company');

ALTER TABLE tasks
    -- Requisito do diagnóstico que deu origem à tarefa. NULL nas tarefas criadas à mão.
    ADD COLUMN requirement_code VARCHAR(40),
    -- Quem definiu a tarefa: o diagnóstico, a equipa P4S ou a própria empresa.
    -- O utilizador da empresa só altera os termos das tarefas que ele próprio criou.
    ADD COLUMN origin task_origin NOT NULL DEFAULT 'p4s',
    ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── Tarefas que já existiam ────────────────────────────────────────────────────────────
--
-- As tarefas geradas por um diagnóstico foram inseridas na mesma transação que ele, por isso
-- têm exatamente a mesma data de criação. É isso que as identifica, e não o título nem a
-- descrição: a versão anterior deixava editar os dois, e um entregável com o título alterado
-- ficava desligado da lacuna a que responde.

CREATE TEMP TABLE migration_catalog_titles (title TEXT PRIMARY KEY, code TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO migration_catalog_titles VALUES
    ('Preparação e Submissão do Dossier EcoVadis', 'ecovadis'),
    ('Inventário de Emissões GEE (Âmbitos 1 e 2)', 'carbon_scope_1_2'),
    ('Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)', 'carbon_scope_3'),
    ('Dossier de Sustentabilidade para Indexação de Spread Bancário', 'banking_esg'),
    ('Auditoria de Segurança da Informação e Conformidade NIS2/TISAX', 'information_security');

CREATE TEMP TABLE migration_generated_tasks ON COMMIT DROP AS
SELECT t.id, t.assessment_id, t.title, t.domain::text AS domain, t.phase::text AS phase
FROM tasks t
JOIN assessments a ON a.id = t.assessment_id
WHERE t.created_at = a.created_at;

-- Dados carregados de outra forma (sem a data de criação em comum): vale o título-tipo com a
-- linha «Exigido por» que o gerador escrevia, uma tarefa por título.
INSERT INTO migration_generated_tasks
SELECT DISTINCT ON (t.assessment_id, t.title) t.id, t.assessment_id, t.title, t.domain::text, t.phase::text
FROM tasks t
JOIN migration_catalog_titles c ON c.title = t.title
WHERE t.description ~ E'(^|\n)Exigido por: [^\n]*$'
  AND NOT EXISTS (SELECT 1 FROM migration_generated_tasks g WHERE g.assessment_id = t.assessment_id)
ORDER BY t.assessment_id, t.title, t.created_at, t.id;

-- 1. Pelo título-tipo, quando ninguém o alterou.
UPDATE tasks t
SET requirement_code = linked.code, origin = 'assessment'
FROM (
    SELECT DISTINCT ON (g.assessment_id, c.code) g.id, c.code
    FROM migration_generated_tasks g
    JOIN migration_catalog_titles c ON c.title = g.title
    ORDER BY g.assessment_id, c.code, g.id
) linked
WHERE t.id = linked.id;

-- 2. Com o título alterado: pelo domínio, entre as lacunas do diagnóstico que ainda não têm
--    entregável ligado. Só quando não há dúvida (uma lacuna possível e uma tarefa candidata).
WITH open_gaps AS (
    SELECT a.id AS assessment_id, requirement ->> 'code' AS code
    FROM assessments a
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.raw_responses -> 'requirements') = 'array' THEN a.raw_responses -> 'requirements' ELSE '[]'::jsonb END
    ) AS requirement
    WHERE requirement ->> 'status' = 'gap'
      AND NOT EXISTS (
            SELECT 1 FROM tasks linked
            WHERE linked.assessment_id = a.id AND linked.requirement_code = requirement ->> 'code'
      )
),
candidates AS (
    SELECT g.id, gap.code,
           count(*) OVER (PARTITION BY g.id) AS codes_for_task,
           count(*) OVER (PARTITION BY g.assessment_id, gap.code) AS tasks_for_code
    FROM migration_generated_tasks g
    JOIN tasks t ON t.id = g.id AND t.requirement_code IS NULL
    JOIN open_gaps gap
      ON gap.assessment_id = g.assessment_id
     AND gap.code = ANY (CASE g.domain
            WHEN 'ecovadis' THEN ARRAY['ecovadis']
            WHEN 'banking_esg' THEN ARRAY['banking_esg']
            WHEN 'information_security' THEN ARRAY['information_security']
            WHEN 'carbon_footprint' THEN ARRAY['carbon_scope_1_2', 'carbon_scope_3']
            ELSE ARRAY[]::text[]
         END)
)
UPDATE tasks t
SET requirement_code = candidates.code, origin = 'assessment'
FROM candidates
WHERE t.id = candidates.id AND candidates.codes_for_task = 1 AND candidates.tasks_for_code = 1;

-- 3. As duas de carbono, ambas com o título alterado: o inventário dos âmbitos 1 e 2 é da
--    Fase 1 e a auditoria do âmbito 3 é da Fase 2. Se também as fases foram alteradas, ficam
--    por ligar.
WITH carbon AS (
    SELECT g.id, g.assessment_id, g.phase,
           count(*) OVER (PARTITION BY g.assessment_id) AS pending,
           count(*) OVER (PARTITION BY g.assessment_id, g.phase) AS same_phase
    FROM migration_generated_tasks g
    JOIN tasks t ON t.id = g.id AND t.requirement_code IS NULL
    WHERE g.domain = 'carbon_footprint'
)
UPDATE tasks t
SET requirement_code = CASE carbon.phase WHEN 'phase_1_urgent' THEN 'carbon_scope_1_2' ELSE 'carbon_scope_3' END,
    origin = 'assessment'
FROM carbon
JOIN assessments a ON a.id = carbon.assessment_id
WHERE t.id = carbon.id
  AND carbon.pending = 2
  AND carbon.same_phase = 1
  AND carbon.phase IN ('phase_1_urgent', 'phase_2_structural')
  AND NOT EXISTS (
        SELECT 1 FROM tasks linked
        WHERE linked.assessment_id = carbon.assessment_id
          AND linked.requirement_code IN ('carbon_scope_1_2', 'carbon_scope_3')
  );

-- A linha «Exigido por» que o gerador escrevia sai da descrição das tarefas ligadas: o
-- remetente passa a ler-se pelo código do requisito. Sai só a frase gerada. O que alguém
-- tenha escrito na mesma linha, ou a seguir, fica.
UPDATE tasks
SET description = nullif(
        rtrim(
            regexp_replace(
                regexp_replace(
                    description,
                    E'(^|\n)[ \t]*Exigido por: (Cliente industrial|Banco|Diretiva NIS2|NIS2 \\(se a empresa estiver abrangida\\))( / (Cliente industrial|Banco|Diretiva NIS2|NIS2 \\(se a empresa estiver abrangida\\)))*\\.[ \t]*',
                    E'\\1'
                ),
                E'\n{3,}', E'\n\n', 'g'
            ),
            E' \t\n'
        ),
        ''
    )
WHERE requirement_code IS NOT NULL AND description LIKE '%Exigido por: %';

-- Das restantes não se sabe quem as criou. As internas ficam como sendo da empresa, que já
-- as podia editar. As da P4S e do parceiro ficam como definidas pela P4S, e também as geradas
-- por um diagnóstico que não se conseguiram ligar: os termos delas não são da empresa.
UPDATE tasks t
SET origin = 'company'
WHERE t.requirement_code IS NULL
  AND t.executor_type = 'internal'
  AND NOT EXISTS (SELECT 1 FROM migration_generated_tasks g WHERE g.id = t.id);

ALTER TABLE tasks
    ADD CONSTRAINT tasks_origin_matches_requirement
        CHECK ((origin = 'assessment') = (requirement_code IS NOT NULL));

COMMENT ON COLUMN tasks.origin IS 'assessment: gerada pelo diagnóstico; p4s: criada pela equipa P4S; company: criada pela empresa';

-- A validade da proposta conta a partir desta data, e não do dia em que alguém a imprime.
ALTER TABLE assessments
    ADD COLUMN proposal_issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE assessments SET proposal_issued_at = COALESCE(completed_at, created_at, CURRENT_TIMESTAMP);

COMMENT ON COLUMN assessments.proposal_issued_at IS 'Data de emissão da proposta (a P4S pode reemitir)';

-- O login já procura o email sem distinguir maiúsculas. A unicidade passa a seguir a mesma regra.
-- Se já houver duas contas com o mesmo email, a migração para aqui e diz quais são.
DO $$
DECLARE
    duplicated TEXT;
BEGIN
    SELECT string_agg(emails, '; ') INTO duplicated
    FROM (
        -- Ordem igual em qualquer configuração regional da base de dados.
        SELECT string_agg(email, ', ' ORDER BY email COLLATE "C") AS emails
        FROM users GROUP BY lower(email) HAVING count(*) > 1
    ) repeated;
    IF duplicated IS NOT NULL THEN
        RAISE EXCEPTION 'Há contas com o mesmo email escrito com maiúsculas diferentes: %. Fique só com uma de cada e volte a correr a migração.', duplicated;
    END IF;
END $$;

CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
