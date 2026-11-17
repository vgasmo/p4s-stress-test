// Verifica que o código público do frontend não leva o catálogo privado (pesos, pisos,
// preços e prazos). Corre depois de `vite build` e falha o build se encontrar algum.
//
// Duas verificações:
//  1. nenhum ficheiro de src importa catalog.private;
//  2. nenhuma frase que só existe no catálogo privado aparece em dist.
// As frases-sentinela têm um teste do lado do backend (tests/unit/catalog.test.ts) que
// garante que continuam a existir no catálogo: se mudarem lá, mudam aqui.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTINELS = ['quatro temas EcoVadis', 'Indexação de Spread Bancário', 'fora de novos RFQ'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

const problems = [];

for (const file of files(path.join(root, 'src'))) {
  if (/\.(ts|tsx)$/.test(file) && /catalog\.private/.test(readFileSync(file, 'utf8'))) {
    problems.push(`${path.relative(root, file)} importa o catálogo privado.`);
  }
}

const dist = path.join(root, 'dist');
let built;
try {
  built = files(dist);
} catch {
  console.error('Não existe dist/. Corra primeiro `vite build`.');
  process.exit(2);
}
for (const file of built) {
  if (!/\.(js|css|html|map)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const sentinel of SENTINELS) {
    if (content.includes(sentinel)) problems.push(`${path.relative(root, file)} contém «${sentinel}».`);
  }
}

if (problems.length > 0) {
  console.error('O catálogo privado está a ir para o código público:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`Código público sem catálogo privado (${built.length} ficheiros verificados).`);
