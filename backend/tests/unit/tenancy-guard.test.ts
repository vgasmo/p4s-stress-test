// Lei do código: nenhuma query a assessments ou tasks corre sem company_id = $1.
// Este teste lê o SQL de todo o código da API e falha se alguém acrescentar, em qualquer
// ficheiro, uma query a essas tabelas sem o filtro (ou com um OR que o contorne).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve('src');
const TENANT_TABLE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:tasks|assessments)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Texto entre crases, aspas ou plicas que mexe em tasks ou assessments. */
function tenantStatements(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const literals = [...source.matchAll(/`([^`]*)`|'([^'\n]*)'|"([^"\n]*)"/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
  return literals.filter((sql) => TENANT_TABLE.test(sql) && /\b(SELECT|UPDATE|DELETE|INSERT)\b/.test(sql));
}

describe('isolamento multi-tenant no SQL', () => {
  const statements = sourceFiles(ROOT).flatMap((file) =>
    tenantStatements(file).map((sql) => ({ file: path.relative(ROOT, file), sql })),
  );

  it('encontra as queries dos models', () => {
    expect(statements.length).toBeGreaterThanOrEqual(10);
    expect(new Set(statements.map((s) => s.file))).toEqual(new Set(['models/assessment.model.ts', 'models/task.model.ts']));
  });

  it('todas as leituras, alterações e remoções filtram por company_id = $1, sem OR', () => {
    for (const { file, sql } of statements.filter((s) => /\b(SELECT|UPDATE|DELETE)\b/.test(s.sql) && !/\bINSERT\b/.test(s.sql))) {
      expect(sql, `${file}: ${sql}`).toMatch(/company_id = \$1/);
      expect(sql, `${file}: ${sql}`).not.toMatch(/\bOR\b/i);
    }
  });

  it('as inserções gravam a empresa do contexto como primeiro valor', () => {
    const inserts = statements.filter((s) => /\bINSERT\b/.test(s.sql));
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const { file, sql } of inserts) {
      // INSERT INTO tasks (${INSERT_COLUMNS…}) ou INSERT INTO assessments (company_id, …) VALUES ($1, …)
      expect(sql, `${file}: ${sql}`).toMatch(/INSERT INTO (?:assessments \(company_id\b|tasks \(\$\{INSERT_COLUMNS)/);
    }
    const taskModel = readFileSync(path.join(ROOT, 'models/task.model.ts'), 'utf8');
    expect(taskModel).toMatch(/const INSERT_COLUMNS = \[\s*'company_id',/);
  });
});

// A mesma lei para os documentos analisados: são de uma empresa, e contêm citações dos seus clientes.
describe('isolamento multi-tenant no SQL dos documentos', () => {
  const DOCUMENT_TABLE = /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:document_analyses|document_findings)\b/i;
  const statements = sourceFiles(ROOT).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const literals = [...source.matchAll(/`([^`]*)`|'([^'\n]*)'|"([^"\n]*)"/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
    return literals
      .filter((sql) => DOCUMENT_TABLE.test(sql) && /\b(SELECT|UPDATE|DELETE|INSERT)\b/.test(sql))
      .map((sql) => ({ file: path.relative(ROOT, file), sql }));
  });

  it('só o model dos documentos lhes toca', () => {
    expect(statements.length).toBeGreaterThanOrEqual(10);
    expect(new Set(statements.map((s) => s.file))).toEqual(new Set(['models/document.model.ts']));
  });

  it('todas as leituras, alterações e remoções filtram por company_id = $1, sem OR', () => {
    for (const { file, sql } of statements.filter((s) => !/\bINSERT\b/.test(s.sql))) {
      expect(sql, `${file}: ${sql}`).toMatch(/company_id = \$1/);
      expect(sql, `${file}: ${sql}`).not.toMatch(/\bOR\b/i);
    }
  });

  it('as inserções gravam a empresa do contexto como primeiro valor', () => {
    const inserts = statements.filter((s) => /\bINSERT\b/.test(s.sql));
    expect(inserts).toHaveLength(2);
    for (const { file, sql } of inserts) {
      expect(sql, `${file}: ${sql}`).toMatch(/INSERT INTO document_(?:analyses|findings) \(company_id\b[^)]*\)\s+VALUES \(\$1,/);
    }
  });
});
