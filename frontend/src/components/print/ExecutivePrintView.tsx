// Resumo executivo de 1 página A4 vertical. Invisível no ecrã, é a única coisa impressa
// (botão «Exportar Resumo Executivo» → window.print → Guardar como PDF).

import { createPortal } from 'react-dom';
import type { AssessmentDetail, RequirementEvidence } from '@engine/models/api.types';
import type { Task, TaskPhase } from '@engine/models/domain';
import { gapLines, type GapLine } from '@engine/services/plan-coverage';
import { countsTowardsProposal, summarizeRemediation } from '@engine/services/remediation-summary';
import { FOOTER_SIGNATURE, Wordmark } from '@/components/layout/AppShell';
import { usePublicInfo } from '@/hooks/usePublicInfo';
import { clipQuote, deadlineShort, evidenceByRequirement, evidenceSource } from '@/lib/documents';
import {
  EXECUTOR_SHORT_LABELS,
  formatApproxEUR,
  formatApproxPerYear,
  formatBasisPoints,
  formatDatePt,
  formatEUR,
  formatPercent,
  formatShareOfRisk,
  phaseLabel,
  phaseWindowText,
  sectorLabel,
} from '@/lib/formatters';

const PHASES: TaskPhase[] = ['phase_1_urgent', 'phase_2_structural'];
/** Até este número de linhas, o âmbito de cada entregável cabe na página única. */
const MAX_ROWS_WITH_SCOPE = 6;
/** Citação mais longa do que isto é cortada no resumo impresso (com «…»): o texto inteiro está no plano online. */
const MAX_PRINTED_QUOTE = 230;

interface ExecutivePrintViewProps {
  assessment: AssessmentDetail;
  tasks: Task[];
  /** Exigências confirmadas em documentos do cliente ou do banco. */
  evidence?: readonly RequirementEvidence[];
}

export function ExecutivePrintView({ assessment, tasks, evidence = [] }: ExecutivePrintViewProps) {
  const { company, snapshot } = assessment;
  const summary = summarizeRemediation(tasks, assessment.commercialRevenueAtRisk);
  const included = tasks.filter((task) => task.includedInProposal);
  // Cada lacuna com o que o plano lhe responde hoje, para o resumo dizer o mesmo que o configurador.
  const gaps = gapLines(snapshot, tasks);
  // Uma citação por lacuna (a de prazo mais próximo), para o resumo continuar numa página.
  const evidenceFor = evidenceByRequirement(evidence);
  const written = gaps.flatMap((gap) => {
    const items = evidenceFor.get(gap.requirement.code) ?? [];
    return items[0] ? [{ label: gap.requirement.label, item: items[0], more: items.length - 1 }] : [];
  });
  const hasProposal = tasks.some(countsTowardsProposal);
  const showScope = included.length <= MAX_ROWS_WITH_SCOPE;
  // Identificação de quem emite e condições da proposta: texto da P4S, configurado no servidor.
  const { legalIdentity, proposalTerms } = usePublicInfo();
  const reference = assessment.id.slice(0, 8).toUpperCase();
  // Datas guardadas no servidor: imprimir mais tarde não muda a data de emissão nem a validade.
  const { issuedOn, validUntil, validityDays, expired } = assessment.proposal;

  // Fora da moldura da app, que não é impressa quando esta vista existe.
  return createPortal(
    <div data-print-view className="hidden bg-white print:block" data-testid="executive-print-view">
      <article className="text-[11px] leading-snug text-slate-900">
        <header className="flex items-start justify-between border-b-2 border-slate-900 pb-2">
          <div>
            <Wordmark className="text-[13px]" />
            <p className="mt-0.5 text-[9px] text-slate-700">Conformidade documental para a cadeia de fornecimento</p>
          </div>
          <p className="text-right text-[9px] text-slate-700" data-testid="print-reference">
            Emitido em <span className="font-mono tabular-nums">{formatDatePt(issuedOn)}</span> · Ref.{' '}
            <span className="font-mono tabular-nums">{reference}</span>
            {assessment.conductedByName && <span className="block">Diagnóstico conduzido por {assessment.conductedByName}</span>}
          </p>
        </header>

        <h1 className="mt-3 text-[17px] font-semibold tracking-tight">Diagnóstico de Qualificação e Exposição de Faturação</h1>
        <dl className="mt-1.5 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)] gap-x-4 border-b border-slate-300 pb-2">
          <Meta label="Empresa" value={company.name} />
          <Meta label="NIF" value={company.nif} mono />
          <Meta label="Setor" value={sectorLabel(assessment.sectorProfile)} />
          <Meta label="Data do diagnóstico" value={formatDatePt(snapshot.baseDate)} mono />
        </dl>
        {/* Os dados de partida do cálculo: sem eles, quem não esteve na reunião não consegue conferir o número. */}
        <dl
          data-testid="print-inputs"
          className="mt-1.5 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.8fr)_minmax(0,1fr)] gap-x-4 border-b border-slate-300 pb-2"
        >
          <Meta label="Faturação anual" value={formatEUR(snapshot.input.annualRevenue)} mono />
          <Meta label="Nos 3 maiores clientes" value={formatPercent(snapshot.input.topClientsShare)} mono />
          <Meta label="Faturação nesses clientes" value={formatEUR(Math.round(snapshot.exposedClientRevenue))} mono />
          <Meta
            label="Crédito a refinanciar"
            value={assessment.creditLineToRefinance > 0 ? formatEUR(assessment.creditLineToRefinance) : 'Sem'}
            mono
          />
        </dl>

        <section className="mt-3 grid grid-cols-3 gap-2.5 print-avoid-break">
          <Kpi label="Faturação comercial em risco" value={formatApproxEUR(assessment.commercialRevenueAtRisk)} accent="text-rose-700">
            {formatPercent(Math.round(snapshot.commercialRevenueAtRiskShare))} da faturação anual · score {assessment.riskScore}/100
          </Kpi>
          <Kpi label="Sobrecusto bancário anual" value={formatApproxPerYear(assessment.estimatedSpreadPenalty)} accent="text-amber-800">
            {assessment.estimatedSpreadPenalty > 0
              ? `${snapshot.spreadPenaltyBps ? `${formatBasisPoints(snapshot.spreadPenaltyBps)} ao ano sobre ` : 'Sobre '}${formatEUR(assessment.creditLineToRefinance)} a refinanciar`
              : assessment.creditLineToRefinance > 0
                ? 'Rácios ESG disponíveis para o refinanciamento'
                : 'Sem refinanciamento nos próximos 18 meses'}
          </Kpi>
          <Kpi label="Investimento de remediação" value={formatEUR(summary.totalInvestment)}>
            Fase 1 {formatEUR(summary.phase1Cost)} · Fase 2 {formatEUR(summary.phase2Cost)}
            {summary.phase1CostShareOfRisk !== null && summary.phase1Cost > 0
              ? ` · a Fase 1 equivale a ${formatShareOfRisk(summary.phase1CostShareOfRisk, true)} da faturação em risco`
              : ''}
          </Kpi>
        </section>

        {snapshot.dealbreaker && (
          <p className="mt-2 border-l-2 border-rose-700 pl-2 text-[9px] text-slate-800">
            <span className="font-semibold">Bloqueio setorial.</span> {snapshot.dealbreaker.reason}
            {snapshot.dealbreaker.raisedWeight
              ? ` Por isso considera-se em risco pelo menos ${snapshot.dealbreaker.floorPoints}% da faturação nos 3 maiores clientes.`
              : ''}
          </p>
        )}

        <section className="mt-4 print-avoid-break">
          <h2 className="text-[12.5px] font-semibold">Lacunas identificadas</h2>
          {gaps.length === 0 ? (
            <p className="mt-1 text-slate-700">Sem lacunas no âmbito avaliado.</p>
          ) : (
            <table className="mt-1 w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-400 text-left text-[8.5px] uppercase tracking-wide text-slate-700">
                  <th className="py-1 pr-2 font-medium">Requisito</th>
                  <th className="py-1 pr-2 font-medium">Quem exige</th>
                  <th className="py-1 pr-2 font-medium">Resposta no plano</th>
                  <th className="py-1 text-right font-medium">Fase</th>
                </tr>
              </thead>
              <tbody>
                {gaps.map((gap) => (
                  <tr key={gap.requirement.code} className="border-b border-slate-200">
                    <td className="py-1.5 pr-2 font-medium">{gap.requirement.label}</td>
                    <td className="py-1.5 pr-2">{gap.requirement.requiredByLabel}</td>
                    <td className="py-1.5 pr-2">{gapAnswer(gap)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {gap.coverage === 'proposal' || gap.coverage === 'internal' ? (gap.phase === 'phase_1_urgent' ? '1' : '2') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {written.length > 0 && (
            <div className="mt-2" data-testid="print-evidence">
              <h3 className="text-[9px] font-semibold uppercase tracking-wide text-slate-700">Exigências documentadas</h3>
              <ul className="mt-0.5 space-y-1">
                {written.map(({ label, item, more }) => {
                  const deadline = deadlineShort(item);
                  return (
                    <li key={item.findingId} className="border-l-2 border-slate-400 pl-2 text-[9px] leading-snug text-slate-800">
                      <span className="font-semibold">{label}.</span> <span className="italic">«{clipQuote(item.quote, MAX_PRINTED_QUOTE)}»</span>{' '}
                      <span className="text-slate-700">
                        ({evidenceSource(item)}
                        {deadline ? `; prazo ${deadline}` : ''}
                        {more > 0 ? `; e mais ${more} no plano online` : ''})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="mt-4 print-avoid-break">
          <h2 className="text-[12.5px] font-semibold">Plano de ação faseado</h2>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-400 text-left text-[8.5px] uppercase tracking-wide text-slate-700">
                <th className="py-1 pr-2 font-medium">Entregável</th>
                <th className="py-1 pr-2 font-medium">Entidade executora</th>
                <th className="py-1 pr-2 text-right font-medium">Prazo</th>
                <th className="py-1 text-right font-medium">Honorários fixos</th>
              </tr>
            </thead>
            {PHASES.map((phase) => {
              const rows = included.filter((task) => task.phase === phase);
              const subtotal = phase === 'phase_1_urgent' ? summary.phase1Cost : summary.phase2Cost;
              return (
                <tbody key={phase}>
                  <tr className="bg-slate-100">
                    <td colSpan={3} className="px-1 py-1 text-[9px] font-semibold">
                      {phaseLabel(phase)} ({phaseWindowText(phase)})
                    </td>
                    <td className="px-1 py-1 text-right font-mono text-[9px] font-semibold tabular-nums">{formatEUR(subtotal)}</td>
                  </tr>
                  {rows.length === 0 ? (
                    <tr className="border-b border-slate-200">
                      <td colSpan={4} className="py-1 text-slate-700">
                        Sem entregáveis nesta fase.
                      </td>
                    </tr>
                  ) : (
                    rows.map((task) => (
                      <tr key={task.id} className="border-b border-slate-200">
                        <td className="py-1.5 pr-2">
                          {task.title}
                          {/* O que o entregável inclui, para quem assina saber o que está a aceitar. */}
                          {showScope && countsTowardsProposal(task) && task.description && (
                            <span className="block text-[8.5px] leading-snug text-slate-700">{task.description}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">{EXECUTOR_SHORT_LABELS[task.executorType]}</td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{formatDatePt(task.deadline)}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">
                          {countsTowardsProposal(task) ? formatEUR(task.estimatedCost) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              );
            })}
            <tfoot>
              <tr className="border-t-2 border-slate-900">
                <td colSpan={3} className="py-1 font-semibold">
                  Total (P4S + parceiro)
                </td>
                <td className="py-1.5 text-right font-mono font-semibold tabular-nums">{formatEUR(summary.totalInvestment)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <p className="mt-3 text-[9px] leading-snug text-slate-700 print-avoid-break">
          <span className="font-semibold text-slate-900">Como ler estes números.</span> A faturação em risco e o sobrecusto
          bancário são ordens de grandeza. Resultam de pressupostos da Plan4Sustain sobre o peso de cada exigência na
          faturação dos 3 maiores clientes ({formatPercent(snapshot.input.topClientsShare)} da faturação anual)
          {assessment.estimatedSpreadPenalty > 0 && snapshot.spreadPenaltyBps
            ? ` e sobre o agravamento de spread sem rácios ESG (${snapshot.spreadPenaltyBps} pontos base por ano)`
            : ''}
          . Não são previsões nem medições desta empresa. O score (0 a 100) é a parte da faturação nesses clientes
          considerada em risco. Os honorários são fixos.
        </p>

        <footer className="mt-4 border border-slate-400 p-3 print-avoid-break">
          {!hasProposal ? (
            // Sem entregáveis da P4S ou do parceiro não há nada para aceitar: o documento regista o diagnóstico.
            <p className="text-[11px] font-semibold" data-testid="proposal-validity">
              Sem entregáveis propostos
              <span className="block pt-0.5 text-[9px] font-normal text-slate-700">
                Este documento regista o diagnóstico de {formatDatePt(snapshot.baseDate)}. Não é uma proposta de honorários.
              </span>
            </p>
          ) : expired ? (
            <p className="text-[11px] font-semibold" data-testid="proposal-validity">
              Proposta expirada em <span className="font-mono tabular-nums">{formatDatePt(validUntil)}</span>
              <span className="block pt-0.5 text-[9px] font-normal text-slate-700">
                Os honorários e os prazos acima deixaram de estar garantidos. Peça à Plan4Sustain a reemissão da proposta.
              </span>
            </p>
          ) : (
            <>
              <p className="text-[11px] font-semibold" data-testid="proposal-validity">
                Proposta de honorários fixos válida por {validityDays} dias
                <span className="font-normal text-slate-700">
                  {' '}
                  (até <span className="font-mono tabular-nums">{formatDatePt(validUntil)}</span>)
                </span>
              </p>
              <p className="mt-0.5 text-[9px] text-slate-700">
                Prazos calculados para adjudicação na data de emissão. Se a adjudicação for posterior, deslizam o mesmo
                número de dias.
              </p>
              {proposalTerms.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[9px] text-slate-700" data-testid="proposal-terms">
                  {proposalTerms.map((term) => (
                    <li key={term}>{term}</li>
                  ))}
                </ul>
              )}
              <div className="mt-5 grid grid-cols-2 gap-6 text-[9px] text-slate-700">
                <Signature label={`Aceite por ${company.name}`} />
                <Signature label="Plan4Sustain" />
              </div>
            </>
          )}
          <p className="mt-3 text-[8.5px] text-slate-700">{FOOTER_SIGNATURE}</p>
          {legalIdentity && <p className="mt-0.5 text-[8.5px] text-slate-700">{legalIdentity}</p>}
        </footer>
      </article>
    </div>,
    document.body,
  );
}

/** O que o plano responde hoje a uma lacuna, dito numa linha. */
function gapAnswer(gap: GapLine): string {
  const done = gap.resolved ? ' · concluído' : '';
  if (!gap.task) return 'Sem entregável no plano';
  if (gap.coverage === 'excluded') return 'Fora desta proposta';
  if (gap.coverage === 'internal') return `${gap.task.title} (a cargo da empresa)${done}`;
  return `${gap.task.title}${done}`;
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[8.5px] uppercase tracking-wide text-slate-700">{label}</dt>
      <dd className={mono ? 'font-mono font-medium tabular-nums' : 'break-words font-medium'}>{value}</dd>
    </div>
  );
}

function Kpi({ label, value, accent, children }: { label: string; value: string; accent?: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-300 px-2 py-1.5">
      <p className="text-[8.5px] uppercase tracking-wide text-slate-700">{label}</p>
      <p className={`mt-0.5 font-mono text-[19px] font-semibold tabular-nums ${accent ?? 'text-slate-900'}`}>{value}</p>
      <p className="mt-0.5 text-[8.5px] text-slate-700">{children}</p>
    </div>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="h-6 border-b border-slate-500" />
      <p className="mt-1">{label} · Data ____/____/______</p>
      <p className="mt-2">Nome e cargo ________________________________</p>
    </div>
  );
}
