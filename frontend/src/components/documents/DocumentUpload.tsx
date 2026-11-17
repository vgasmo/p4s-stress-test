// Carregar um documento para análise. Antes de enviar, o consultor confirma que o pode fazer:
// o texto do documento sai deste servidor para a API de IA.

import { FileUp, ShieldAlert } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import type { DocumentListResponse } from '@engine/models/api.types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useUploadDocument } from '@/hooks/useDocuments';
import { errorMessage } from '@/lib/api';
import { fileProblem, formatFileSize } from '@/lib/documents';
import { cn } from '@/lib/utils';

interface DocumentUploadProps {
  ai: DocumentListResponse['ai'];
  limits: DocumentListResponse['limits'];
  companyName: string | undefined;
  onUploaded: (analysisId: string) => void;
}

export function DocumentUpload({ ai, limits, companyName, onUploaded }: DocumentUploadProps) {
  const upload = useUploadDocument();
  const input = useRef<HTMLInputElement>(null);
  const consentId = useId();
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const ready = ai.configured && consent && !upload.isPending;

  const send = (file: File | undefined) => {
    if (!file || !ready) return;
    upload.reset();
    const reason = fileProblem(file, limits);
    setProblem(reason);
    if (reason) return;
    upload.mutate(file, {
      onSuccess: (analysis) => {
        // A confirmação vale para um documento: o seguinte pede-a outra vez.
        setConsent(false);
        onUploaded(analysis.id);
      },
    });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files[0]);
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Carregar documento</CardTitle>
          <CardDescription>
            Questionário de fornecedor, código de conduta, caderno de encargos ou carta do banco
            {companyName ? ` recebidos por ${companyName}` : ''}.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ai.configured && (
          <div
            role="status"
            data-testid="ai-not-configured"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950"
          >
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <p>
              <span className="font-medium">A análise com IA não está ligada neste servidor.</span> Falta a chave da API
              (ANTHROPIC_API_KEY) na configuração. Enquanto não existir, nenhum documento é aceite nem enviado para fora.
            </p>
          </div>
        )}

        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (ready) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'rounded-md border border-dashed px-4 py-5 text-center transition-colors',
            dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white',
            !ready && 'opacity-60',
          )}
        >
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="document-file-input"
            accept={limits.acceptedExtensions.join(',')}
            onChange={(event) => {
              send(event.target.files?.[0]);
              // O mesmo ficheiro pode ser escolhido outra vez depois de um erro.
              event.target.value = '';
            }}
          />
          <Button size="sm" disabled={!ready} onClick={() => input.current?.click()}>
            <FileUp aria-hidden /> {upload.isPending ? 'A enviar…' : 'Escolher ficheiro'}
          </Button>
          <p className="mt-2 text-xs text-slate-600">
            ou arraste-o para aqui. PDF, Word (.docx) ou texto, até {formatFileSize(limits.maxBytes)}.
          </p>
        </div>

        <label htmlFor={consentId} className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
          <input
            id={consentId}
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 rounded border-slate-400 accent-slate-900"
            checked={consent}
            disabled={!ai.configured}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Confirmo que posso enviar este documento a um serviço externo de IA (o acordo de confidencialidade com quem o
            emitiu não o impede).
          </span>
        </label>

        {(problem ?? upload.isError) && (
          <p role="alert" className="text-xs font-medium text-rose-700" data-testid="upload-error">
            {problem ?? errorMessage(upload.error)}
          </p>
        )}

        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer select-none font-medium text-slate-700 hover:text-slate-900">
            O que acontece ao documento
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>O ficheiro não é guardado. O servidor lê o texto e deita o ficheiro fora.</li>
            <li>
              O texto é enviado à API da Anthropic{ai.model ? ` (modelo ${ai.model})` : ''} para levantar as exigências.
            </li>
            <li>Fica registado o nome do ficheiro, o levantamento e as frases citadas. O resto do documento não fica em lado nenhum.</li>
            <li>Nada chega ao plano do cliente sem ser confirmado aqui, exigência a exigência.</li>
            <li>Ainda não são lidos: Excel, PDF digitalizados (imagem) e documentos com mais de 300 mil caracteres.</li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
