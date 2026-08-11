import * as React from 'react';

/** Tiny classname joiner — the app doesn't need clsx as a dependency. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover disabled:hover:bg-accent',
  secondary:
    'bg-surface text-fg border border-border-strong hover:bg-bg-subtle',
  ghost: 'text-fg-muted hover:bg-bg-inset hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      // aria-busy so screen readers announce the pending state; the spinner
      // alone communicates nothing to them.
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cx('animate-spin size-4 shrink-0', className)}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        // role=alert so the error is announced when it appears, not only when
        // the field is focused.
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      {...rest}
      className={cx(
        'w-full h-10 rounded-lg border bg-surface px-3 text-sm text-fg',
        'placeholder:text-fg-subtle transition-colors',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        invalid ? 'border-danger' : 'border-border-strong',
        className,
      )}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      {...rest}
      className={cx(
        'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-fg',
        'placeholder:text-fg-subtle resize-none',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        className,
      )}
    />
  );
});

export function Select({
  className,
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        'h-10 rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25',
        className,
      )}
    >
      {children}
    </select>
  );
}

// ---------------------------------------------------------------------------

export function Alert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'info' | 'success';
  children: React.ReactNode;
}) {
  const tones = {
    danger: 'bg-danger-subtle text-danger border-danger/30',
    info: 'bg-accent-subtle text-accent border-accent/30',
    success: 'bg-accent-subtle text-success border-success/30',
  };
  return (
    <div
      role="alert"
      className={cx('rounded-lg border px-3 py-2 text-sm', tones[tone])}
    >
      {children}
    </div>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        'rounded-xl border border-border bg-surface shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const tones = {
    neutral: 'bg-bg-inset text-fg-muted',
    accent: 'bg-accent-subtle text-accent',
    success: 'bg-accent-subtle text-success',
    warning: 'bg-accent-subtle text-warning',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <rect width="24" height="24" rx="7" fill="var(--accent)" />
        <path
          d="M6.5 9.5A3 3 0 0 1 9.5 6.5h5A3 3 0 0 1 17.5 9.5v3A3 3 0 0 1 14.5 15.5H10l-3.5 2.5v-8.5Z"
          fill="var(--accent-fg)"
        />
      </svg>
      <span className="font-semibold tracking-tight text-fg">SuperDesk</span>
    </span>
  );
}
