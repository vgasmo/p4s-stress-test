import * as SliderPrimitive from '@radix-ui/react-slider';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/utils';

interface SliderProps extends ComponentPropsWithoutRef<typeof SliderPrimitive.Root> {
  /** Como um leitor de ecrã diz o valor («60%»). Só com o valor controlado por quem usa. */
  formatValue?: (value: number) => string;
}

export const Slider = forwardRef<ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  ({ className, formatValue, 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledBy, ...props }, ref) => {
    const current = props.value?.[0];
    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn('relative flex w-full touch-none select-none items-center py-2', className)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-slate-200">
          <SliderPrimitive.Range className="absolute h-full bg-slate-900" />
        </SliderPrimitive.Track>
        {/* O nome e o valor vão no manípulo: é ele que tem role="slider" e recebe o foco. */}
        <SliderPrimitive.Thumb
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuetext={formatValue && current !== undefined ? formatValue(current) : undefined}
          className="block size-4 rounded-full border-2 border-slate-900 bg-white transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        />
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = 'Slider';
