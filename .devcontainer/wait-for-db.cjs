// Espera que o PostgreSQL aceite ligações (até 60 s). Corre a partir da pasta backend, depois
// de instaladas as dependências: node ../.devcontainer/wait-for-db.cjs
// Sai com 0 quando a base de dados responde e com 1 se não responder.
const path = require('node:path');
const fromBackend = (name) => require(path.join(process.cwd(), 'node_modules', name));
fromBackend('dotenv').config();
const { Client } = fromBackend('pg');

(async () => {
  let lastError = 'sem resposta';
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      process.exit(0);
    } catch (error) {
      lastError = error.message;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  console.error(`A base de dados não respondeu ao fim de 60 s (${lastError}). Verifique DATABASE_URL em backend/.env.`);
  process.exit(1);
})();
