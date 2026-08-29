// Unit tests for the SSRF guard: address classification, URL rejection paths,
// injectable-resolver behavior, and the connection-time re-check. All DNS is
// injected so no real resolution happens.
import { describe, expect, it } from 'vitest'
import {
  TargetPolicyError,
  validateConnectedAddress,
  validateTarget,
} from '@deepseek-ai/dsh-host-geo-bff'
import type { ResolvedAddress, TargetResolver } from '@deepseek-ai/dsh-host-geo-bff'

/** A resolver that always yields the given addresses. */
function resolverOf(...addresses: ResolvedAddress[]): TargetResolver {
  return async () => addresses
}

describe('validateTarget', () => {
  it('rejects a loopback literal when private sources are disallowed', async () => {
    await expect(validateTarget('http://127.0.0.1:4176', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('allows a loopback literal when private sources are allowed', async () => {
    const target = await validateTarget('http://127.0.0.1:4176', { allowPrivateSources: true })
    expect(target.selectedAddress).toBe('127.0.0.1')
    expect(target.selectedFamily).toBe(4)
    expect(target.allowPrivateSources).toBe(true)
  })

  it('rejects a private (RFC1918) literal when disallowed', async () => {
    await expect(validateTarget('http://192.168.1.5', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('allows a public IP literal regardless of the private flag', async () => {
    const target = await validateTarget('http://93.184.216.34', { allowPrivateSources: false })
    expect(target.selectedAddress).toBe('93.184.216.34')
    expect(target.addresses).toEqual(['93.184.216.34'])
  })

  it('rejects a URL with embedded credentials (INVALID_TARGET)', async () => {
    await expect(validateTarget('http://user:pass@93.184.216.34/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'INVALID_TARGET' })
    await expect(validateTarget('http://user@93.184.216.34/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'INVALID_TARGET' })
  })

  it('rejects a non-http(s) protocol (INVALID_TARGET)', async () => {
    await expect(validateTarget('ftp://93.184.216.34/'))
      .rejects.toMatchObject({ code: 'INVALID_TARGET' })
  })

  it('rejects a malformed URL (INVALID_TARGET)', async () => {
    await expect(validateTarget('not a url'))
      .rejects.toMatchObject({ code: 'INVALID_TARGET' })
  })

  it('maps a DNS resolution failure to DNS_UNAVAILABLE', async () => {
    const resolver: TargetResolver = async () => { throw new Error('boom') }
    await expect(validateTarget('http://example.test', { resolver }))
      .rejects.toMatchObject({ code: 'DNS_UNAVAILABLE' })
  })

  it('maps an empty resolver result to DNS_UNAVAILABLE', async () => {
    await expect(validateTarget('http://example.test', { resolver: resolverOf() }))
      .rejects.toMatchObject({ code: 'DNS_UNAVAILABLE' })
  })

  it('uses the injected resolver for a non-literal hostname', async () => {
    let asked = ''
    const resolver: TargetResolver = async (hostname) => {
      asked = hostname
      return [{ address: '93.184.216.34', family: 4 }]
    }
    const target = await validateTarget('http://example.test/path', { resolver })
    expect(asked).toBe('example.test')
    expect(target.addresses).toEqual(['93.184.216.34'])
  })

  it('rejects a resolved private address when private sources are disallowed', async () => {
    await expect(
      validateTarget('http://example.test', {
        allowPrivateSources: false,
        resolver: resolverOf({ address: '10.0.0.5', family: 4 }),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('allows a resolved private address when private sources are allowed', async () => {
    const target = await validateTarget('http://example.test', {
      allowPrivateSources: true,
      resolver: resolverOf({ address: '10.0.0.5', family: 4 }),
    })
    expect(target.addresses).toEqual(['10.0.0.5'])
  })

  it('rejects when a resolver record family disagrees with its address', async () => {
    await expect(
      validateTarget('http://example.test', {
        resolver: resolverOf({ address: '93.184.216.34', family: 6 }),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('deduplicates repeated resolved addresses', async () => {
    const target = await validateTarget('http://example.test', {
      resolver: resolverOf(
        { address: '93.184.216.34', family: 4 },
        { address: '93.184.216.34', family: 4 },
      ),
    })
    expect(target.addresses).toEqual(['93.184.216.34'])
    expect(target.addressKeys.size).toBe(1)
  })

  it('handles a bracketed IPv6 literal', async () => {
    const target = await validateTarget('http://[2606:2800:220:1:248:1893:25c8:1946]/', {
      allowPrivateSources: false,
    })
    expect(target.selectedFamily).toBe(6)
  })

  it('rejects an IPv6 loopback literal when disallowed', async () => {
    await expect(validateTarget('http://[::1]/', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('rejects an IPv4 reserved range (multicast) even when private allowed', async () => {
    await expect(validateTarget('http://224.0.0.1/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('rejects an IPv4 reserved range (documentation 192.0.2.0/24)', async () => {
    await expect(validateTarget('http://192.0.2.5/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('rejects an IPv6 unique-local (fc00::/7) literal when disallowed', async () => {
    await expect(validateTarget('http://[fc00::1]/', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('rejects an IPv6 documentation (2001:db8::/32) reserved literal', async () => {
    await expect(validateTarget('http://[2001:db8::1]/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('rejects an IPv6 address outside the global-unicast 2000::/3 space', async () => {
    // 4000:: is not in any listed range and not in 2000::/3, so it is reserved.
    await expect(validateTarget('http://[4000::1]/', { allowPrivateSources: true }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('folds an IPv4-mapped IPv6 literal (::ffff:a.b.c.d) to its IPv4 class', async () => {
    // ::ffff:10.0.0.1 maps to private 10.0.0.1 — blocked when disallowed.
    await expect(validateTarget('http://[::ffff:10.0.0.1]/', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
    // And allowed as public when the embedded IPv4 is public. The record family
    // reflects the literal's textual form (IPv6), while classification folds to
    // the embedded IPv4.
    const target = await validateTarget('http://[::ffff:93.184.216.34]/', { allowPrivateSources: false })
    expect(target.selectedFamily).toBe(6)
    expect(target.addresses.length).toBe(1)
  })

  it('classifies a 6to4 (2002::/16) literal by its embedded IPv4', async () => {
    // 2002:0a00:0001:: embeds 10.0.0.1 (private) -> blocked when disallowed.
    await expect(validateTarget('http://[2002:a00:1::]/', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })

  it('parses a resolver-returned dotted IPv4-in-IPv6 address', async () => {
    // A resolver may hand back the dotted textual form the URL parser would have
    // normalized away, exercising parseIpv6's embedded-IPv4 branch. isIP marks
    // it family 6, so the record family must match.
    await expect(
      validateTarget('http://example.test', {
        allowPrivateSources: false,
        resolver: async () => [{ address: '::ffff:10.0.0.1', family: 6 }],
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED_TARGET' })

    const target = await validateTarget('http://example.test', {
      allowPrivateSources: false,
      resolver: async () => [{ address: '::ffff:93.184.216.34', family: 6 }],
    })
    expect(target.addresses.length).toBe(1)
  })

  it('accepts a public IPv6 global-unicast literal', async () => {
    const target = await validateTarget('http://[2606:4700:4700::1111]/', { allowPrivateSources: false })
    expect(target.selectedFamily).toBe(6)
  })

  it('resolves localhost through the real default resolver', async () => {
    // No injected resolver: exercises defaultResolver (dns.lookup). localhost
    // resolves without network; loopback requires the private allowance.
    const target = await validateTarget('http://localhost:4176/', { allowPrivateSources: true })
    expect(target.addresses.length).toBeGreaterThan(0)
  })

  it('blocks localhost through the real resolver when private is disallowed', async () => {
    await expect(validateTarget('http://localhost:4176/', { allowPrivateSources: false }))
      .rejects.toMatchObject({ code: 'BLOCKED_TARGET' })
  })
})

describe('validateConnectedAddress', () => {
  it('accepts an address in the validated set', async () => {
    const target = await validateTarget('http://example.test', {
      resolver: resolverOf({ address: '93.184.216.34', family: 4 }),
    })
    expect(() => { validateConnectedAddress(target, '93.184.216.34') }).not.toThrow()
  })

  it('rejects an address outside the validated set', async () => {
    const target = await validateTarget('http://example.test', {
      resolver: resolverOf({ address: '93.184.216.34', family: 4 }),
    })
    expect(() => { validateConnectedAddress(target, '93.184.216.35') })
      .toThrow(TargetPolicyError)
  })

  it('rejects an unparsable connection address', async () => {
    const target = await validateTarget('http://example.test', {
      resolver: resolverOf({ address: '93.184.216.34', family: 4 }),
    })
    expect(() => { validateConnectedAddress(target, 'garbage') })
      .toThrow(TargetPolicyError)
  })

  it('rejects a private connection address when private sources were disallowed', async () => {
    const target = await validateTarget('http://example.test', {
      allowPrivateSources: false,
      resolver: resolverOf({ address: '93.184.216.34', family: 4 }),
    })
    expect(() => { validateConnectedAddress(target, '10.0.0.5') })
      .toThrow(TargetPolicyError)
  })

  it('carries the BLOCKED_TARGET code on rejection', async () => {
    const target = await validateTarget('http://example.test', {
      resolver: resolverOf({ address: '93.184.216.34', family: 4 }),
    })
    try {
      validateConnectedAddress(target, '93.184.216.35')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TargetPolicyError)
      expect((error as TargetPolicyError).code).toBe('BLOCKED_TARGET')
    }
  })
})
