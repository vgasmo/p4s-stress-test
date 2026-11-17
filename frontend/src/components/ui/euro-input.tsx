import { useEffect, useId, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatNumberPt, parseEuroInput } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { FieldError, Input } from './form';

interface EuroInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'max'> {
  value: number;
  onValueChange: (value: number) => void;
  /** Casas decimais que o campo guarda e mostra. */
  decimals?: number;
  /** Valor máximo aceite. Por omissão, o teto do motor de cálculo. */
  max?: number;
  /** Avisa quando o que está escrito deixa de ser, ou volta a ser, um valor que se perceba. */
  onInvalidChange?: (invalid: boolean) => void;
}

interface Editing {
  text: string;
  /** Valor antes de se começar a escrever. É o que fica em vigor se a entrada não for percebida. */
  origin: number;
  /** Último valor entregue por este campo. Se o valor mudar por fora, o texto deixa de valer. */
  committed: number;
  /** Frase a mostrar. Null enquanto a entrada é válida ou ainda está a ser escrita. */
  error: string | null;
}

/** O campo mostra sempre o valor em uso: cêntimos que venham de fora não ficam escondidos. */
const shown = (value: number, decimals: number) =>
  formatNumberPt(value, Number.isInteger(value * 10 ** decimals) ? decimals : Math.max(decimals, 2));

/**
 * Valor em euros. Mostra «6.500.000» e aceita, enquanto se escreve, a escrita portuguesa e a
 * notação dos botões rápidos («6,5M», «500 mil»). Uma entrada que não percebe fica assinalada
 * e não muda o valor: mantém-se o que estava antes de se começar a escrever.
 */
export function EuroInput({
  value,
  onValueChange,
  decimals = 0,
  max,
  onInvalidChange,
  className,
  onFocus,
  onBlur,
  ...props
}: EuroInputProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // O valor mudou sem ser por este campo (botão rápido, recomeçar, outra empresa): o texto que
  // estava escrito já não corresponde a nada.
  const [seenValue, setSeenValue] = useState(value);
  if (!Object.is(seenValue, value)) {
    setSeenValue(value);
    if (editing && editing.committed !== value) setEditing(null);
  }

  const read = (text: string) => parseEuroInput(text, { decimals, max });
  const unread = editing !== null && !read(editing.text).ok;

  /** Assinala a entrada e repõe o valor de antes de se começar a escrever. */
  const reject = (current: Editing, message: string) => {
    setEditing({ ...current, committed: current.origin, error: message });
    if (value !== current.origin) onValueChange(current.origin);
  };

  // Quem usa o campo pode precisar de saber que há uma entrada por perceber, para não gravar.
  const notify = useRef(onInvalidChange);
  useEffect(() => {
    notify.current = onInvalidChange;
  });
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current === unread) return;
    reported.current = unread;
    notify.current?.(unread);
  }, [unread]);
  useEffect(
    () => () => {
      if (reported.current) notify.current?.(false);
    },
    [],
  );

  // Dentro de um formulário, gravar com uma entrada por perceber seguia com o valor anterior e
  // perdia, sem aviso, o que a pessoa escreveu. O envio fica travado até a entrada ser corrigida.
  useEffect(() => {
    const input = inputRef.current;
    const form = input?.form;
    if (!unread || !input || !form) return;
    const veto = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      // Sair e voltar a entrar no campo assinala a entrada e deixa-a selecionada para corrigir.
      input.blur();
      input.focus();
    };
    form.addEventListener('submit', veto, true);
    return () => form.removeEventListener('submit', veto, true);
  }, [unread]);

  const error = editing?.error ?? null;

  return (
    <div>
      <div className="relative">
        <Input
          {...props}
          ref={inputRef}
          inputMode="decimal"
          autoComplete="off"
          className={cn('pr-8 text-right font-mono tabular-nums', className)}
          value={editing ? editing.text : shown(value, decimals)}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={[props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined}
          onFocus={(event) => {
            if (!editing) setEditing({ text: value === 0 ? '' : shown(value, decimals), origin: value, committed: value, error: null });
            onFocus?.(event);
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const text = event.target.value;
            const current = editing ?? { text, origin: value, committed: value, error: null };
            const parsed = read(text);
            if (parsed.ok) {
              setEditing({ ...current, text, committed: parsed.value, error: null });
              if (parsed.value !== value) onValueChange(parsed.value);
            } else if (parsed.partial) {
              // Ainda a meio («1.4» a caminho de «1.450»): espera pelo resto, sem assinalar.
              setEditing({ ...current, text, error: null });
            } else {
              reject({ ...current, text }, parsed.message);
            }
          }}
          onBlur={(event) => {
            if (editing) {
              const parsed = read(editing.text);
              if (parsed.ok) setEditing(null);
              else reject(editing, parsed.message);
            }
            onBlur?.(event);
          }}
        />
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">
          €
        </span>
      </div>
      {editing && error && (
        <FieldError id={errorId} className="mt-1.5">
          {error} Mantém-se {shown(editing.origin, decimals)}&nbsp;€.
        </FieldError>
      )}
    </div>
  );
}
