export interface PasswordStrengthChecks {
  minLength: boolean;
  maxLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

export interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  checks: PasswordStrengthChecks;
  isValid: boolean;
  errors: string[];
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const value = String(password || '');
  const checks: PasswordStrengthChecks = {
    minLength: value.length >= 8,
    maxLength: value.length <= 128,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9]/.test(value),
  };

  const errors: string[] = [];
  if (!checks.minLength) errors.push('Use at least 8 characters');
  if (!checks.maxLength) errors.push('Use at most 128 characters');
  if (!checks.uppercase) errors.push('Include an uppercase letter (A-Z)');
  if (!checks.lowercase) errors.push('Include a lowercase letter (a-z)');
  if (!checks.number) errors.push('Include a number (0-9)');
  if (!checks.special) errors.push('Include a special character (!@#$%^&*...)');

  let metCount = 0;
  if (checks.minLength) metCount += 1;
  if (checks.uppercase && checks.lowercase) metCount += 1;
  if (checks.number) metCount += 1;
  if (checks.special) metCount += 1;

  const isValid =
    checks.minLength &&
    checks.maxLength &&
    checks.uppercase &&
    checks.lowercase &&
    checks.number &&
    checks.special;

  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (value.length === 0) {
    score = 0;
  } else if (metCount <= 1 || !checks.minLength) {
    score = 1;
  } else if (metCount === 2) {
    score = 2;
  } else if (metCount === 3 || !isValid) {
    score = 3;
  } else {
    score = 4;
  }

  const label: PasswordStrengthResult['label'] =
    score <= 1 ? 'Weak' : score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';

  return {
    score,
    label,
    checks,
    isValid,
    errors,
  };
}

export function getPasswordValidationError(password: string): string | null {
  const result = evaluatePasswordStrength(password);
  if (result.isValid) return null;
  if (!result.checks.maxLength) {
    return 'Password must be 128 characters or fewer.';
  }
  return `Password does not meet security requirements: ${result.errors.join(', ')}.`;
}
