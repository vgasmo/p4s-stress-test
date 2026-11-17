import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type MutableRefObject,
} from 'react';
import { captureFocus, restoreFocus, type FocusOrigin } from '@/lib/focus';
import { cn } from '@/lib/utils';

const OriginContext = createContext<MutableRefObject<FocusOrigin | null> | null>(null);

/**
 * Os painéis abrem por estado, sem Trigger, por isso o Radix não sabe a quem devolver o foco
 * quando fecham e ele ia parar ao topo da página. Fica aqui guardado quem o tinha ao abrir.
 */
export function Sheet({ open, ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
  const origin = useRef<FocusOrigin | null>(null);
  const wasOpen = useRef(false);
  // Lido no render em que o painel abre: nessa altura o foco ainda está em quem o abriu.
  // Depois de montado já passou para um campo do painel (autoFocus).
  const opening = open && !wasOpen.current ? captureFocus() : null;
  useLayoutEffect(() => {
    if (open && !wasOpen.current) origin.current = opening;
    wasOpen.current = Boolean(open);
  });
  return (
    <OriginContext.Provider value={origin}>
      <DialogPrimitive.Root open={open} {...props} />
    </OriginContext.Provider>
  );
}
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/** Painel lateral à direita: edita sem perder o contexto da tabela. */
export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onCloseAutoFocus, ...props }, ref) => {
  const origin = useContext(OriginContext);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-900/20 data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-sm focus:outline-none data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in',
          className,
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented || !origin?.current) return;
          event.preventDefault();
          restoreFocus(origin.current);
          origin.current = null;
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900">
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-slate-200 px-5 py-4 pr-12', className)} {...props} />;
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 space-y-4 overflow-y-auto px-5 py-4', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3', className)}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold text-slate-900', className)} {...props} />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('mt-0.5 text-xs text-slate-600', className)} {...props} />
));
SheetDescription.displayName = 'SheetDescription';
