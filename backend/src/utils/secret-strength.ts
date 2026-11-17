// Um segredo de produção tem de ter sido gerado (openssl rand, crypto.randomBytes), não
// escrito à mão. Uma lista de palavras proibidas deixava passar «00000…», o alfabeto ou uma
// frase com o nome da empresa: aqui verifica-se a forma do valor. É uma heurística, não uma
// medida de entropia. Apanha os casos preguiçosos e diz como gerar um valor que serve.

const HEX = /^[0-9a-f]{64,}$/i;
const BASE64 = /^[A-Za-z0-9+/_=-]{43,}$/;
/**
 * Palavra escrita: uma letra seguida de pelo menos três minúsculas, e mais nada. Em base64url
 * o hífen e o sublinhado são caracteres normais, por isso um valor aleatório também se parte
 * em bocados. Um bocado com esta forma é raro, e dois praticamente não acontecem.
 */
const WORD = /^[A-Za-z][a-z]{3,}$/;

/** O valor repete-se com um período curto («aB3aB3aB3…», «deadbeefdeadbeef…»). */
function isPeriodic(value: string, maxPeriod = 16): boolean {
  for (let period = 1; period <= maxPeriod; period += 1) {
    let repeats = true;
    for (let i = period; i < value.length && repeats; i += 1) repeats = value[i] === value[i - period];
    if (repeats) return true;
  }
  return false;
}

/** Tem uma sequência de caracteres seguidos («abcdefgh», «87654321»). */
function hasSequence(value: string, length = 8): boolean {
  let up = 1;
  let down = 1;
  for (let i = 1; i < value.length; i += 1) {
    const step = value.charCodeAt(i) - value.charCodeAt(i - 1);
    up = step === 1 ? up + 1 : 1;
    down = step === -1 ? down + 1 : 1;
    if (up >= length || down >= length) return true;
  }
  return false;
}

/**
 * O valor tem a forma de um segredo gerado: hexadecimal com 64 ou mais caracteres (32 bytes),
 * ou base64 com 43 ou mais (32 bytes) que mistura maiúsculas, minúsculas e algarismos. Não é
 * uma frase com palavras separadas por hífen ou sublinhado, não se repete e não é uma sequência.
 */
export function looksGenerated(secret: string): boolean {
  const hex = HEX.test(secret);
  if (!hex && !BASE64.test(secret)) return false;
  if (isPeriodic(secret) || hasSequence(secret)) return false;
  if (hex) return new Set(secret.toLowerCase()).size >= 10;

  const mixed = /[a-z]/.test(secret) && /[A-Z]/.test(secret) && /[0-9]/.test(secret);
  const words = secret.split(/[-_]/).filter((part) => WORD.test(part)).length;
  return mixed && words < 2 && new Set(secret).size >= 16;
}
