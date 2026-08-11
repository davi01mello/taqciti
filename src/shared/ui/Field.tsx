/**
 * Campos de texto do design system: o de busca (com lupa) e o de resposta.
 *
 * Digitar dentro do Meet exige um cuidado que não é óbvio: sem parar a
 * propagação do teclado, cada letra vira atalho do Meet (o "m" muta o
 * microfone no meio de uma frase). Por isso todo campo daqui segura o evento.
 */
import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

type FieldProps = InputHTMLAttributes<HTMLInputElement>;

/*
 * Vidro que AFUNDA (`glass-sunken`) em vez de subir: um campo é um lugar onde
 * se deposita algo, e a única superfície do sistema que se comporta assim. O
 * foco não troca a borda por outra cor — acende um fio verde por dentro, que é
 * o mesmo gesto do fio de luz das outras superfícies.
 */
const BASE =
  'glass-sunken w-full rounded-control text-read text-foreground ' +
  'outline-none transition-shadow duration-200 ease-flow placeholder:text-muted/55 ' +
  'focus:shadow-[inset_0_0_0_1px_rgb(var(--c-primary)/0.5)]';

/** Impede que a digitação vire atalho da página hospedeira (o Meet). */
function guardKeys(event: React.KeyboardEvent<HTMLInputElement>): void {
  event.stopPropagation();
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(
  ({ className = '', onKeyDown, ...rest }, ref) => (
    <input
      {...rest}
      ref={ref}
      onKeyDown={(event) => {
        guardKeys(event);
        onKeyDown?.(event);
      }}
      className={`${BASE} px-4 py-3 ${className}`}
    />
  ),
);
TextField.displayName = 'TextField';

export const SearchField = forwardRef<HTMLInputElement, FieldProps>(
  ({ className = '', onKeyDown, ...rest }, ref) => (
    <div className="relative">
      <Icon
        name="search"
        size={16}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
      />
      {/* O placeholder é uma frase inteira e o painel é estreito: um corpo
          menor SÓ para ele evita a frase aparecer cortada no meio. */}
      <input
        {...rest}
        ref={ref}
        onKeyDown={(event) => {
          guardKeys(event);
          onKeyDown?.(event);
        }}
        className={`${BASE} py-3 pl-10 pr-4 placeholder:text-body ${className}`}
      />
    </div>
  ),
);
SearchField.displayName = 'SearchField';
