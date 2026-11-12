import { useState, type ReactNode } from 'react';
import { ApiError, request } from './api';
import { ActionForm, Card, CardPage } from './components';
import { copy } from './copy';
import { AcceptInvitation } from './accept-invitation';
import { NewOrganization, OrganizationWorkspace, PrivateHome } from './organizations';
import { pathAfterSignIn } from './pending-invitation';

/** An email address suggested by the link that opened the screen, such as an invitation. */
const suggestedEmail = () => new URLSearchParams(window.location.search).get('email') ?? '';

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
        <EmailField defaultValue={suggestedEmail()} />
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
          window.location.assign(pathAfterSignIn());
        }}
      >
        <EmailField defaultValue={suggestedEmail()} />
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

const ORGANIZATION_PATH = /^\/organizations\/([^/]+)\/?$/;

export function App() {
  const path = window.location.pathname;
  const accountScreens: Record<string, ReactNode> = {
    '/login': <Login />,
    '/register': <Register />,
    '/verify': <Verify />,
    '/forgot': <Forgot />,
    '/reset': <Reset />,
  };
  if (accountScreens[path]) return <CardPage>{accountScreens[path]}</CardPage>;
  if (path === '/' || path === '/home') return <PrivateHome />;
  if (path === '/organizations/new') return <NewOrganization />;
  if (path === '/invitations') return <AcceptInvitation />;
  const organization = ORGANIZATION_PATH.exec(path);
  if (organization) return <OrganizationWorkspace id={decodeURIComponent(organization[1])} />;
  return (
    <CardPage>
      <Card eyebrow={copy.brand} title={copy.notFound}>
        <a href="/">{copy.returnHome}</a>
      </Card>
    </CardPage>
  );
}
