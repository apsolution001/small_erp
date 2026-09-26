/**
 * Frequently breached passwords that pass the 10-character minimum (security standard: new
 * passwords are checked against a common-password list). Compared case-insensitively.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  '0000000000',
  '0123456789',
  '0987654321',
  '1111111111',
  '1122334455',
  '1234567890',
  '12345678910',
  '1234512345',
  '1234554321',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'aaaaaaaaaa',
  'abc1234567',
  'abcd123456',
  'abcdefghij',
  'admin12345',
  'admin@1234',
  'administrator',
  'asdfghjkl1',
  'asdfghjkl;',
  'changeme123',
  'football123',
  'iloveyou123',
  'india@1234',
  'india12345',
  'letmein123',
  'password01',
  'password12',
  'password123',
  'password1234',
  'password@1',
  'password@123',
  'passw0rd123',
  'princess123',
  'q1w2e3r4t5',
  'qwerty1234',
  'qwerty12345',
  'qwerty@123',
  'qwertyuiop',
  'sunshine123',
  'welcome123',
  'welcome@123',
  'zxcvbnm123',
]);

/** True for a password on the list, or one character repeated (`aaaaaaaaaaaa`). */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  return COMMON_PASSWORDS.has(lower) || /^(.)\1*$/su.test(password);
}
