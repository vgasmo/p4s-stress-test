// Painel lateral para criar ou editar uma tarefa sem sair da tabela/kanban.

import { Lock, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  TASK_DOMAINS,
  TASK_EXECUTORS,
  TASK_PHASES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  type TaskDomain,
  type TaskExecutor,
  type TaskPhase,
  type TaskPriority,
  type TaskStatus,
} from '@engine/models/domain';
import type { UpdateTaskInput } from '@engine/models/schemas';
import { Button } from '@/components/ui/button';
import { EuroInput } from '@/components/ui/euro-input';
import { FieldHint, Input, Label, Select, Textarea } from '@/components/ui/form';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorBanner } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { useAssignableUsers } from '@/hooks/useAuth';
import { useCreateTask, useDeleteTask, useUpdateTask } from '@/hooks/useTasks';
import { errorMessage } from '@/lib/api';
import {
  DOMAIN_LABELS,
  EXECUTOR_LABELS,
  PHASE_LABELS,
  PRIORITY_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
} from '@/lib/formatters';
import { canEditProposalTerms, requiredByFromDescription } from './task-rules';

interface FormState {
  title: string;
  description: string;
  domain: TaskDomain;
  priority: TaskPriority;
  phase: TaskPhase;
  executorType: TaskExecutor;
  status: TaskStatus;
  deadline: string;
  assignedUserId: string;
  estimatedCost: number;
  includedInProposal: boolean;
}

const fromTask = (task: Task): FormState => ({
  title: task.title,
  description: task.description ?? '',
  domain: task.domain,
  priority: task.priority,
  phase: task.phase,
  executorType: task.executorType,
  status: task.status,
  deadline: task.deadline ?? '',
  assignedUserId: task.assignedUserId ?? '',
  estimatedCost: task.estimatedCost,
  includedInProposal: task.includedInProposal,
});

const blank = (staff: boolean, phase: TaskPhase): FormState => ({
  title: '',
  description: '',
  domain: 'carbon_footprint',
  priority: 'medium',
  phase,
  executorType: staff ? 'p4s' : 'internal',
  status: 'backlog',
  deadline: '',
  assignedUserId: '',
  estimatedCost: 0,
  includedInProposal: true,
});

/** Só os campos alterados: a API recusa alterações a termos bloqueados, mesmo com o mesmo valor noutro campo. */
function diff(before: FormState, after: FormState): UpdateTaskInput {
  const patch: UpdateTaskInput = {};
  if (after.title.trim() !== before.title) patch.title = after.title.trim();
  if (after.description.trim() !== before.description.trim()) patch.description = after.description.trim() || null;
  if (after.domain !== before.domain) patch.domain = after.domain;
  if (after.priority !== before.priority) patch.priority = after.priority;
  if (after.phase !== before.phase) patch.phase = after.phase;
  if (after.executorType !== before.executorType) patch.executorType = after.executorType;
  if (after.status !== before.status) patch.status = after.status;
  if (after.deadline !== before.deadline) patch.deadline = after.deadline || null;
  if (after.assignedUserId !== before.assignedUserId) patch.assignedUserId = after.assignedUserId || null;
  if (after.estimatedCost !== before.estimatedCost) patch.estimatedCost = after.estimatedCost;
  if (after.includedInProposal !== before.includedInProposal) patch.includedInProposal = after.includedInProposal;
  return patch;
}

interface TaskSheetFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null cria uma tarefa nova. */
  task: Task | null;
  assessmentId: string;
  staff: boolean;
}

export function TaskSheetForm({ open, onOpenChange, task, assessmentId, staff }: TaskSheetFormProps) {
  const users = useAssignableUsers();
  const update = useUpdateTask(assessmentId);
  const create = useCreateTask(assessmentId);
  const remove = useDeleteTask(assessmentId);
  const [form, setForm] = useState<FormState>(() => (task ? fromTask(task) : blank(staff, 'phase_1_urgent')));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reinicia só ao abrir ou ao mudar de tarefa: atualizações em segundo plano não apagam edições.
  const taskId = task?.id ?? null;
  useEffect(() => {
    if (!open) return;
    setForm(task ? fromTask(task) : blank(staff, 'phase_1_urgent'));
    setError(null);
    setConfirmDelete(false);
    // task é lido no momento da abertura, de propósito fora das dependências.
  }, [open, taskId, staff]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  // Numa tarefa nova o utilizador da empresa cria trabalho interno; numa existente vale a regra da API.
  const termsEditable = task ? canEditProposalTerms(task, staff) : true;
  const executorEditable = staff;
  const pending = update.isPending || create.isPending || remove.isPending;
  const requiredBy = task ? requiredByFromDescription(task.description) : null;

  const close = () => onOpenChange(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) {
      setError('O título tem de ter pelo menos 3 caracteres.');
      return;
    }
    if (task) {
      const patch = diff(fromTask(task), form);
      if (Object.keys(patch).length === 0) return close();
      update.mutate({ id: task.id, patch }, { onSuccess: close, onError: (cause) => setError(errorMessage(cause)) });
      return;
    }
    create.mutate(
      {
        assessmentId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        domain: form.domain,
        priority: form.priority,
        phase: form.phase,
        executorType: staff ? form.executorType : 'internal',
        status: form.status,
        deadline: form.deadline || null,
        assignedUserId: form.assignedUserId || null,
        estimatedCost: form.estimatedCost,
        includedInProposal: form.includedInProposal,
      },
      { onSuccess: close, onError: (cause) => setError(errorMessage(cause)) },
    );
  };

  const deleteTask = () => {
    if (!task) return;
    remove.mutate(task.id, { onSuccess: close, onError: (cause) => setError(errorMessage(cause)) });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="task-sheet-description">
        <form className="flex h-full flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>{task ? 'Editar tarefa' : 'Nova tarefa'}</SheetTitle>
            <SheetDescription id="task-sheet-description">
              {task
                ? requiredBy
                  ? `Exigido por ${requiredBy}.`
                  : 'Tarefa adicionada manualmente ao plano.'
                : staff
                  ? 'Entregável extra para a proposta ou tarefa interna da fábrica.'
                  : 'Tarefa interna da fábrica. Entregáveis P4S são acrescentados pela equipa P4S.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error && <ErrorBanner title="Não foi possível guardar." message={error} />}

            <Field label="Título" htmlFor="task-title">
              <Input id="task-title" value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus={!task} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Estado" htmlFor="task-status">
                <Select id="task-status" value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prazo" htmlFor="task-deadline">
                <Input
                  id="task-deadline"
                  type="date"
                  className="font-mono tabular-nums"
                  value={form.deadline}
                  onChange={(e) => set('deadline', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Responsável" htmlFor="task-assignee">
              <Select
                id="task-assignee"
                value={form.assignedUserId}
                disabled={users.isPending || users.isError}
                onChange={(e) => set('assignedUserId', e.target.value)}
              >
                <option value="">{users.isError ? 'Lista indisponível' : 'Sem responsável'}</option>
                {users.data?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} · {ROLE_LABELS[user.role]}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
              <legend className="flex items-center gap-1.5 px-1 text-xs font-semibold text-slate-900">
                Termos da proposta
                {!termsEditable && (
                  <span className="inline-flex items-center gap-1 font-normal text-slate-600">
                    <Lock aria-hidden className="size-3" /> definidos pela P4S
                  </span>
                )}
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Honorários fixos" htmlFor="task-cost">
                  <EuroInput
                    id="task-cost"
                    value={form.estimatedCost}
                    decimals={0}
                    disabled={!termsEditable}
                    onValueChange={(value) => set('estimatedCost', value)}
                  />
                </Field>
                <Field label="Executor" htmlFor="task-executor">
                  <Select
                    id="task-executor"
                    value={form.executorType}
                    disabled={!executorEditable}
                    onChange={(e) => set('executorType', e.target.value as TaskExecutor)}
                  >
                    {TASK_EXECUTORS.map((executor) => (
                      <option key={executor} value={executor}>
                        {EXECUTOR_LABELS[executor]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Fase" htmlFor="task-phase">
                <Select id="task-phase" value={form.phase} disabled={!termsEditable} onChange={(e) => set('phase', e.target.value as TaskPhase)}>
                  {TASK_PHASES.map((phase) => (
                    <option key={phase} value={phase}>
                      {PHASE_LABELS[phase]}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-900">
                Incluída na proposta
                <Switch
                  checked={form.includedInProposal}
                  disabled={!termsEditable}
                  onCheckedChange={(value) => set('includedInProposal', value)}
                />
              </label>
              <FieldHint>Tarefas internas e fora da proposta não contam para o investimento.</FieldHint>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Domínio" htmlFor="task-domain">
                <Select id="task-domain" value={form.domain} onChange={(e) => set('domain', e.target.value as TaskDomain)}>
                  {TASK_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {DOMAIN_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prioridade" htmlFor="task-priority">
                <Select id="task-priority" value={form.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Descrição" htmlFor="task-description">
              <Textarea id="task-description" rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
          </SheetBody>

          <SheetFooter>
            <div>
              {task && staff && (
                confirmDelete ? (
                  <Button variant="destructive" size="sm" onClick={deleteTask} disabled={pending}>
                    <Trash2 aria-hidden /> Confirmar eliminação
                  </Button>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)} disabled={pending}>
                    <Trash2 aria-hidden /> Eliminar
                  </Button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={close} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'A guardar…' : task ? 'Guardar alterações' : 'Criar tarefa'}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
