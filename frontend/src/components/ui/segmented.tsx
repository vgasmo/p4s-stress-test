import { cn } from '@/lib/utils';

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Grupo de opções exclusivas (radiogroup acessível por teclado). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-md border border-slate-300 bg-white p-0.5', disabled && 'opacity-80', className)}
      onKeyDown={(event) => {
        const step = STEPS[event.key];
        if (disabled || step === undefined) return;
        event.preventDefault();
        const index = (options.findIndex((option) => option.value === value) + step + options.length) % options.length;
        const next = options[index];
        if (!next) return;
        // Como num grupo de rádios nativo, o foco acompanha a escolha. Sem isto ficava na opção
        // antiga, que deixa de estar na ordem do Tab.
        event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
        onChange(next.value);
      }}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-[5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900',
              size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-8 px-3 text-xs',
              checked ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
              disabled && 'cursor-not-allowed',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
