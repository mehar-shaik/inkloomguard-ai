import React, { useState } from 'react';
import { ArrowRight, Lock, Mail, Building2, UserCheck, Shield } from 'lucide-react';
import { api } from '../api';
import { ThemeToggle } from '../components/ClayUI';
import shieldEmblem from '/src/assets/images/inkloom_shield_emblem_1794725371250.jpg';

export function AuthPage({
  onAuthSuccess,
  theme,
  onToggleTheme,
  sessionNotice,
}: {
  onAuthSuccess: (token: string) => Promise<void>;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  sessionNotice?: string;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'reviewer' | 'author'>('reviewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({ name, email, password, companyName, role });
      if (!res.token) {
        throw new Error('Authentication server did not issue a session token.');
      }
      await onAuthSuccess(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin() {
    setError('');
    setLoading(true);
    try {
      const res = await api.demoLogin();
      if (!res.token) {
        throw new Error('Authentication server did not issue a session token.');
      }
      await onAuthSuccess(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo workspace login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      {/* Subtle atmospheric spheres matching Claymorphic Compliance */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-28 -left-28 w-96 h-96 rounded-full bg-indigo-300/30 dark:bg-violet-700/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-32 -right-24 w-[28rem] h-[28rem] rounded-full bg-violet-300/25 dark:bg-sky-600/15 blur-3xl"
      />

      <header className="max-w-6xl w-full mx-auto flex items-center justify-between gap-4 relative z-10">
        <div className="flex items-center gap-3">
          <img
            src={shieldEmblem}
            alt="InkloomGuard AI Shield"
            referrerPolicy="no-referrer"
            className="w-10 h-10 rounded-2xl object-cover shadow-md border border-white/80 dark:border-violet-400/30"
          />
          <span className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap">
            InkloomGuard AI
          </span>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </header>

      <main className="max-w-5xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch relative z-10">
        {/* Left Brand Presentation */}
        <section className="lg:col-span-6 clay-surface rounded-[28px] p-8 sm:p-10 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-violet-300 mb-3">
              Enterprise Brand Governance
            </p>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight [text-wrap:balance] mb-4">
              Deterministic rules meet intelligent brand compliance.
            </h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed mb-8">
              Upload official brand guidelines, verify terminology and approved company facts, audit marketing copy and visual assets across eight governance areas, and route revisions through human sign-off.
            </p>
          </div>

          <div className="clay-well rounded-3xl p-6 flex items-center gap-5">
            <img
              src={shieldEmblem}
              alt="InkloomGuard AI 3D Compliance Shield"
              referrerPolicy="no-referrer"
              className="w-20 h-20 rounded-2xl object-cover shrink-0 shadow-md"
            />
            <div className="space-y-1.5 text-sm">
              <p className="font-bold text-slate-900 dark:text-slate-100">
                Strict Evidence Grounding
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Every flagged issue cites your exact uploaded guideline rules or approved company facts—never fabricated claims, with full organization tenant isolation.
              </p>
            </div>
          </div>
        </section>

        {/* Right Auth Form */}
        <section className="lg:col-span-6 clay-surface rounded-[28px] p-8 sm:p-10 flex flex-col justify-center">
          <div className="flex items-center gap-2 p-1.5 clay-well rounded-full mb-7">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`flex-1 py-2.5 px-4 rounded-full text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                mode === 'login'
                  ? 'clay-btn-primary'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`flex-1 py-2.5 px-4 rounded-full text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                mode === 'register'
                  ? 'clay-btn-primary'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          {sessionNotice && (
            <div
              role="status"
              className="mb-4 rounded-2xl px-4 py-3 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30"
            >
              {sessionNotice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                    Full Name
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jordan Mercer"
                      className="clay-well w-full rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                      Company / Organization
                    </label>
                    <div className="relative">
                      <Building2 className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="Northstar Studio"
                        className="clay-well w-full rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                      Workspace Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'reviewer' | 'author')}
                      className="clay-well w-full rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value="reviewer">Brand Reviewer & Admin</option>
                      <option value="author">Content Author</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="clay-well w-full rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="clay-well w-full rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-2xl px-4 py-3 text-xs font-semibold bg-red-50 text-red-800 border border-red-200 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-400/30"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="clay-btn-primary w-full rounded-full py-3.5 px-6 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading ? 'Authenticating...' : mode === 'login' ? 'Sign In to InkloomGuard AI' : 'Create Organization Workspace'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-200/80 dark:border-violet-400/20">
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={loading}
              className="clay-btn-secondary w-full rounded-full py-3 px-5 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <Shield className="w-4 h-4 text-indigo-600 dark:text-violet-300" />
              Sign In to Pre-Seeded Organization (AetherFlow Systems)
            </button>
          </div>
        </section>
      </main>

      <footer className="max-w-6xl w-full mx-auto text-center text-xs text-slate-500 dark:text-slate-400 relative z-10">
        InkloomGuard AI · Multi-Tenant Brand Compliance Platform
      </footer>
    </div>
  );
}
