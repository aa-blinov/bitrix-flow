import { describe, expect, it } from 'vitest';
import { generatePassword, hashPassword, verifyPassword } from './password';
import { passwordProblem, validUsername } from './users';

describe('password', () => {
  it('accepts the right password and rejects a wrong one or a missing account', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('anything', undefined)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('generates a readable password without look-alike characters', () => {
    const password = generatePassword();
    expect(password).toHaveLength(16);
    expect(password).not.toMatch(/[01OIl]/);
  });
});

describe('account input', () => {
  it('enforces the password length and the login shape', () => {
    expect(passwordProblem('short')).toBe('PASSWORD_TOO_SHORT');
    expect(passwordProblem('long-enough-password')).toBeNull();
    expect(passwordProblem(12345)).toBe('BAD_PASSWORD');
    expect(validUsername('ivan.petrov')).toBe(true);
    expect(validUsername('Ivan')).toBe(false);
    expect(validUsername('a')).toBe(false);
    expect(validUsername('../etc')).toBe(false);
  });
});
