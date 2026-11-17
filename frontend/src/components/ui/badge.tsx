import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-2xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-slate-200 bg-slate-100 text-slate-700',
        outline: 'border-slate-300 bg-white text-slate-700',
        critical: 'border-rose-200 bg-rose-100 text-rose-800',
        high: 'border-amber-200 bg-amber-100 text-amber-800',
        p4s: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        partner: 'border-indigo-200 bg-indigo-50 text-indigo-800',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        danger: 'border-rose-200 bg-rose-50 text-rose-800',
        dark: 'border-slate-900 bg-slate-900 text-white',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
