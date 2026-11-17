import { describe, expect, it } from 'vitest';
import type { Task } from '@engine/models/domain';
import {
  TaskChangeTracker,
  applyPendingChanges,
  describePatch,
  dropSettledFailures,
  summarizeFailures,
  type FailedChange,
  type TaskPatch,
} from './task-changes';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  assessmentId: 'a1',
  companyId: 'c1',
  title: `Tarefa ${id}`,
  description: null,
  domain: 'ecovadis',
  priority: 'high',
  status: 'backlog',
  executorType: 'p4s',
  phase: 'phase_1_urgent',
  includedInProposal: true,
  estimatedCost: 3500,
  deadline: '2027-01-16',
  assignedUserId: null,
  requirementCode: null,
  origin: 'assessment',
  createdBy: null,
  updatedBy: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
  ...overrides,
});

/** Deixa correr as continuações pendentes (as promessas encadeadas da fila de cada tarefa). */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Request {
  taskId: string;
  patch: TaskPatch | 'remove';
  /** O servidor grava e responde. */
  succeed: () => void;
  /** O pedido perde-se antes de chegar ao servidor. */
  fail: (message?: string) => void;
  /** O servidor grava, mas a resposta perde-se. */
  applyThenFail: (message?: string) => void;
}

/**
 * Um plano em miniatura: o que está gravado no servidor, a lista confirmada (a cache) e o
 * registo de alterações. `screen()` é o que o utilizador vê.
 */
function plan(initial: Task[]) {
  const server = new Map(initial.map((entry) => [entry.id, entry]));
  let confirmed = initial;
  const tracker = new TaskChangeTracker();
  const requests: Request[] = [];
  const outcomes: string[] = [];

  const applyOnServer = (taskId: string, patch: TaskPatch): Task => {
    const saved = { ...(server.get(taskId) as Task), ...patch } as Task;
    server.set(taskId, saved);
    return saved;
  };

  const change = (taskId: string, patch: TaskPatch, report = true) => {
    const current = confirmed.find((entry) => entry.id === taskId) as Task;
    const done = tracker.update(current, patch, {
      report,
      send: () =>
        new Promise<Task>((resolve, reject) => {
          requests.push({
            taskId,
            patch,
            succeed: () => resolve(applyOnServer(taskId, patch)),
            fail: (message = 'Sem ligação ao servidor da P4S.') => reject(new Error(message)),
            applyThenFail: (message = 'Sem ligação ao servidor da P4S.') => {
              applyOnServer(taskId, patch);
              reject(new Error(message));
            },
          });
        }),
      saved: (saved) => {
        confirmed = confirmed.map((entry) => (entry.id === saved.id ? saved : entry));
      },
      describe: (error) => (error instanceof Error ? error.message : 'Erro inesperado.'),
    });
    done.then(
      () => outcomes.push(`gravado ${taskId}`),
      () => outcomes.push(`falhou ${taskId}`),
    );
    return done;
  };

  const remove = (taskId: string) => {
    const done = tracker.remove(taskId, {
      send: () =>
        new Promise<void>((resolve, reject) => {
          requests.push({
            taskId,
            patch: 'remove',
            succeed: () => {
              server.delete(taskId);
              resolve();
            },
            fail: (message = 'Sem ligação ao servidor da P4S.') => reject(new Error(message)),
            applyThenFail: (message = 'Sem ligação ao servidor da P4S.') => {
              server.delete(taskId);
              reject(new Error(message));
            },
          });
        }),
      removed: () => {
        confirmed = confirmed.filter((entry) => entry.id !== taskId);
      },
    });
    done.catch(() => undefined);
    return done;
  };

  return {
    tracker,
    requests,
    outcomes,
    change,
    remove,
    screen: () => applyPendingChanges(confirmed, tracker.getPending()),
    onScreen: (taskId: string) => applyPendingChanges(confirmed, tracker.getPending()).find((entry) => entry.id === taskId),
    saved: (taskId: string) => server.get(taskId),
    savedList: () => [...server.values()],
    /** Leitura completa da lista, como a que se faz depois de uma falha. */
    read: (revision: number) => {
      const list = [...server.values()];
      if (tracker.acceptRead(revision, list)) confirmed = list;
    },
    failed: () => tracker.getFailed().map((entry) => ({ taskId: entry.taskId, patch: entry.patch })),
  };
}

describe('o que o ecrã mostra enquanto o servidor não responde', () => {
  it('sem alterações em curso devolve a própria lista confirmada', () => {
    const tasks = [task('t1'), task('t2')];
    expect(applyPendingChanges(tasks, [])).toBe(tasks);
  });

  it('aplica as alterações por ordem e só nos campos que cada uma muda', () => {
    const tasks = [task('t1'), task('t2')];
    const shown = applyPendingChanges(tasks, [
      { seq: 1, taskId: 't1', kind: 'update', patch: { status: 'in_progress' }, taskTitle: 'Tarefa t1', report: true },
      { seq: 2, taskId: 't1', kind: 'update', patch: { includedInProposal: false }, taskTitle: 'Tarefa t1', report: true },
      { seq: 3, taskId: 't1', kind: 'update', patch: { status: 'review' }, taskTitle: 'Tarefa t1', report: true },
    ]);
    expect(shown[0]).toMatchObject({ status: 'review', includedInProposal: false, estimatedCost: 3500 });
    expect(shown[1]).toBe(tasks[1]);
  });

  it('um campo indefinido na alteração não apaga o valor da tarefa', () => {
    const shown = applyPendingChanges(
      [task('t1')],
      [{ seq: 1, taskId: 't1', kind: 'update', patch: { status: undefined, priority: 'low' }, taskTitle: '', report: true }],
    );
    expect(shown[0]).toMatchObject({ status: 'backlog', priority: 'low' });
  });

  it('uma tarefa a ser eliminada não aparece', () => {
    const shown = applyPendingChanges([task('t1'), task('t2')], [{ seq: 1, taskId: 't1', kind: 'remove' }]);
    expect(shown.map((entry) => entry.id)).toEqual(['t2']);
  });
});

describe('alterações seguidas na mesma tarefa (frontend-2, caso A)', () => {
  it('a resposta do pedido antigo não tapa a alteração mais recente', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { includedInProposal: false });
    void p.change('t1', { includedInProposal: true });
    await tick();

    expect(p.onScreen('t1')?.includedInProposal).toBe(true);
    // O segundo pedido só segue depois da resposta ao primeiro.
    expect(p.requests).toHaveLength(1);

    p.requests[0]?.succeed();
    await tick();
    // Chegou a resposta «desligado» do primeiro pedido: o ecrã continua com a última escolha.
    expect(p.onScreen('t1')?.includedInProposal).toBe(true);
    expect(p.requests).toHaveLength(2);

    p.requests[1]?.succeed();
    await tick();
    expect(p.tracker.getPending()).toHaveLength(0);
    expect(p.onScreen('t1')?.includedInProposal).toBe(true);
    expect(p.saved('t1')?.includedInProposal).toBe(true);
    expect(p.failed()).toEqual([]);
  });

  it('os pedidos da mesma tarefa seguem por ordem, mesmo que um falhe; os de outras tarefas não esperam', async () => {
    const p = plan([task('t1'), task('t2')]);
    void p.change('t1', { status: 'in_progress' });
    void p.change('t1', { status: 'review' });
    void p.change('t2', { status: 'completed' });
    await tick();
    expect(p.requests.map((request) => request.taskId)).toEqual(['t1', 't2']);

    p.requests[0]?.fail();
    await tick();
    expect(p.requests.map((request) => [request.taskId, request.patch])).toEqual([
      ['t1', { status: 'in_progress' }],
      ['t2', { status: 'completed' }],
      ['t1', { status: 'review' }],
    ]);
    p.requests[1]?.succeed();
    p.requests[2]?.succeed();
    await tick();
    expect(p.screen()).toEqual(p.savedList());
    expect(p.saved('t1')?.status).toBe('review');
  });

  it('a falha de um pedido antigo num campo que já voltou a ser mudado não vai para o aviso', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { includedInProposal: false });
    void p.change('t1', { includedInProposal: true });
    await tick();
    p.requests[0]?.fail();
    await tick();
    expect(p.failed()).toEqual([]);
    expect(p.onScreen('t1')?.includedInProposal).toBe(true);
    p.requests[1]?.succeed();
    await tick();
    expect(p.failed()).toEqual([]);
    expect(p.screen()).toEqual(p.savedList());
  });
});

describe('várias alterações que falham (frontend-2, caso B)', () => {
  it('ficam todas no aviso, pela ordem em que foram feitas, e o ecrã volta ao que está gravado', async () => {
    const p = plan([task('t1'), task('t2'), task('t3'), task('t4')]);
    void p.change('t1', { includedInProposal: false });
    void p.change('t2', { includedInProposal: false });
    void p.change('t3', { includedInProposal: false });
    await tick();
    expect(p.screen().map((entry) => entry.includedInProposal)).toEqual([false, false, false, true]);

    for (const request of p.requests) request.fail();
    await tick();
    expect(p.screen()).toEqual(p.savedList());
    expect(p.failed()).toEqual([
      { taskId: 't1', patch: { includedInProposal: false } },
      { taskId: 't2', patch: { includedInProposal: false } },
      { taskId: 't3', patch: { includedInProposal: false } },
    ]);
    expect(p.outcomes).toEqual(['falhou t1', 'falhou t2', 'falhou t3']);
  });

  it('repetir envia todas outra vez e o aviso fica vazio quando são gravadas', async () => {
    const p = plan([task('t1'), task('t2'), task('t3')]);
    void p.change('t1', { includedInProposal: false });
    void p.change('t2', { includedInProposal: false });
    void p.change('t3', { status: 'review' });
    await tick();
    for (const request of p.requests) request.fail();
    await tick();

    const again = p.tracker.takeFailed();
    expect(p.failed()).toEqual([]);
    for (const entry of again) void p.change(entry.taskId, entry.patch);
    await tick();
    expect(p.requests).toHaveLength(6);
    for (const request of p.requests.slice(3)) request.succeed();
    await tick();

    expect(p.failed()).toEqual([]);
    expect(p.savedList().map((entry) => [entry.includedInProposal, entry.status])).toEqual([
      [false, 'backlog'],
      [false, 'backlog'],
      [true, 'review'],
    ]);
    expect(p.screen()).toEqual(p.savedList());
  });

  it('uma falha pedida pelo painel de edição não vai para o aviso do plano, mas é devolvida a quem pediu', async () => {
    const p = plan([task('t1')]);
    const done = p.change('t1', { priority: 'low' }, false);
    await tick();
    p.requests[0]?.fail('Erro interno. Tente novamente.');
    await expect(done).rejects.toThrow('Erro interno. Tente novamente.');
    expect(p.failed()).toEqual([]);
    expect(p.onScreen('t1')?.priority).toBe('high');
  });
});

describe('uma falha só desfaz o que esse pedido tentou mudar (frontend-2, caso C)', () => {
  it('a alteração seguinte, noutro campo da mesma tarefa, fica como está', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { status: 'in_progress' });
    void p.change('t1', { includedInProposal: false });
    await tick();
    expect(p.onScreen('t1')).toMatchObject({ status: 'in_progress', includedInProposal: false });

    p.requests[0]?.fail();
    await tick();
    // O estado volta atrás. A saída da proposta, ainda a caminho, continua no ecrã.
    expect(p.onScreen('t1')).toMatchObject({ status: 'backlog', includedInProposal: false });

    p.requests[1]?.succeed();
    await tick();
    expect(p.onScreen('t1')).toMatchObject({ status: 'backlog', includedInProposal: false });
    expect(p.screen()).toEqual(p.savedList());
    expect(p.failed()).toEqual([{ taskId: 't1', patch: { status: 'in_progress' } }]);
  });

  it('uma alteração anterior já gravada não é desfeita pela falha da seguinte', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { includedInProposal: false });
    void p.change('t1', { status: 'in_progress', priority: 'low' });
    await tick();
    p.requests[0]?.succeed();
    await tick();
    p.requests[1]?.fail();
    await tick();
    expect(p.onScreen('t1')).toMatchObject({ includedInProposal: false, status: 'backlog', priority: 'high' });
    expect(p.screen()).toEqual(p.savedList());
    expect(p.failed()).toEqual([{ taskId: 't1', patch: { status: 'in_progress', priority: 'low' } }]);
  });

  it('voltar a mexer num campo tira-o do aviso; os outros campos da mesma falha ficam', async () => {
    const p = plan([task('t1'), task('t2')]);
    void p.change('t1', { status: 'in_progress', includedInProposal: false });
    void p.change('t2', { status: 'review' });
    await tick();
    for (const request of p.requests) request.fail();
    await tick();

    void p.change('t1', { status: 'completed' });
    await tick();
    expect(p.failed()).toEqual([
      { taskId: 't1', patch: { includedInProposal: false } },
      { taskId: 't2', patch: { status: 'review' } },
    ]);
    void p.change('t1', { includedInProposal: true });
    await tick();
    expect(p.failed()).toEqual([{ taskId: 't2', patch: { status: 'review' } }]);
  });
});

describe('eliminar uma tarefa', () => {
  it('sai logo do ecrã e volta se o servidor não a eliminar, sem mexer nas outras', async () => {
    const p = plan([task('t1'), task('t2')]);
    void p.remove('t1');
    void p.change('t2', { status: 'review' });
    await tick();
    expect(p.screen().map((entry) => entry.id)).toEqual(['t2']);

    p.requests.find((request) => request.taskId === 't2')?.succeed();
    await tick();
    p.requests.find((request) => request.taskId === 't1')?.fail();
    await tick();
    // A tarefa volta e a alteração gravada entretanto na outra tarefa mantém-se.
    expect(p.screen().map((entry) => [entry.id, entry.status])).toEqual([
      ['t1', 'backlog'],
      ['t2', 'review'],
    ]);
    expect(p.screen()).toEqual(p.savedList());
  });

  it('espera pelas alterações que a tarefa ainda tem a caminho e limpa as falhas dela do aviso', async () => {
    const p = plan([task('t1'), task('t2')]);
    void p.change('t1', { status: 'in_progress' });
    await tick();
    p.requests[0]?.fail();
    await tick();
    expect(p.failed()).toHaveLength(1);

    void p.change('t1', { priority: 'low' });
    void p.remove('t1');
    await tick();
    expect(p.requests.map((request) => request.patch)).toEqual([{ status: 'in_progress' }, { priority: 'low' }]);
    p.requests[1]?.succeed();
    await tick();
    expect(p.requests[2]?.patch).toBe('remove');
    p.requests[2]?.succeed();
    await tick();
    expect(p.screen().map((entry) => entry.id)).toEqual(['t2']);
    expect(p.failed()).toEqual([]);
    expect(p.screen()).toEqual(p.savedList());
  });
});

describe('ler a lista do servidor depois de uma falha', () => {
  it('só pede a leitura depois de uma falha e com os pedidos todos respondidos', async () => {
    const p = plan([task('t1'), task('t2')]);
    void p.change('t1', { status: 'in_progress' });
    await tick();
    p.requests[0]?.succeed();
    await tick();
    expect(p.tracker.wantsRead).toBe(false);

    void p.change('t1', { status: 'review' });
    void p.change('t2', { status: 'review' });
    await tick();
    p.requests[1]?.fail();
    await tick();
    expect(p.tracker.wantsRead).toBe(false);
    p.requests[2]?.succeed();
    await tick();
    expect(p.tracker.wantsRead).toBe(true);
  });

  it('a resposta perdeu-se mas o pedido foi gravado: o ecrã fica com o que está no servidor e o aviso sai', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { includedInProposal: false });
    await tick();
    p.requests[0]?.applyThenFail();
    await tick();
    // Do lado do browser falhou: desfeito no ecrã e posto no aviso.
    expect(p.onScreen('t1')?.includedInProposal).toBe(true);
    expect(p.failed()).toHaveLength(1);

    p.read(p.tracker.revision);
    expect(p.onScreen('t1')?.includedInProposal).toBe(false);
    expect(p.screen()).toEqual(p.savedList());
    expect(p.failed()).toEqual([]);
    expect(p.tracker.wantsRead).toBe(false);
  });

  it('uma leitura pedida antes de outra alteração não é usada', async () => {
    const p = plan([task('t1')]);
    void p.change('t1', { status: 'in_progress' });
    await tick();
    p.requests[0]?.fail();
    await tick();
    const revision = p.tracker.revision;

    void p.change('t1', { status: 'review' });
    await tick();
    expect(p.tracker.acceptRead(revision, p.savedList())).toBe(false);
    p.requests[1]?.succeed();
    await tick();
    expect(p.tracker.acceptRead(revision, [task('t1')])).toBe(false);
    expect(p.tracker.wantsRead).toBe(true);
    expect(p.tracker.acceptRead(p.tracker.revision, p.savedList())).toBe(true);
    expect(p.tracker.wantsRead).toBe(false);
  });

  it('uma leitura posta de parte fica por fazer', () => {
    const tracker = new TaskChangeTracker();
    expect(tracker.wantsRead).toBe(false);
    tracker.requestRead();
    expect(tracker.wantsRead).toBe(true);
  });

  it('tira do aviso o que já está no servidor e as tarefas que deixaram de existir', () => {
    const failed: FailedChange[] = [
      { seq: 1, taskId: 't1', taskTitle: 'T1', patch: { status: 'review', includedInProposal: false }, message: 'x' },
      { seq: 2, taskId: 't2', taskTitle: 'T2', patch: { status: 'review' }, message: 'x' },
      { seq: 3, taskId: 't3', taskTitle: 'T3', patch: { status: 'review' }, message: 'x' },
    ];
    const tasks = [task('t1', { status: 'review' }), task('t3')];
    expect(dropSettledFailures(failed, tasks)).toEqual([
      { seq: 1, taskId: 't1', taskTitle: 'T1', patch: { includedInProposal: false }, message: 'x' },
      failed[2],
    ]);
  });

  it('sem nada para tirar, devolve a mesma lista (o aviso não é redesenhado)', () => {
    const failed: FailedChange[] = [{ seq: 1, taskId: 't1', taskTitle: 'T1', patch: { status: 'review' }, message: 'x' }];
    expect(dropSettledFailures(failed, [task('t1')])).toBe(failed);
  });
});

describe('quem observa o registo', () => {
  it('é avisado quando uma alteração começa, quando acaba e quando o aviso é fechado', async () => {
    const p = plan([task('t1')]);
    let calls = 0;
    const unsubscribe = p.tracker.subscribe(() => {
      calls += 1;
    });
    void p.change('t1', { status: 'review' });
    expect(calls).toBe(1);
    await tick();
    p.requests[0]?.fail();
    await tick();
    expect(calls).toBe(2);
    p.tracker.dismissFailed();
    expect(calls).toBe(3);
    p.tracker.dismissFailed();
    expect(calls).toBe(3);
    unsubscribe();
    void p.change('t1', { status: 'review' });
    expect(calls).toBe(3);
  });

  it('as listas só mudam de identidade quando o conteúdo muda', async () => {
    const p = plan([task('t1')]);
    const before = p.tracker.getPending();
    expect(p.tracker.getPending()).toBe(before);
    void p.change('t1', { status: 'review' });
    expect(p.tracker.getPending()).not.toBe(before);
  });
});

describe('texto do aviso', () => {
  it('diz por palavras o que cada alteração tentava mudar', () => {
    expect(describePatch({ includedInProposal: false })).toBe('retirar da proposta');
    expect(describePatch({ includedInProposal: true })).toBe('incluir na proposta');
    expect(describePatch({ status: 'in_progress' })).toBe('estado «Em Curso»');
    expect(describePatch({ executorType: 'internal' })).toBe('executor Interno');
    expect(describePatch({ estimatedCost: 3000, deadline: null })).toBe('honorários, prazo');
  });

  it('uma só alteração, com o motivo uma vez', () => {
    expect(
      summarizeFailures([
        { seq: 4, taskId: 't1', taskTitle: 'Dossier EcoVadis', patch: { status: 'in_progress' }, message: 'Sem ligação ao servidor da P4S.' },
      ]),
    ).toEqual({
      title: 'A alteração não foi guardada e foi revertida.',
      message: 'Sem ligação ao servidor da P4S.',
      lines: [{ seq: 4, text: '«Dossier EcoVadis» · estado «Em Curso»' }],
    });
  });

  it('várias alterações com motivos diferentes levam o motivo em cada linha', () => {
    const summary = summarizeFailures([
      { seq: 1, taskId: 't1', taskTitle: 'A', patch: { includedInProposal: false }, message: 'Sem ligação ao servidor da P4S.' },
      { seq: 2, taskId: 't2', taskTitle: 'B', patch: { executorType: 'partner' }, message: 'Erro interno. Tente novamente.' },
    ]);
    expect(summary.title).toBe('2 alterações não foram guardadas e foram revertidas.');
    expect(summary.message).toBeNull();
    expect(summary.lines.map((line) => line.text)).toEqual([
      '«A» · retirar da proposta · Sem ligação ao servidor da P4S.',
      '«B» · executor Parceiro Segurança · Erro interno. Tente novamente.',
    ]);
  });
});
