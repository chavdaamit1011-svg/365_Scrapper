/**
 * ==============================================================================
 * The screpper - Reusable Validation Rules & Helpers
 * ==============================================================================
 * Centralized, strict validation logic for:
 * 1. Username
 * 2. Password (Upper, Lower, Number, Special Character, Min length)
 * 3. Phone Number (Digits only, valid format, length)
 * 4. Email address
 */

export interface PasswordRuleResult {
  hasMinLength: boolean;
  hasUpperCase: boolean;
  hasLowerCase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  hasNoSpaces: boolean;
  score: number; // 0 to 100
  isValid: boolean;
  errors: string[];
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * Strict Password Validator
 * Requirements:
 * - At least 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 lowercase letter (a-z)
 * - At least 1 number (0-9)
 * - At least 1 special character (!@#$%^&*()_+-=[]{};':"|,.<>/?)
 * - No whitespace allowed
 */
export function validatePassword(password: string): PasswordRuleResult {
  const minLength = 8;
  const hasMinLength = (password || '').length >= minLength;
  const hasUpperCase = /[A-Z]/.test(password || '');
  const hasLowerCase = /[a-z]/.test(password || '');
  const hasNumber = /[0-9]/.test(password || '');
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password || '');
  const hasNoSpaces = !/\s/.test(password || '') && (password || '').length > 0;

  const errors: string[] = [];
  if (!hasMinLength) errors.push(`Password must be at least ${minLength} characters.`);
  if (!hasUpperCase) errors.push('Must include at least one uppercase letter (A-Z).');
  if (!hasLowerCase) errors.push('Must include at least one lowercase letter (a-z).');
  if (!hasNumber) errors.push('Must include at least one number (0-9).');
  if (!hasSpecialChar) errors.push('Must include at least one special character (!@#$%^&* etc).');
  if (!hasNoSpaces) errors.push('Spaces are not allowed in password.');

  const passedCount = [
    hasMinLength,
    hasUpperCase,
    hasLowerCase,
    hasNumber,
    hasSpecialChar,
    hasNoSpaces,
  ].filter(Boolean).length;

  const score = Math.round((passedCount / 6) * 100);
  const isValid = passedCount === 6;

  return {
    hasMinLength,
    hasUpperCase,
    hasLowerCase,
    hasNumber,
    hasSpecialChar,
    hasNoSpaces,
    score,
    isValid,
    errors,
  };
}

/**
 * Strict Username Validator
 * Rules:
 * - Minimum 4 characters, maximum 20
 * - Must start with an alphabet letter (a-z, A-Z)
 * - Only alphanumeric characters, dots, underscores, and hyphens allowed
 * - No spaces allowed
 * - Cannot end with a special character or dot
 */
export function validateUsername(username: string): ValidationResult {
  if (!username || username.trim().length === 0) {
    return { isValid: false, error: 'Username is required.' };
  }

  const clean = username.trim().toLowerCase();

  if (clean.length < 4) {
    return { isValid: false, error: 'Username must be at least 4 characters long.' };
  }

  if (clean.length > 20) {
    return { isValid: false, error: 'Username cannot exceed 20 characters.' };
  }

  if (/\s/.test(clean)) {
    return { isValid: false, error: 'Username cannot contain spaces.' };
  }

  if (!/^[a-zA-Z]/.test(clean)) {
    return { isValid: false, error: 'Username must begin with a letter (A-Z).' };
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(clean)) {
    return {
      isValid: false,
      error: 'Username can only contain letters, numbers, hyphens, and underscores.',
    };
  }

  return { isValid: true, normalized: clean };
}

/**
 * Strict Phone Number Validator
 * Rules:
 * - Accepts 10 digits Indian mobile format (starts with 6,7,8,9)
 * - Or international format with +countryCode (10-15 digits total)
 * - Digits only (ignoring standard spaces or hyphens for friendly input)
 * - Strict length check
 */
export function validatePhoneNumber(phone: string): ValidationResult {
  if (!phone || phone.trim().length === 0) {
    return { isValid: false, error: 'Phone number is required.' };
  }

  // Remove spaces, hyphens, brackets
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // Check if non-digits exist (except optional leading +)
  if (!/^\+?[0-9]+$/.test(cleaned)) {
    return { isValid: false, error: 'Phone number must contain numbers only.' };
  }

  // Pure 10-digit format (Common Indian/US 10-digit)
  if (/^[0-9]{10}$/.test(cleaned)) {
    // Check Indian mobile starter (6,7,8,9)
    if (!/^[6-9][0-9]{9}$/.test(cleaned)) {
      return {
        isValid: false,
        error: '10-digit mobile number must start with 6, 7, 8, or 9.',
      };
    }
    return { isValid: true, normalized: cleaned };
  }

  // International format with +91 or other +code (e.g. +919876543210)
  if (cleaned.startsWith('+')) {
    const digitsOnly = cleaned.substring(1);
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      return {
        isValid: false,
        error: 'International phone number must be between 10 and 15 digits.',
      };
    }
    return { isValid: true, normalized: cleaned };
  }

  // If 11 or 12 digits starting with 91 or 0
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const tenDigits = cleaned.substring(1);
    if (/^[6-9][0-9]{9}$/.test(tenDigits)) {
      return { isValid: true, normalized: tenDigits };
    }
  }

  if (cleaned.startsWith('91') && cleaned.length === 12) {
    const tenDigits = cleaned.substring(2);
    if (/^[6-9][0-9]{9}$/.test(tenDigits)) {
      return { isValid: true, normalized: tenDigits };
    }
  }

  return {
    isValid: false,
    error: 'Enter a valid 10-digit mobile number (e.g. 9876543210).',
  };
}

/**
 * Strict Email Validator
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || email.trim().length === 0) {
    return { isValid: false, error: 'Email is required.' };
  }

  const clean = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  if (!emailRegex.test(clean)) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  return { isValid: true, normalized: clean };
}

/**
 * Identifier detector: Determines whether the login input is a Phone Number or Username
 */
export function detectIdentifierType(input: string): 'phone' | 'username' {
  const clean = input.trim();
  const digitsOnly = clean.replace(/[\s\-\(\)\+]/g, '');

  // If majority of characters are digits and length is around 10-12, treat as phone
  if (/^\+?[0-9\s\-]+$/.test(clean) && digitsOnly.length >= 7) {
    return 'phone';
  }
  return 'username';
}

