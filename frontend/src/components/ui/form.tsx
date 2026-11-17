import { ChevronDown } from 'lucide-react';
import {
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors placeholder:text-slate-500 hover:border-slate-400 focus-visible:border-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700 disabled:opacity-100 aria-[invalid=true]:border-rose-400';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />,
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2 leading-relaxed', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Largura e margens: ficam no contentor para a seta acompanhar o campo. */
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <div className={cn('relative w-full', containerClassName)}>
      <select ref={ref} className={cn(fieldBase, 'h-9 appearance-none pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-600" />
    </div>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-xs font-medium text-slate-700', className)} {...props} />;
}

export function FieldHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-slate-600', className)} {...props} />;
}

export function FieldError({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p role="alert" className={cn('text-xs font-medium text-rose-700', className)} {...props} />;
}
