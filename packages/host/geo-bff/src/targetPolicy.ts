/**
 * SSRF guard for outbound Terra BFF requests, ported from Terra's
 * `security/targetPolicy.ts`. Parses and classifies the target URL's resolved
 * addresses and blocks private, loopback, link-local, multicast, and reserved
 * ranges unless `allowPrivateSources` permits private targets. The resolver is
 * injectable so tests exercise classification without real DNS.
 * @module @deepseek-ai/dsh-host-geo-bff/targetPolicy
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** Machine code carried by every {@link TargetPolicyError}. */
export type TargetPolicyErrorCode =
  | 'BLOCKED_TARGET'
  | 'DNS_UNAVAILABLE'
  | 'INVALID_TARGET'

/** Error raised when a target URL is rejected by the SSRF guard. */
export class TargetPolicyError extends Error {
  /** Machine code identifying the rejection reason. */
  readonly code: TargetPolicyErrorCode

  /**
   * @param code - machine rejection code.
   * @param message - human-readable detail.
   */
  constructor(code: TargetPolicyErrorCode, message: string) {
    super(message)
    this.name = 'TargetPolicyError'
    this.code = code
  }
}

/** One address a resolver returned for a hostname. */
export interface ResolvedAddress {
  /** Numeric IP literal. */
  address: string
  /** IP family of {@link address}. */
  family: 4 | 6
}

/**
 * Resolve a hostname to its addresses.
 * @param hostname - the hostname to resolve.
 * @returns the resolved addresses (may be empty).
 */
export type TargetResolver = (hostname: string) => Promise<ResolvedAddress[]>

/** Options controlling {@link validateTarget}. */
export interface TargetPolicyOptions {
  /** When true, private/loopback/link-local targets are permitted. */
  allowPrivateSources?: boolean
  /** Injectable DNS resolver; defaults to Node's `dns.lookup`. */
  resolver?: TargetResolver
}

/** A validated target with the addresses that passed the classification checks. */
export interface ValidatedTarget {
  /** Parsed target URL. */
  url: URL
  /** Distinct resolved addresses, lowercased, that passed the guard. */
  addresses: string[]
  /** The first passing address, used to establish the connection. */
  selectedAddress: string
  /** IP family of {@link selectedAddress}. */
  selectedFamily: 4 | 6
  /** Whether private targets were permitted for this validation. */
  allowPrivateSources: boolean
  /** Canonical keys of the passing addresses, for connection-time re-check. */
  addressKeys: ReadonlySet<string>
}

/** Coarse routability class of a parsed address. */
type AddressClass = 'private' | 'public' | 'reserved'

/** A parsed IP address with a canonical key and numeric value. */
type ParsedAddress = {
  family: 4 | 6
  key: string
  value: bigint
}

/** Default resolver backed by Node's `dns.lookup` (all records, verbatim order). */
const defaultResolver: TargetResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, order: 'verbatim' })
  return records.map((record) => {
    /* v8 ignore next 3 -- dns.lookup only reports family 4 or 6; a defensive guard. */
    if (record.family !== 4 && record.family !== 6) {
      throw new Error('Unsupported address family')
    }
    return { address: record.address, family: record.family }
  })
}

/** Build the `INVALID_TARGET` error. */
function invalidTarget(): TargetPolicyError {
  return new TargetPolicyError('INVALID_TARGET', 'Remote target is not allowed')
}

/** Build the `BLOCKED_TARGET` error. */
function blockedTarget(): TargetPolicyError {
  return new TargetPolicyError('BLOCKED_TARGET', 'Remote target is not allowed')
}

/**
 * Parse an IPv4 literal to its numeric value.
 * @param address - candidate IPv4 literal.
 * @returns the numeric value, or null when not an IPv4 literal.
 */
function parseIpv4(address: string): bigint | null {
  if (isIP(address) !== 4) return null
  let value = 0n
  for (const part of address.split('.')) {
    value = (value << 8n) | BigInt(Number(part))
  }
  return value
}

/**
 * Parse an IPv6 literal (including IPv4-in-IPv6 dotted form) to its numeric value.
 * @param address - candidate IPv6 literal.
 * @returns the numeric value, or null when not a valid non-zoned IPv6 literal.
 */
function parseIpv6(address: string): bigint | null {
  if (isIP(address) !== 6 || address.includes('%')) return null

  let normalized = address.toLowerCase()
  const dottedIndex = normalized.lastIndexOf(':')

  if (normalized.includes('.')) {
    const ipv4 = parseIpv4(normalized.slice(dottedIndex + 1))
    /* v8 ignore next -- isIP already accepted the address, so the dotted tail parses. */
    if (ipv4 === null) return null
    normalized =
      normalized.slice(0, dottedIndex + 1) +
      `${Number((ipv4 >> 16n) & 0xffffn).toString(16)}:` +
      Number(ipv4 & 0xffffn).toString(16)
  }

  const halves = normalized.split('::')
  /* v8 ignore next */
  if (halves.length > 2) return null

  const [head, tail] = halves
  const left = head === undefined || head === '' ? [] : head.split(':').filter(Boolean)
  const right =
    tail === undefined || tail === ''
      ? []
      : tail.split(':').filter(Boolean)
  const missing = 8 - left.length - right.length

  /* v8 ignore next 6 -- isIP guarantees a well-formed group count, so this compressed-group guard is defensive. */
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null
  }

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ]

  /* v8 ignore next 6 -- isIP guarantees eight valid hextet groups, so this group-shape guard is defensive. */
  if (
    groups.length !== 8 ||
    groups.some(group => !/^[0-9a-f]{1,4}$/u.test(group))
  ) {
    return null
  }

  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  )
}

/**
 * Parse any IP literal, folding IPv4-mapped IPv6 addresses to IPv4.
 * @param address - candidate IP literal.
 * @returns the parsed address, or null when not a valid IP literal.
 */
function parseAddress(address: string): ParsedAddress | null {
  const ipv4 = parseIpv4(address)
  if (ipv4 !== null) {
    return { family: 4, key: `4:${ipv4.toString(16)}`, value: ipv4 }
  }

  const ipv6 = parseIpv6(address)
  if (ipv6 === null) return null

  if (ipv6 >> 32n === 0xffffn) {
    const mapped = ipv6 & 0xffff_ffffn
    return { family: 4, key: `4:${mapped.toString(16)}`, value: mapped }
  }

  return { family: 6, key: `6:${ipv6.toString(16)}`, value: ipv6 }
}

/**
 * Test whether an address value falls inside a CIDR block.
 * @param value - the address value to test.
 * @param base - the CIDR base value.
 * @param prefixLength - the CIDR prefix length in bits.
 * @param totalBits - total bits in the address family (32 or 128).
 * @returns true when `value` is inside the block.
 */
function inCidr(
  value: bigint,
  base: bigint,
  prefixLength: number,
  totalBits: number,
): boolean {
  const shift = BigInt(totalBits - prefixLength)
  return value >> shift === base >> shift
}

/** Numeric value of an IPv4 literal known to be well-formed. */
function ipv4Value(address: string): bigint {
  return parseIpv4(address) as bigint
}

/** Numeric value of an IPv6 literal known to be well-formed. */
function ipv6Value(address: string): bigint {
  return parseIpv6(address) as bigint
}

/**
 * Classify an IPv4 value as private, reserved, or public.
 * @param value - the IPv4 numeric value.
 * @returns the routability class.
 */
function classifyIpv4(value: bigint): AddressClass {
  const privateRanges: Array<[bigint, number]> = [
    [ipv4Value('10.0.0.0'), 8],
    [ipv4Value('100.64.0.0'), 10],
    [ipv4Value('127.0.0.0'), 8],
    [ipv4Value('169.254.0.0'), 16],
    [ipv4Value('172.16.0.0'), 12],
    [ipv4Value('192.168.0.0'), 16],
  ]
  const reservedRanges: Array<[bigint, number]> = [
    [ipv4Value('0.0.0.0'), 8],
    [ipv4Value('192.0.0.0'), 24],
    [ipv4Value('192.0.2.0'), 24],
    [ipv4Value('192.88.99.0'), 24],
    [ipv4Value('198.18.0.0'), 15],
    [ipv4Value('198.51.100.0'), 24],
    [ipv4Value('203.0.113.0'), 24],
    [ipv4Value('224.0.0.0'), 4],
    [ipv4Value('240.0.0.0'), 4],
  ]

  if (privateRanges.some(([base, prefix]) => inCidr(value, base, prefix, 32))) {
    return 'private'
  }
  if (reservedRanges.some(([base, prefix]) => inCidr(value, base, prefix, 32))) {
    return 'reserved'
  }
  return 'public'
}

/**
 * Classify an IPv6 value as private, reserved, or public.
 * @param value - the IPv6 numeric value.
 * @returns the routability class.
 */
function classifyIpv6(value: bigint): AddressClass {
  if (value === 1n) return 'private'

  if (inCidr(value, ipv6Value('2002::'), 16, 128)) {
    const embeddedIpv4 = (value >> 80n) & 0xffff_ffffn
    return classifyIpv4(embeddedIpv4)
  }

  const privateRanges: Array<[bigint, number]> = [
    [ipv6Value('fc00::'), 7],
    [ipv6Value('fe80::'), 10],
  ]
  const reservedRanges: Array<[bigint, number]> = [
    [ipv6Value('::'), 96],
    [ipv6Value('100::'), 64],
    [ipv6Value('2001::'), 32],
    [ipv6Value('2001:2::'), 48],
    [ipv6Value('2001:10::'), 28],
    [ipv6Value('2001:20::'), 28],
    [ipv6Value('2001:db8::'), 32],
    [ipv6Value('3fff::'), 20],
    [ipv6Value('ff00::'), 8],
  ]

  if (privateRanges.some(([base, prefix]) => inCidr(value, base, prefix, 128))) {
    return 'private'
  }
  if (reservedRanges.some(([base, prefix]) => inCidr(value, base, prefix, 128))) {
    return 'reserved'
  }
  return inCidr(value, ipv6Value('2000::'), 3, 128) ? 'public' : 'reserved'
}

/**
 * Classify a parsed address by its family.
 * @param parsed - the parsed address.
 * @returns the routability class.
 */
function classifyAddress(parsed: ParsedAddress): AddressClass {
  return parsed.family === 4
    ? classifyIpv4(parsed.value)
    : classifyIpv6(parsed.value)
}

/**
 * Throw when a parsed address is reserved, or private without permission.
 * @param parsed - the parsed address to check.
 * @param allowPrivateSources - whether private targets are permitted.
 */
function assertAllowedAddress(
  parsed: ParsedAddress,
  allowPrivateSources: boolean,
): void {
  const classification = classifyAddress(parsed)
  if (
    classification === 'reserved' ||
    (classification === 'private' && !allowPrivateSources)
  ) {
    throw blockedTarget()
  }
}

/**
 * Strip surrounding brackets from an IPv6 URL hostname.
 * @param hostname - the URL hostname.
 * @returns the hostname without IPv6 brackets.
 */
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

/**
 * Validate an outbound target URL against the SSRF policy.
 * @param input - the target URL string.
 * @param options - private-source permission and injectable resolver.
 * @returns the validated target when every resolved address passes.
 * @throws {TargetPolicyError} `INVALID_TARGET` for a malformed URL, non-http(s)
 *   scheme, embedded credentials, or empty hostname; `DNS_UNAVAILABLE` when
 *   resolution fails or yields nothing; `BLOCKED_TARGET` when any resolved
 *   address is disallowed.
 */
export async function validateTarget(
  input: string,
  options: TargetPolicyOptions = {},
): Promise<ValidatedTarget> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw invalidTarget()
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hostname.length === 0
  ) {
    throw invalidTarget()
  }

  const allowPrivateSources = options.allowPrivateSources ?? false
  const hostname = stripIpv6Brackets(url.hostname)
  const literal = parseAddress(hostname)
  let records: ResolvedAddress[]

  if (literal !== null) {
    records = [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
  } else {
    try {
      records = await (options.resolver ?? defaultResolver)(hostname)
    } catch {
      throw new TargetPolicyError('DNS_UNAVAILABLE', 'Remote target is unavailable')
    }
  }

  if (records.length === 0) {
    throw new TargetPolicyError('DNS_UNAVAILABLE', 'Remote target is unavailable')
  }

  const addresses: string[] = []
  const addressKeys = new Set<string>()
  let selectedFamily: 4 | 6 | null = null

  for (const record of records) {
    const parsed = parseAddress(record.address)
    if (
      parsed === null ||
      isIP(record.address) !== record.family
    ) {
      throw blockedTarget()
    }

    assertAllowedAddress(parsed, allowPrivateSources)

    if (!addressKeys.has(parsed.key)) {
      addressKeys.add(parsed.key)
      addresses.push(record.address.toLowerCase())
      selectedFamily ??= record.family
    }
  }

  const [selectedAddress] = addresses
  /* v8 ignore next 4 -- records is non-empty and each record adds an address, so a selection exists; this satisfies the type checker. */
  if (selectedAddress === undefined || selectedFamily === null) {
    throw blockedTarget()
  }

  return {
    url,
    addresses,
    selectedAddress,
    selectedFamily,
    allowPrivateSources,
    addressKeys,
  }
}

/**
 * Re-check a connection-time address against a validated target (DNS-rebinding
 * defense): the address must parse, pass the classification checks, and match
 * one of the addresses that passed at validation.
 * @param target - the previously validated target.
 * @param address - the address the connection actually resolved to.
 * @throws {TargetPolicyError} `BLOCKED_TARGET` when the address is unparsable,
 *   disallowed, or absent from the validated set.
 */
export function validateConnectedAddress(
  target: ValidatedTarget,
  address: string,
): void {
  const parsed = parseAddress(address)
  if (parsed === null) throw blockedTarget()

  assertAllowedAddress(parsed, target.allowPrivateSources)

  if (!target.addressKeys.has(parsed.key)) throw blockedTarget()
}
