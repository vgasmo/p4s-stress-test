import { useState, type InputHTMLAttributes } from 'react';
import { formatNumberPt, parseEuroInput } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Input } from './form';

interface EuroInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  onValueChange: (value: number) => void;
  decimals?: number;
}

/** Valor em euros: mostra «6.500.000» e aceita texto livre enquanto está em edição. */
export function EuroInput({ value, onValueChange, decimals = 0, className, onFocus, onBlur, ...props }: EuroInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="relative">
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        className={cn('pr-8 text-right font-mono tabular-nums', className)}
        value={draft ?? formatNumberPt(value, decimals)}
        onFocus={(event) => {
          setDraft(value === 0 ? '' : formatNumberPt(value, decimals));
          onFocus?.(event);
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onValueChange(parseEuroInput(event.target.value));
        }}
        onBlur={(event) => {
          setDraft(null);
          onBlur?.(event);
        }}
      />
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-600">
        €
      </span>
    </div>
  );
}
