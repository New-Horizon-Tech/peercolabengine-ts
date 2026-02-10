import { describe, it, expect, vi } from 'vitest'
import { InMemoryContextCache, CallInformation } from '../src/index.js'

describe('InMemoryContextCache', () => {
  it('put and get basic flow', async () => {
    const cache = new InMemoryContextCache()
    const info = CallInformation.new('en-US', 'tenant', 'tx-1')
    const ok = await cache.put('tx-1', info)
    expect(ok).toBe(true)
    const retrieved = await cache.get('tx-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved!.locale).toBe('en-US')
    expect(retrieved!.dataTenant).toBe('tenant')
  })

  it('returns null for missing key', async () => {
    const cache = new InMemoryContextCache()
    const result = await cache.get('nonexistent')
    expect(result).toBeNull()
  })

  it('put overwrites existing entry', async () => {
    const cache = new InMemoryContextCache()
    const info1 = CallInformation.new('en-US', 'tenant1', 'tx-1')
    const info2 = CallInformation.new('nb-NO', 'tenant2', 'tx-1')
    await cache.put('tx-1', info1)
    await cache.put('tx-1', info2)
    const retrieved = await cache.get('tx-1')
    expect(retrieved!.locale).toBe('nb-NO')
    expect(retrieved!.dataTenant).toBe('tenant2')
  })

  it('stores multiple independent entries', async () => {
    const cache = new InMemoryContextCache()
    const info1 = CallInformation.new('en-US', 'tenant1', 'tx-1')
    const info2 = CallInformation.new('nb-NO', 'tenant2', 'tx-2')
    await cache.put('tx-1', info1)
    await cache.put('tx-2', info2)
    const r1 = await cache.get('tx-1')
    const r2 = await cache.get('tx-2')
    expect(r1!.locale).toBe('en-US')
    expect(r2!.locale).toBe('nb-NO')
  })

  it('expires entry after maxLifetimeMs', async () => {
    const cache = new InMemoryContextCache(50) // 50ms
    const info = CallInformation.new('en-US')
    await cache.put('tx-expire', info)

    // Should still be available immediately
    expect(await cache.get('tx-expire')).not.toBeNull()

    // Wait for expiration
    await new Promise(r => setTimeout(r, 60))
    expect(await cache.get('tx-expire')).toBeNull()
  })
})
