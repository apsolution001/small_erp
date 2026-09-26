import { randomInt } from 'node:crypto';
import { computeGstinChecksum } from '@ekaro/core';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
const letter = (): string => LETTERS.charAt(randomInt(LETTERS.length));
const digits = (n: number): string => String(randomInt(10 ** n)).padStart(n, '0');

/** A valid GSTIN from a state code and PAN (entity 1, `Z`, computed check character). */
export function gstinOf(stateCode: string, pan: string): string {
  const body = `${stateCode}${pan}1Z`;
  return `${body}${computeGstinChecksum(body)}`;
}

/**
 * A random, valid GSTIN of a company (PAN holder type `C`) that the mock GSP reports as Active.
 * Random so test files never share a registration.
 */
export function activeGstin(stateCode = '27'): string {
  return gstinOf(stateCode, `${letter()}${letter()}${letter()}C${letter()}${digits(4)}${letter()}`);
}

/** A valid GSTIN the mock GSP reports as Cancelled (PAN starting with ZZZZZ). */
export function cancelledGstin(stateCode = '27'): string {
  return gstinOf(stateCode, `ZZZZZ${digits(4)}${letter()}`);
}
