// Lei do código: nenhuma query a assessments ou tasks corre sem company_id = $1.
// Este teste lê o SQL dos models e falha se alguém acrescentar uma query sem o filtro.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MODELS = ['assessment.model.ts', 'task.model.ts'];

function sqlStatements(file: string): string[] {
  const source = readFileSync(path.resolve('src/models', file), 'utf8');
  return [...source.matchAll(/`([^`]*)`/g)]
    .map((match) => match[1] ?? '')
    .filter((sql) => /\b(SELECT|UPDATE|DELETE)\b/.test(sql));
}

describe('isolamento multi-tenant no SQL', () => {
  for (const file of MODELS) {
    it(`${file}: todas as leituras, alterações e remoções filtram por company_id = $1`, () => {
      const statements = sqlStatements(file);
      expect(statements.length).toBeGreaterThan(0);
      for (const sql of statements) expect(sql, sql).toMatch(/company_id = \$1/);
    });
  }
});
