import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string;
  ayuda?: ReactNode;
}

/** Campo con etiqueta visible y error junto al campo (sección 16.4). */
export function Campo({ etiqueta, error, ayuda, ...props }: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="etiqueta">
        {etiqueta}
      </label>
      <input
        id={id}
        className="campo"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {ayuda && <p className="mt-1 text-sm text-slate-600">{ayuda}</p>}
      {error && (
        <p id={`${id}-error`} className="error-campo">
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
