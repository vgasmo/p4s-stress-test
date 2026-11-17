import { AssessmentWizard } from '@/components/wizard/AssessmentWizard';

export function StressTestPage() {
  return (
    <div className="space-y-6">
      <header className="max-w-4xl">
        <p className="text-2xs font-medium uppercase tracking-wide text-slate-600">Stress test de qualificação de fornecedor</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Os novos cadernos de encargos já não vêm em desenhos técnicos.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">
          Do EcoVadis e pegada de carbono às exigências do banco e segurança da informação: entregamos as respostas que os
          seus clientes exigem para fechar contratos. Prazo e preço fechados.
        </p>
      </header>
      <AssessmentWizard />
    </div>
  );
}
