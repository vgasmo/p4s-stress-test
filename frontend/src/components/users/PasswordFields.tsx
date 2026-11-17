import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '@engine/models/domain';
import { FieldError, FieldHint, Input, Label } from '@/components/ui/form';

/** Mesmas regras da API: mínimo de caracteres e máximo de bytes (limite do bcrypt). */
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `A palavra-passe tem de ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return 'A palavra-passe é demasiado comprida.';
  if (password !== confirmation) return 'As duas palavras-passe não coincidem.';
  return null;
}

interface PasswordFieldsProps {
  idPrefix: string;
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  /** Só mostra o erro depois de o utilizador tentar submeter. */
  showProblem: boolean;
}

export function PasswordFields({
  idPrefix,
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  showProblem,
}: PasswordFieldsProps) {
  const problem = passwordProblem(password, confirmation);
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-new`}>Nova palavra-passe</Label>
        <Input
          id={`${idPrefix}-new`}
          type="password"
          autoComplete="new-password"
          value={password}
          aria-invalid={showProblem && problem ? true : undefined}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
        <FieldHint>Pelo menos {PASSWORD_MIN_LENGTH} caracteres. Uma frase comprida é melhor do que símbolos difíceis de lembrar.</FieldHint>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-confirm`}>Repetir a palavra-passe</Label>
        <Input
          id={`${idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          value={confirmation}
          aria-invalid={showProblem && problem ? true : undefined}
          onChange={(event) => onConfirmationChange(event.target.value)}
        />
      </div>
      {showProblem && problem && <FieldError>{problem}</FieldError>}
    </>
  );
}
