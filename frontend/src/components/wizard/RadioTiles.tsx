import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { radioKeyTarget } from './radio-keys';

interface RadioTilesProps<T extends string> {
  /** Id do elemento que dá nome ao grupo. */
  labelledBy: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Opções exclusivas em mosaico, com o teclado de um grupo de botões de rádio: o Tab para só
 * na opção escolhida e as setas mudam de opção, levando o foco com elas.
 */
export function RadioTiles<T extends string>({ labelledBy, value, options, onChange, className }: RadioTilesProps<T>) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className={className}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const focused = tiles.current.indexOf(event.target as HTMLButtonElement);
        const target = radioKeyTarget(event.key, focused >= 0 ? focused : checkedIndex, options.length);
        const option = target === null ? undefined : options[target];
        if (target === null || !option) return;
        event.preventDefault();
        onChange(option.value);
        tiles.current[target]?.focus();
      }}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              tiles.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Sem opção escolhida, o Tab entra pela primeira.
            tabIndex={checked || (checkedIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2',
              checked
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
