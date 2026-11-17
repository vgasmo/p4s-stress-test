import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { PasswordLink } from '@engine/models/api.types';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { formatDateTimePt, passwordLinkUrl } from '@/lib/formatters';

interface PasswordLinkBoxProps {
  link: PasswordLink;
  /** Nome de quem vai receber o link. */
  fullName: string;
}

/** Mostra o link de uso único, que só existe nesta resposta: depois já não se consegue recuperar. */
export function PasswordLinkBox({ link, fullName }: PasswordLinkBoxProps) {
  const url = passwordLinkUrl(link.token);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sem acesso à área de transferência: o campo fica selecionável para copiar à mão.
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-sm font-medium text-emerald-900">
        {link.purpose === 'invite' ? 'Convite criado' : 'Link de recuperação criado'} para {fullName}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="password-link">Link para definir a palavra-passe</Label>
        <div className="flex gap-2">
          <Input
            id="password-link"
            readOnly
            value={url}
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button variant="outline" onClick={copy} className="shrink-0" aria-live="polite">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      </div>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-emerald-900">
        <li>Envie-o a {fullName} pelo canal que já usa com essa pessoa.</li>
        <li>
          Funciona uma só vez e é válido até{' '}
          <span className="font-mono tabular-nums">{formatDateTimePt(link.expiresAt)}</span>.
        </li>
        <li>Só é mostrado agora. Se o perder, gere um novo: o anterior deixa de funcionar.</li>
      </ul>
    </div>
  );
}
