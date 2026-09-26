import { isIPv4, isIPv6 } from 'node:net';

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** The 8 groups of an IPv6 address (zone id removed, `::` and a dotted IPv4 tail expanded). */
function ipv6Groups(address: string): number[] {
  const bare = address.split('%')[0] ?? '';
  const [head = '', tail] = bare.split('::');
  const parse = (part: string): number[] =>
    part === ''
      ? []
      : part.split(':').flatMap((group) => {
          if (!group.includes('.')) return [parseInt(group, 16)];
          const [a = 0, b = 0, c = 0, d = 0] = group.split('.').map(Number);
          return [(a << 8) | b, (c << 8) | d];
        });
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  const zeros = new Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...zeros, ...right];
}

/**
 * Who a rate limit counts against, from the client IP (security standard). An IPv4 address is
 * itself, also when it arrives IPv4-mapped (`::ffff:a.b.c.d`, as on a dual-stack socket). An
 * IPv6 address counts as its /64: a single subscriber usually holds a whole /64 and could
 * otherwise take a fresh address for every request.
 */
export function rateLimitSubject(ip: string | undefined): string {
  if (ip === undefined) return 'unknown';
  const mapped = IPV4_MAPPED.exec(ip)?.[1];
  if (mapped !== undefined && isIPv4(mapped)) return mapped;
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return 'unknown';
  const prefix = ipv6Groups(ip)
    .slice(0, 4)
    .map((group) => group.toString(16));
  return `${prefix.join(':')}::/64`;
}
