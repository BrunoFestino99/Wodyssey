import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, redirectIfSignedOut, request } from './api';
import { copy } from './copy';

export function errorMessage(error: unknown, validation: string = copy.errors.validation): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return validation;
    if (error.status === 401) return copy.errors.credentials;
    if (error.status === 429) return copy.errors.rateLimit;
  }
  return copy.errors.generic;
}

/** Focuses a screen's main heading when it appears so screen readers announce it. */
export function useFocusOnChange<T extends HTMLElement>(key: unknown) {
  const element = useRef<T>(null);
  useEffect(() => {
    element.current?.focus({ preventScroll: true });
  }, [key]);
  return element;
}

export function Brand() {
  return (
    <>
      <span className="brand-mark" aria-hidden="true">
        W
      </span>
      <span className="brand-name">{copy.brand}</span>
    </>
  );
}

/** Centered single-card layout used by account and onboarding screens. */
export function CardPage({ children }: { children: ReactNode }) {
  return (
    <main className="page">
      <header className="brand">
        <Brand />
      </header>
      {children}
      <footer>{copy.footer}</footer>
    </main>
  );
}

export function Card({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const heading = useFocusOnChange<HTMLHeadingElement>(title);
  return (
    <section className="card">
      <p className="eyebrow">{eyebrow}</p>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </section>
  );
}

export function ActionForm({
  action,
  label,
  children,
  secondary = false,
  validationMessage,
}: {
  action: (data: FormData) => Promise<void>;
  label: string;
  children?: ReactNode;
  secondary?: boolean;
  validationMessage?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await action(data);
    } catch (failure) {
      setError(errorMessage(failure, validationMessage));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} aria-busy={pending}>
      <fieldset disabled={pending}>{children}</fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className={secondary ? 'secondary' : 'primary'} type="submit" disabled={pending}>
        {pending ? copy.working : label}
      </button>
    </form>
  );
}

export type SignedInLoad<T> =
  { state: 'loading' } | { state: 'failed'; retry: () => void } | { state: 'ready'; data: T };

/**
 * Loads data that requires a session. Signed-out visitors are sent to sign in;
 * other failures can be retried. `load` must be memoized by the caller.
 */
export function useSignedInLoad<T>(load: () => Promise<T>): SignedInLoad<T> {
  const [result, setResult] = useState<{ attempt: number; data?: T; failed?: true }>({
    attempt: 0,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setResult({ attempt, data });
      })
      .catch((failure: unknown) => {
        if (cancelled || redirectIfSignedOut(failure)) return;
        setResult({ attempt, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);
  if (result.attempt !== attempt) return { state: 'loading' };
  if (result.failed) return { state: 'failed', retry: () => setAttempt(attempt + 1) };
  if (result.data === undefined) return { state: 'loading' };
  return { state: 'ready', data: result.data };
}

/** Loading and retry screens shared by every signed-in page. */
export function PendingLoad({
  load,
}: {
  load: Exclude<SignedInLoad<unknown>, { state: 'ready' }>;
}) {
  if (load.state === 'loading')
    return (
      <CardPage>
        <div className="loading" role="status">
          {copy.loading}
        </div>
      </CardPage>
    );
  return (
    <CardPage>
      <Card eyebrow={copy.yourAccount} title={copy.connectionTitle}>
        <p className="error" role="alert">
          {copy.errors.generic}
        </p>
        <button className="primary" onClick={load.retry}>
          {copy.retry}
        </button>
      </Card>
    </CardPage>
  );
}

export function SignOutForm() {
  return (
    <ActionForm
      label={copy.signOut}
      secondary
      action={async () => {
        await request('/auth/logout', {});
        window.location.replace('/login');
      }}
    />
  );
}
