import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { whenChangesSettle } from './usePendingChanges';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Uma alteração em curso, como as que os hooks da aplicação enviam. */
function startChange(queryClient: QueryClient) {
  const request = deferred<string>();
  const observer = new MutationObserver(queryClient, { mutationFn: () => request.promise });
  observer.mutate().catch(() => undefined);
  return request;
}

describe('esperar pelas alterações por confirmar', () => {
  it('sem alterações em curso resolve logo', async () => {
    let done = false;
    void whenChangesSettle(new QueryClient()).then(() => {
      done = true;
    });
    await tick();
    expect(done).toBe(true);
  });

  it('espera por todas as alterações, gravadas ou falhadas', async () => {
    const queryClient = new QueryClient();
    const first = startChange(queryClient);
    const second = startChange(queryClient);
    await tick();
    expect(queryClient.isMutating()).toBe(2);

    let done = false;
    void whenChangesSettle(queryClient).then(() => {
      done = true;
    });
    first.resolve('gravado');
    await tick();
    expect(done).toBe(false);
    second.reject(new Error('Sem ligação ao servidor da P4S.'));
    await tick();
    expect(done).toBe(true);
  });

  it('uma alteração que começa enquanto se espera também conta', async () => {
    const queryClient = new QueryClient();
    const first = startChange(queryClient);
    await tick();
    let done = false;
    void whenChangesSettle(queryClient).then(() => {
      done = true;
    });
    const second = startChange(queryClient);
    await tick();
    first.resolve('gravado');
    await tick();
    expect(done).toBe(false);
    second.resolve('gravado');
    await tick();
    expect(done).toBe(true);
  });
});
