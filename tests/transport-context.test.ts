import { describe, it, expect } from 'vitest'
import {
  TransportContext, TransportRequest, CallInformation, OperationInformation,
  Attribute, TransportSerializer, Result
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

function makeTransportRequest() {
  return new TransportRequest(
    'op-1', 'GET', 'request', 'client-1', 'usage-1',
    'tx-1', 'tenant-1', 'en-GB',
    { performer: undefined, responsible: undefined, subject: undefined },
    [new Attribute('attr1', 'val1' as unknown as object)],
    [new Attribute('param1', 'pval1' as unknown as object)],
    { data: 'test' },
    null
  ).assignSerializer(jsonSerializer)
}

describe('TransportContext', () => {
  it('from() creates context from TransportRequest', () => {
    const tr = makeTransportRequest()
    const ctx = TransportContext.from(tr)
    expect(ctx.operation.id).toBe('op-1')
    expect(ctx.operation.verb).toBe('GET')
    expect(ctx.operation.type).toBe('request')
    expect(ctx.operation.callingClient).toBe('client-1')
    expect(ctx.call.locale).toBe('en-GB')
    expect(ctx.call.dataTenant).toBe('tenant-1')
    expect(ctx.call.transactionId).toBe('tx-1')
  })

  it('from() throws without serializer', () => {
    const tr = new TransportRequest(
      'op', 'GET', 'request', 'c', 'u', 'tx', 'dt', 'en', {}, [], [], {}, null
    )
    expect(() => TransportContext.from(tr)).toThrow('Serializer requred')
  })

  it('hasAttribute / getAttribute', () => {
    const tr = makeTransportRequest()
    const ctx = TransportContext.from(tr)
    expect(ctx.hasAttribute('attr1')).toBe(true)
    expect(ctx.getAttribute('attr1')).toBe('val1')
    expect(ctx.hasAttribute('missing')).toBe(false)
  })

  it('hasPathParameter / getPathParameter', () => {
    const tr = makeTransportRequest()
    const ctx = TransportContext.from(tr)
    expect(ctx.hasPathParameter('param1')).toBe(true)
    expect(ctx.getPathParameter('param1')).toBe('pval1')
    expect(ctx.hasPathParameter('missing')).toBe(false)
  })

  it('serializeRequest produces a JSON string', () => {
    const tr = makeTransportRequest()
    const ctx = TransportContext.from(tr)
    const json = ctx.serializeRequest({ hello: 'world' })
    expect(typeof json).toBe('string')
    const parsed = JSON.parse(json)
    expect(parsed.requestJson).toEqual({ hello: 'world' })
  })

  it('deserializeResult round-trips', () => {
    const r = Result.ok({ x: 1 })
    r.assignSerializer(jsonSerializer)
    const json = r.serialize()

    const tr = makeTransportRequest()
    const ctx = TransportContext.from(tr)
    const restored = ctx.deserializeResult<{ x: number }>(json)
    expect(restored.isSuccess()).toBe(true)
    expect(restored.value).toEqual({ x: 1 })
  })
})

describe('Attribute', () => {
  it('constructor sets name and value', () => {
    const attr = new Attribute('key', 'val' as unknown as object)
    expect(attr.name).toBe('key')
    expect(attr.value).toBe('val')
  })
})

describe('CallInformation', () => {
  it('new() creates with defaults', () => {
    const ci = CallInformation.new('en-US')
    expect(ci.locale).toBe('en-US')
    expect(ci.dataTenant).toBe('')
    expect(ci.attributes).toEqual([])
    expect(ci.pathParams).toEqual([])
    expect(ci.transactionId).toBeDefined()
  })

  it('new() accepts optional dataTenant and transactionId', () => {
    const ci = CallInformation.new('en-US', 'my-tenant', 'my-tx')
    expect(ci.dataTenant).toBe('my-tenant')
    expect(ci.transactionId).toBe('my-tx')
  })
})

describe('OperationInformation', () => {
  it('stores all fields', () => {
    const oi = new OperationInformation('id1', 'GET', 'request', 'client', 'usage')
    expect(oi.id).toBe('id1')
    expect(oi.verb).toBe('GET')
    expect(oi.type).toBe('request')
    expect(oi.callingClient).toBe('client')
    expect(oi.usageId).toBe('usage')
  })
})
