import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-slate-50', className)} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={cn('bg-slate-50 font-medium', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-t border-slate-200', className)} {...props} />;
}

interface HeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TableHead({ className, numeric, ...props }: HeadProps) {
  return (
    <th
      scope="col"
      className={cn(
        'h-8 whitespace-nowrap px-3 text-left align-middle text-2xs font-medium uppercase tracking-wide text-slate-600',
        numeric && 'text-right',
        className,
      )}
      {...props}
    />
  );
}

interface CellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Valores (€, %, datas): mono, tabulares e alinhados à direita. */
  numeric?: boolean;
}

export function TableCell({ className, numeric, ...props }: CellProps) {
  return (
    <td
      className={cn('px-3 py-2 align-middle', numeric && 'whitespace-nowrap text-right font-mono tabular-nums', className)}
      {...props}
    />
  );
}
