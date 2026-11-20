import React, { useState } from 'react';
import { Eye, EyeOff, Lock, CheckCircle2, Circle } from 'lucide-react';
import { evaluatePasswordStrength } from '../utils/password';

export function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder = 'Enter password',
  required = true,
  autoComplete,
  showStrength = false,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  showStrength?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? evaluatePasswordStrength(value) : null;

  const barColor =
    !strength || strength.score <= 1
      ? 'bg-rose-500'
      : strength.score === 2
        ? 'bg-amber-500'
        : strength.score === 3
          ? 'bg-sky-500'
          : 'bg-emerald-500';

  const labelColor =
    !strength || strength.score <= 1
      ? 'text-rose-700 dark:text-rose-300'
      : strength.score === 2
        ? 'text-amber-700 dark:text-amber-300'
        : strength.score === 3
          ? 'text-sky-700 dark:text-sky-300'
          : 'text-emerald-700 dark:text-emerald-300';

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </label>
      <div className="relative">
        <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="clay-well w-full rounded-2xl pl-11 pr-11 py-3 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 cursor-pointer"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {showStrength && strength && value.length > 0 && (
        <div className="clay-well rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-300">Password strength</span>
            <span className={`font-bold ${labelColor}`}>{strength.label}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-colors ${
                  strength.score >= step ? barColor : 'bg-slate-200 dark:bg-slate-700/70'
                }`}
              />
            ))}
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] pt-0.5">
            {[
              { ok: strength.checks.minLength, text: '8+ characters' },
              { ok: strength.checks.uppercase, text: 'Uppercase letter (A-Z)' },
              { ok: strength.checks.lowercase, text: 'Lowercase letter (a-z)' },
              { ok: strength.checks.number, text: 'Number (0-9)' },
              { ok: strength.checks.special, text: 'Special character (!@#$)' },
            ].map((item) => (
              <li
                key={item.text}
                className={`flex items-center gap-1.5 ${
                  item.ok
                    ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {item.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Circle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
