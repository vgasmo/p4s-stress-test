// Painel lateral para criar ou editar uma tarefa sem sair da tabela/kanban.

import { Lock, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AssessmentDetail } from '@engine/models/api.types';
import {
  TASK_DOMAINS,
  TASK_EXECUTORS,
  isPricedExecutor,
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
  PHASE_SHORT_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  formatDatePt,
  phaseLabel,
  phaseWindowText,
} from '@/lib/formatters';
import { isAfterPhaseWindow, phaseEndDate, requiredByOf, taskEditScope } from './task-rules';

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
  assessment: AssessmentDetail;
  staff: boolean;
}

export function TaskSheetForm({ open, onOpenChange, task, assessment, staff }: TaskSheetFormProps) {
  const assessmentId = assessment.id;
  // As janelas das fases contam a partir da data de emissão da proposta.
  const baseDate = assessment.proposal.issuedOn;
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
    setConfirmDiscard(false);
    // task é lido no momento da abertura, de propósito fora das dependências.
  }, [open, taskId, staff]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  // Numa tarefa nova o utilizador da empresa cria trabalho interno; numa existente vale a regra da API.
  const scope = task ? taskEditScope(task, staff) : staff ? 'all' : 'own';
  // A empresa só acompanha as tarefas que não criou: estado e responsável.
  const followUpOnly = scope === 'follow-up';
  const termsEditable = !followUpOnly;
  const executorEditable = staff;
  const pending = update.isPending || create.isPending || remove.isPending;
  const requiredBy = task ? requiredByOf(task, assessment.snapshot) : null;

  const close = () => onOpenChange(false);
  // Entregável da proposta: P4S ou parceiro, incluído. Tem prazo e, em regra, honorários.
  const proposalDeliverable = isPricedExecutor(form.executorType) && form.includedInProposal;
  const dirty = task ? Object.keys(diff(fromTask(task), form)).length > 0 : form.title.trim() !== '' || form.description.trim() !== '';
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Fechar com Esc ou clicando fora não deita fora o que foi escrito sem perguntar. */
  const requestClose = (next: boolean) => {
    if (next || pending) return;
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else close();
  };
  // O âmbito da ferramenta são os quatro domínios da proposta. «Economia circular» só aparece numa tarefa que já o tenha.
  const domainOptions = TASK_DOMAINS.filter((domain) => domain !== 'circular_economy' || form.domain === 'circular_economy');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.title.trim().length < 3) {
      setError('O título tem de ter pelo menos 3 caracteres.');
      return;
    }
    if (proposalDeliverable && !form.deadline && !followUpOnly) {
      setError('Indique o prazo. Um entregável da P4S ou do parceiro incluído na proposta tem prazo fechado.');
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
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent aria-describedby="task-sheet-description">
        <form className="flex h-full flex-col" onSubmit={submit} noValidate>
          <SheetHeader>
            <SheetTitle>{task ? 'Editar tarefa' : 'Nova tarefa'}</SheetTitle>
            <SheetDescription id="task-sheet-description">
              {task
                ? requiredBy
                  ? `Exigido por ${requiredBy}.`
                  : task.origin === 'company'
                    ? 'Tarefa interna criada pela empresa.'
                    : 'Tarefa acrescentada pela P4S ao plano.'
                : staff
                  ? 'Entregável extra para a proposta ou tarefa interna da fábrica.'
                  : 'Tarefa interna da fábrica. Depois de criada, só a equipa P4S a pode eliminar.'}
            </SheetDescription>
          </SheetHeader>

          <SheetBody>
            {error && <ErrorBanner title="Não foi possível guardar." message={error} />}
            {confirmDiscard && (
              <div role="alertdialog" aria-label="Alterações por guardar" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950">
                <p className="text-sm font-medium">Tem alterações por guardar.</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                    Continuar a editar
                  </Button>
                  <Button size="sm" variant="danger" onClick={close}>
                    Descartar alterações
                  </Button>
                </div>
              </div>
            )}
            {followUpOnly && (
              <p className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Esta tarefa foi definida pela P4S. Pode atualizar o estado e o responsável. Para mudar o âmbito, o prazo ou
                o preço, fale com o seu consultor.
              </p>
            )}

            <Field label="Título" htmlFor="task-title">
              <Input
                id="task-title"
                value={form.title}
                maxLength={255}
                disabled={followUpOnly}
                onChange={(e) => set('title', e.target.value)}
                autoFocus={!task}
              />
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
                  disabled={followUpOnly}
                  onChange={(e) => set('deadline', e.target.value)}
                />
              </Field>
            </div>
            {isAfterPhaseWindow({ deadline: form.deadline || null, phase: form.phase }, baseDate) && (
              <FieldHint className="font-medium text-amber-800">
                Prazo depois do fim da {PHASE_SHORT_LABELS[form.phase]} ({formatDatePt(phaseEndDate(baseDate, form.phase))}). A
                proposta apresenta esta fase como {phaseWindowText(form.phase)}.
              </FieldHint>
            )}

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
                    {user.fullName} · {user.team === 'p4s' ? 'P4S' : 'Empresa'}
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
                <Field label={form.executorType === 'internal' ? 'Custo interno estimado' : 'Honorários fixos'} htmlFor="task-cost">
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
                      {phaseLabel(phase)} ({phaseWindowText(phase)})
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
              {proposalDeliverable && form.estimatedCost === 0 && !followUpOnly && (
                <FieldHint className="font-medium text-amber-800">
                  Sem honorários, este entregável sai na proposta a 0 €.
                </FieldHint>
              )}
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Domínio" htmlFor="task-domain">
                <Select
                  id="task-domain"
                  value={form.domain}
                  disabled={followUpOnly}
                  onChange={(e) => set('domain', e.target.value as TaskDomain)}
                >
                  {domainOptions.map((d) => (
                    <option key={d} value={d}>
                      {DOMAIN_LABELS[d]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prioridade" htmlFor="task-priority">
                <Select
                  id="task-priority"
                  value={form.priority}
                  disabled={followUpOnly}
                  onChange={(e) => set('priority', e.target.value as TaskPriority)}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Descrição" htmlFor="task-description">
              <Textarea
                id="task-description"
                rows={5}
                maxLength={5000}
                value={form.description}
                disabled={followUpOnly}
                onChange={(e) => set('description', e.target.value)}
              />
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
