import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id at OWASP's recommended baseline: 19 MiB memory, 2 iterations,
 * 1 degree of parallelism.
 *
 * Chosen over bcrypt because bcrypt silently truncates at 72 bytes and is
 * cheap to attack on GPUs; Argon2's memory cost is what makes parallel
 * cracking expensive. Roughly 50ms per hash on the deploy target — slow enough
 * to matter to an attacker, fast enough that login doesn't feel sluggish.
 */
const PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

export async function verifyPassword(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // A malformed hash in the database is a failed login, not a 500.
    return false;
  }
}

/**
 * Burns roughly the same time as a real verification.
 *
 * Called when the email doesn't exist so that "unknown user" and "wrong
 * password" take the same wall-clock time. Without it, response timing tells
 * an attacker which email addresses have accounts.
 */
export async function fakeVerify(): Promise<void> {
  await verifyPassword(
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd',
    'timing-equalizer',
  );
}
