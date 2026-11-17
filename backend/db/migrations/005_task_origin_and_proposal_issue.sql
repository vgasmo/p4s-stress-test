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

-- Tarefas que já existiam. As geradas pelo diagnóstico reconhecem-se pelo título-tipo e pela
-- linha «Exigido por» com que eram gravadas. Essa linha sai da descrição: o remetente passa
-- a ler-se pelo código do requisito.
UPDATE tasks
SET requirement_code = CASE title
        WHEN 'Preparação e Submissão do Dossier EcoVadis' THEN 'ecovadis'
        WHEN 'Inventário de Emissões GEE (Âmbitos 1 e 2)' THEN 'carbon_scope_1_2'
        WHEN 'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)' THEN 'carbon_scope_3'
        WHEN 'Dossier de Sustentabilidade para Indexação de Spread Bancário' THEN 'banking_esg'
        WHEN 'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX' THEN 'information_security'
    END,
    origin = 'assessment',
    description = regexp_replace(description, E'\\s*Exigido por: [^\\n]*$', '')
WHERE description ~ E'Exigido por: [^\\n]*$'
  AND title IN (
        'Preparação e Submissão do Dossier EcoVadis',
        'Inventário de Emissões GEE (Âmbitos 1 e 2)',
        'Auditoria de Emissões da Cadeia de Fornecimento (Âmbito 3)',
        'Dossier de Sustentabilidade para Indexação de Spread Bancário',
        'Auditoria de Segurança da Informação e Conformidade NIS2/TISAX'
  );

-- Das restantes não se sabe quem as criou. As internas ficam como sendo da empresa, que já
-- as podia editar. As da P4S e do parceiro ficam como definidas pela P4S.
UPDATE tasks SET origin = 'company' WHERE requirement_code IS NULL AND executor_type = 'internal';

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
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));
