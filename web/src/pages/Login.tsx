import { useState } from 'react';
import { auth, ApiError } from '../api';
import { go, linkProps } from '../router';
import { Logo } from '../ui';

export default function Login({ mode: initial, next }: { mode: 'in' | 'up'; next: string }) {
  const [mode, setMode] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/boards';

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (mode === 'up' && password.length < 8) return setErr('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      if (mode === 'up') await auth.signup(name, email, password); else await auth.login(email, password);
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
        <form className="auth-form" onSubmit={submit} noValidate>
          <h1>{mode === 'up' ? 'Create your account' : 'Welcome back'}</h1>
          <p className="muted">{mode === 'up' ? 'Free, and it takes a few seconds.' : 'Sign in to get back to your boards.'}</p>
          {mode === 'up' && (
            <label className="field"><span>Your name</span>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Musty" required />
            </label>
          )}
          <label className="field"><span>Email</span>
            <input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@email.com" required />
          </label>
          <label className="field"><span>Password</span>
            <div className="pw">
              <input id="password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} placeholder={mode === 'up' ? 'At least 8 characters' : 'Your password'} required />
              <button type="button" className="textbtn" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </label>
          {err && <p className="form-err" role="alert">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}</button>
          <p className="switch">
            {mode === 'up' ? 'Already have an account?' : 'New to Tessel?'}{' '}
            <button type="button" className="textbtn" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setErr(''); }}>{mode === 'up' ? 'Sign in' : 'Create an account'}</button>
          </p>
          <a className="try-link" {...linkProps('/try')}>Or try a board without an account</a>
        </form>
      </main>
    </div>
  );
}
