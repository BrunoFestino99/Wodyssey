import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, request } from './api';
import { copy } from './copy';

type Account = { email: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return copy.errors.validation;
    if (error.status === 401) return copy.errors.credentials;
    if (error.status === 429) return copy.errors.rateLimit;
  }
  return copy.errors.generic;
}

function Card({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
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

function ActionForm({
  action,
  label,
  children,
  secondary = false,
}: {
  action: (data: FormData) => Promise<void>;
  label: string;
  children?: ReactNode;
  secondary?: boolean;
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
      setError(errorMessage(failure));
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

function EmailField({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <>
      <label htmlFor="email">{copy.email}</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        defaultValue={defaultValue}
      />
    </>
  );
}

function PasswordField({
  isNew = false,
  label = copy.password,
}: {
  isNew?: boolean;
  label?: string;
}) {
  return (
    <>
      <label htmlFor="password">{label}</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete={isNew ? 'new-password' : 'current-password'}
        required
        minLength={isNew ? 12 : undefined}
        maxLength={128}
        aria-describedby={isNew ? 'password-hint' : undefined}
      />
      {isNew && (
        <p id="password-hint" className="hint">
          {copy.passwordHint}
        </p>
      )}
    </>
  );
}

function credentials(data: FormData) {
  return { email: String(data.get('email')).trim(), password: String(data.get('password')) };
}

function ResendVerification({ email }: { email?: string }) {
  const [sent, setSent] = useState(false);
  return (
    <>
      <ActionForm
        label={copy.resendVerification}
        secondary
        action={async (data) => {
          await request('/auth/verification/resend', {
            email: email ?? String(data.get('email')).trim(),
          });
          setSent(true);
        }}
      >
        {!email && (
          <EmailField defaultValue={sessionStorage.getItem('pending-verification-email') ?? ''} />
        )}
      </ActionForm>
      {sent && (
        <p className="success" role="status">
          {copy.resentVerification}
        </p>
      )}
    </>
  );
}

function Register() {
  const [registeredEmail, setRegisteredEmail] = useState('');
  if (registeredEmail)
    return (
      <Card eyebrow={copy.verificationEyebrow} title={copy.checkEmail}>
        <p className="lede">{copy.registrationConfirmation.replace('{email}', registeredEmail)}</p>
        <ResendVerification email={registeredEmail} />
        <p className="switch">
          <a href="/login">{copy.backToSignIn}</a>
        </p>
      </Card>
    );
  return (
    <Card eyebrow={copy.registrationEyebrow} title={copy.registrationTitle}>
      <p className="lede">{copy.registrationDescription}</p>
      <ActionForm
        label={copy.createAccount}
        action={async (data) => {
          const values = credentials(data);
          await request('/auth/register', values);
          sessionStorage.setItem('pending-verification-email', values.email);
          setRegisteredEmail(values.email);
        }}
      >
        <EmailField />
        <PasswordField isNew />
      </ActionForm>
      <p className="switch">
        {copy.existingAccount} <a href="/login">{copy.signIn}</a>
      </p>
    </Card>
  );
}

function Login() {
  return (
    <Card eyebrow={copy.loginEyebrow} title={copy.loginTitle}>
      <p className="lede">{copy.loginDescription}</p>
      <ActionForm
        label={copy.signIn}
        action={async (data) => {
          await request('/auth/login', credentials(data));
          window.location.assign('/home');
        }}
      >
        <EmailField />
        <PasswordField />
        <a className="forgot-link" href="/forgot">
          {copy.forgotPassword}
        </a>
      </ActionForm>
      <p className="switch">
        {copy.newAccount} <a href="/register">{copy.createAccount}</a>
      </p>
    </Card>
  );
}

function Verify() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState<'ready' | 'verified' | 'invalid'>(token ? 'ready' : 'invalid');
  const title =
    state === 'verified'
      ? copy.emailVerified
      : state === 'invalid'
        ? copy.invalidLinkTitle
        : copy.verifyTitle;
  return (
    <Card eyebrow={copy.emailVerificationEyebrow} title={title}>
      {state === 'ready' && (
        <>
          <p className="lede">{copy.verifyDescription}</p>
          <ActionForm
            label={copy.verifyEmail}
            action={async () => {
              try {
                await request('/auth/verification/consume', { token });
                setState('verified');
                window.history.replaceState({}, '', '/verify');
              } catch (error) {
                if (error instanceof ApiError && error.status === 400) setState('invalid');
                else throw error;
              }
            }}
          />
        </>
      )}
      {state === 'verified' && (
        <>
          <p className="lede">{copy.verifiedDescription}</p>
          <a className="primary button-link" href="/login">
            {copy.signIn}
          </a>
        </>
      )}
      {state === 'invalid' && (
        <>
          <p className="lede">{copy.invalidLinkDescription}</p>
          <ResendVerification />
          <p className="switch">
            <a href="/login">{copy.backToSignIn}</a>
          </p>
        </>
      )}
    </Card>
  );
}

function Forgot() {
  const [sent, setSent] = useState(false);
  return (
    <Card eyebrow={copy.recoveryEyebrow} title={sent ? copy.checkEmail : copy.resetTitle}>
      {sent ? (
        <p className="lede" role="status">
          {copy.resetSent}
        </p>
      ) : (
        <>
          <p className="lede">{copy.recoveryDescription}</p>
          <ActionForm
            label={copy.sendReset}
            action={async (data) => {
              await request('/auth/password/forgot', { email: String(data.get('email')).trim() });
              setSent(true);
            }}
          >
            <EmailField />
          </ActionForm>
        </>
      )}
      <p className="switch">
        <a href="/login">{copy.backToSignIn}</a>
      </p>
    </Card>
  );
}

function Reset() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState<'ready' | 'done' | 'invalid'>(token ? 'ready' : 'invalid');
  return (
    <Card
      eyebrow={copy.recoveryEyebrow}
      title={
        state === 'done'
          ? copy.passwordUpdated
          : state === 'invalid'
            ? copy.invalidLinkTitle
            : copy.choosePassword
      }
    >
      {state === 'done' ? (
        <>
          <p className="lede">{copy.passwordUpdatedDescription}</p>
          <a className="primary button-link" href="/login">
            {copy.signIn}
          </a>
        </>
      ) : state === 'invalid' ? (
        <>
          <p className="lede">{copy.errors.invalidLink}</p>
          <a className="primary button-link" href="/forgot">
            {copy.requestReset}
          </a>
        </>
      ) : (
        <>
          <p className="lede">{copy.newPasswordDescription}</p>
          <ActionForm
            label={copy.resetPassword}
            action={async (data) => {
              try {
                await request('/auth/password/reset', {
                  token,
                  password: String(data.get('password')),
                });
                setState('done');
                window.history.replaceState({}, '', '/reset');
              } catch (error) {
                if (error instanceof ApiError && error.status === 400) setState('invalid');
                else throw error;
              }
            }}
          >
            <PasswordField isNew label={copy.newPassword} />
          </ActionForm>
        </>
      )}
    </Card>
  );
}

function PrivateHome() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    request<Account>('/auth/me')
      .then((value) => {
        if (!cancelled) setAccount(value);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (failure instanceof ApiError && failure.status === 401)
          window.location.replace('/login');
        else setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  if (error)
    return (
      <Card eyebrow={copy.yourAccount} title={copy.connectionTitle}>
        <p className="error" role="alert">
          {copy.errors.generic}
        </p>
        <button
          className="primary"
          onClick={() => {
            setError(false);
            setAttempt(attempt + 1);
          }}
        >
          {copy.retry}
        </button>
      </Card>
    );
  if (!account)
    return (
      <div className="loading" role="status">
        {copy.loading}
      </div>
    );
  return (
    <Card eyebrow={copy.yourAccount} title={copy.privateTitle}>
      <p className="lede">{copy.privateDescription}</p>
      <p className="account-email">
        {copy.signedInAs} <strong>{account.email}</strong>
      </p>
      <ActionForm
        label={copy.signOut}
        secondary
        action={async () => {
          await request('/auth/logout', {});
          window.location.replace('/login');
        }}
      />
    </Card>
  );
}

export function App() {
  const screens: Record<string, ReactNode> = {
    '/': <PrivateHome />,
    '/home': <PrivateHome />,
    '/login': <Login />,
    '/register': <Register />,
    '/verify': <Verify />,
    '/forgot': <Forgot />,
    '/reset': <Reset />,
  };
  return (
    <main className="page">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true">
          W
        </span>
        <span>{copy.brand}</span>
      </header>
      {screens[window.location.pathname] ?? (
        <Card eyebrow={copy.brand} title={copy.notFound}>
          <a href="/">{copy.returnHome}</a>
        </Card>
      )}
      <footer>{copy.footer}</footer>
    </main>
  );
}
