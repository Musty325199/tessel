import { useEffect, useState } from 'react';
import { auth, ApiError } from '../api';
import { go, href, linkProps } from '../router';
// change the address without remounting the page, so what was typed stays
const setUrl = (p: string) => history.replaceState(null, '', href(p));
import { Logo } from '../ui';

type Mode = 'in' | 'up' | 'forgot' | 'reset';
export default function Login({ mode: initial, next, token: urlToken }: { mode: Mode; next: string; token?: string }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [token] = useState(urlToken || '');
  const [sent, setSent] = useState(false);
  // the reset secret shouldn't stay in the address bar or browser history
  useEffect(() => { if (initial === 'reset' && location.search) history.replaceState(null, '', location.pathname); }, [initial]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/boards';

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if ((mode === 'up' || mode === 'reset') && password.length < 8) return setErr('Use at least 8 characters for your password.');
    if (mode === 'forgot' && !/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Enter the email you signed up with.');
    setBusy(true);
    try {
      if (mode === 'forgot') { await auth.forgot(email.trim()); setSent(true); setBusy(false); return; }
      if (mode === 'reset') await auth.reset(token, password);
      else if (mode === 'up') await auth.signup(name, email, password); else await auth.login(email, password);
      go(dest, true);
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-side" aria-hidden="true">
        <div className="auth-art">
          <div className="art-note n1">Plan the launch</div>
          <div className="art-note n2">Ask the team</div>
          <div className="art-note n3">Ship it Friday</div>
          <svg className="art-line" viewBox="0 0 300 200"><path d="M40 150 C 110 60, 190 190, 270 70" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" /></svg>
          <div className="art-cursor c1"><svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 2l15 7.2-6.5 1.9L7 18z" fill="#FF5A4E" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg><span>Tolu</span></div>
          <div className="art-cursor c2"><svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 2l15 7.2-6.5 1.9L7 18z" fill="#12B5A6" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" /></svg><span>Kemi</span></div>
        </div>
        <p className="auth-quote">Your notes, your team’s cursors, all on one board.</p>
      </div>

      <main className="auth-main">
        <Logo />
        {mode === 'forgot' && sent ? (
          <div className="auth-form" role="status">
            <h1>Check your email</h1>
            <p className="muted">If <b>{email.trim()}</b> has a Tessel account, a link to choose a new password is on its way. It works for 30 minutes. Check spam if you don’t see it.</p>
            <button className="btn primary block" onClick={() => { setMode('in'); setSent(false); setUrl('/login'); }}>Back to sign in</button>
            <p className="switch">Wrong email? <button type="button" className="textbtn" onClick={() => setSent(false)}>Try again</button></p>
          </div>
        ) : mode === 'reset' && !token ? (
          <div className="auth-form">
            <h1>This link isn’t complete</h1>
            <p className="muted">Open the newest reset email and tap the button again, or ask for a new link.</p>
            <button className="btn primary block" onClick={() => { setMode('forgot'); setUrl('/forgot'); }}>Send a new link</button>
          </div>
        ) : (
        <form className="auth-form" onSubmit={submit} noValidate>
          <h1>{mode === 'up' ? 'Create your account' : mode === 'forgot' ? 'Forgot your password?' : mode === 'reset' ? 'Choose a new password' : 'Welcome back'}</h1>
          <p className="muted">{mode === 'up' ? 'Free, and it takes a few seconds.' : mode === 'forgot' ? 'Enter your email and we’ll send you a link to set a new one.' : mode === 'reset' ? 'You’ll be signed in straight after. Other devices get signed out.' : 'Sign in to get back to your boards.'}</p>
          {mode === 'up' && (
            <label className="field"><span>Your name</span>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Musty" required />
            </label>
          )}
          {mode !== 'reset' && (
            <label className="field"><span>Email</span>
              <input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@email.com" required />
            </label>
          )}
          {mode !== 'forgot' && (
            <label className="field"><span className="field-row">{mode === 'reset' ? 'New password' : 'Password'}{mode === 'in' && <button type="button" className="textbtn small" onClick={() => { setMode('forgot'); setErr(''); setUrl('/forgot'); }}>Forgot password?</button>}</span>
              <div className="pw">
                <input id="password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder={mode === 'in' ? 'Your password' : 'At least 8 characters'} required />
                <button type="button" className="textbtn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
              </div>
            </label>
          )}
          {err && <p className="form-err" role="alert">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'One moment…' : mode === 'up' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save and sign in' : 'Sign in'}</button>
          {mode === 'forgot' || mode === 'reset' ? (
            <p className="switch">Remembered it? <button type="button" className="textbtn" onClick={() => { setMode('in'); setErr(''); setUrl('/login'); }}>Sign in</button></p>
          ) : (
            <p className="switch">
              {mode === 'up' ? 'Already have an account?' : 'New to Tessel?'}{' '}
              <button type="button" className="textbtn" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setErr(''); }}>{mode === 'up' ? 'Sign in' : 'Create an account'}</button>
            </p>
          )}
          {(mode === 'in' || mode === 'up') && <a className="try-link" {...linkProps('/try')}>Or try a board without an account</a>}
        </form>
        )}
      </main>
    </div>
  );
}
