import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { copy } from './copy';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
type Account = { email: string };

async function send(path: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function errorMessage(status: number): string {
  if (status === 400) return copy.errors.invalidLink;
  if (status === 401) return copy.errors.credentials;
  if (status === 429) return copy.errors.rateLimit;
  return copy.errors.generic;
}

function Page({ children }: { children: ReactNode }) {
  return <main className="page"><header className="brand"><span className="brand-mark" aria-hidden="true">W</span><span>{copy.brand}</span></header>{children}<footer>{copy.footer}</footer></main>;
}

function Card({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <section className="card"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</section>;
}

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  function navigate(href: string) {
    window.history.pushState({}, '', href);
    setPath(window.location.pathname);
  }

  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);

  useEffect(() => {
    let active = true;
    send('/auth/me').then(async (response) => {
      if (active && response.ok) setAccount(await response.json() as Account);
      if (active) setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);

  if (loading) return <Page><div className="loading" role="status">{copy.loading}</div></Page>;
  if (path === '/verify') return <Verify navigate={navigate} />;
  if (path === '/reset') return <Reset navigate={navigate} />;
  if (path === '/forgot') return <Forgot navigate={navigate} />;
  if (account && path !== '/login' && path !== '/register') return <PrivateHome account={account} onSignOut={async () => { await send('/auth/logout', {}); setAccount(null); navigate('/login'); }} />;
  if (path === '/register') return <Register navigate={navigate} />;
  return <Login navigate={navigate} />;
}

function Register({ navigate }: { navigate: (href: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try {
      const response = await send('/auth/register', { email, password });
      if (!response.ok) { setError(errorMessage(response.status)); return; }
      sessionStorage.setItem('pending-verification-email', email.trim().toLowerCase());
      setSubmitted(true);
    } catch { setError(errorMessage(500)); }
  }
  if (submitted) return <Page><Card eyebrow={copy.verificationEyebrow} title={copy.checkEmail}><p className="lede">{copy.registrationConfirmation.replace('{email}', email)}</p><button className="text-button" onClick={() => navigate('/login')}>{copy.backToSignIn}</button></Card></Page>;
  return <Page><Card eyebrow={copy.registrationEyebrow} title={copy.registrationTitle}><p className="lede">{copy.registrationDescription}</p><form onSubmit={submit}>
    <label htmlFor="email">{copy.email}</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
    <label htmlFor="password">{copy.password}</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><p className="hint">{copy.passwordHint}</p>
    {error && <p className="error" role="alert">{error}</p>}<button className="primary" type="submit">{copy.createAccount}</button>
  </form><p className="switch">{copy.existingAccount} <a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>{copy.signIn}</a></p></Card></Page>;
}

function Login({ navigate }: { navigate: (href: string) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    try { const response = await send('/auth/login', { email, password }); if (!response.ok) { setError(errorMessage(response.status)); return; } window.history.pushState({}, '', '/home'); window.dispatchEvent(new PopStateEvent('popstate')); }
    catch { setError(errorMessage(500)); }
  }
  return <Page><Card eyebrow={copy.loginEyebrow} title={copy.loginTitle}><p className="lede">{copy.loginDescription}</p><form onSubmit={submit}>
    <label htmlFor="email">{copy.email}</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
    <div className="label-row"><label htmlFor="password">{copy.password}</label><a href="/forgot" onClick={(event) => { event.preventDefault(); navigate('/forgot'); }}>{copy.forgotPassword}</a></div><input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
    {error && <p className="error" role="alert">{error}</p>}<button className="primary" type="submit">{copy.signIn}</button>
  </form><p className="switch">{copy.newAccount} <a href="/register" onClick={(event) => { event.preventDefault(); navigate('/register'); }}>{copy.createAccount}</a></p></Card></Page>;
}

function Verify({ navigate }: { navigate: (href: string) => void }) {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [state, setState] = useState<'loading' | 'verified' | 'invalid'>('loading');
  const [resent, setResent] = useState(false);
  const [email, setEmail] = useState(() => sessionStorage.getItem('pending-verification-email') ?? '');
  const [error, setError] = useState('');
  useEffect(() => { send('/auth/verification/consume', { token }).then((response) => setState(response.ok ? 'verified' : 'invalid')).catch(() => setState('invalid')); }, [token]);
  async function resend(event: FormEvent) { event.preventDefault(); setError(''); try { const response = await send('/auth/verification/resend', { email }); if (!response.ok) { setError(errorMessage(response.status)); return; } setResent(true); sessionStorage.setItem('pending-verification-email', email.trim().toLowerCase()); } catch { setError(errorMessage(500)); } }
  return <Page><Card eyebrow={copy.emailVerificationEyebrow} title={state === 'loading' ? copy.verifying : state === 'verified' ? copy.emailVerified : copy.invalidLinkTitle}>
    {state === 'verified' ? <><p className="lede">{copy.verifiedDescription}</p><button className="primary" onClick={() => navigate('/login')}>{copy.signIn}</button></> : state === 'invalid' ? <><p className="lede">{copy.invalidLinkDescription}</p>{resent ? <p className="success" role="status">{copy.resentVerification}</p> : <form onSubmit={resend}><label htmlFor="email">{copy.email}</label><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />{error && <p className="error" role="alert">{error}</p>}<button className="primary" type="submit">{copy.resendVerification}</button></form>}<p className="switch"><a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>{copy.backToSignIn}</a></p></> : <p className="lede">{copy.verifyingDescription}</p>}
  </Card></Page>;
}

function Forgot({ navigate }: { navigate: (href: string) => void }) {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); try { const response = await send('/auth/password/forgot', { email }); if (!response.ok) { setError(errorMessage(response.status)); return; } setSent(true); } catch { setError(errorMessage(500)); } }
  return <Page><Card eyebrow={copy.recoveryEyebrow} title={copy.resetTitle}>{sent ? <><p className="lede">{copy.resetSent}</p><p className="switch"><a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>{copy.backToSignIn}</a></p></> : <><p className="lede">{copy.recoveryDescription}</p><form onSubmit={submit}><label htmlFor="email">{copy.email}</label><input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />{error && <p className="error" role="alert">{error}</p>}<button className="primary" type="submit">{copy.sendReset}</button></form><p className="switch"><a href="/login" onClick={(event) => { event.preventDefault(); navigate('/login'); }}>{copy.backToSignIn}</a></p></>}</Card></Page>;
}

function Reset({ navigate }: { navigate: (href: string) => void }) {
  const [password, setPassword] = useState(''); const [done, setDone] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) { event.preventDefault(); setError(''); try { const response = await send('/auth/password/reset', { token: new URLSearchParams(window.location.search).get('token'), password }); if (!response.ok) { setError(errorMessage(response.status)); return; } setDone(true); } catch { setError(errorMessage(500)); } }
  return <Page><Card eyebrow={copy.recoveryEyebrow} title={done ? copy.passwordUpdated : copy.choosePassword}>{done ? <><p className="lede">{copy.passwordUpdatedDescription}</p><button className="primary" onClick={() => navigate('/login')}>{copy.signIn}</button></> : <form onSubmit={submit}><label htmlFor="password">{copy.newPassword}</label><input id="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /><p className="hint">{copy.passwordHint}</p>{error && <p className="error" role="alert">{error}</p>}<button className="primary" type="submit">{copy.resetPassword}</button></form>}</Card></Page>;
}

function PrivateHome({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
  return <Page><Card eyebrow={copy.yourAccount} title={copy.privateTitle}><p className="lede">{copy.privateDescription}</p><p className="account-email">{copy.signedInAs} <strong>{account.email}</strong></p><button className="secondary" onClick={onSignOut}>{copy.signOut}</button></Card></Page>;
}

export { App };
