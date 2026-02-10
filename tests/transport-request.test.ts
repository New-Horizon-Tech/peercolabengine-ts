import { describe, it, expect } from 'vitest'
import {
  TransportRequest, TransportContext, TransportSerializer,
  OperationInformation, CallInformation, Attribute,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

describe('TransportRequest constructor', () => {
  it('sets all properties', () => {
    const tr = new TransportRequest(
      'op-1', 'GET', 'request', 'client-1', 'usage-1',
      'tx-1', 'tenant-1', 'en-GB',
      { performer: undefined, responsible: undefined, subject: undefined },
      [new Attribute('a1', 'v1' as unknown as object)],
      [new Attribute('p1', 'pv1' as unknown as object)],
      { data: 'test' },
      'raw-data'
    )
    expect(tr.operationId).toBe('op-1')
    expect(tr.operationVerb).toBe('GET')
    expect(tr.operationType).toBe('request')
    expect(tr.callingClient).toBe('client-1')
    expect(tr.usageId).toBe('usage-1')
    expect(tr.transactionId).toBe('tx-1')
    expect(tr.dataTenant).toBe('tenant-1')
    expect(tr.locale).toBe('en-GB')
    expect(tr.attributes).toHaveLength(1)
    expect(tr.pathParams).toHaveLength(1)
    expect(tr.requestJson).toEqual({ data: 'test' })
    expect(tr.raw).toBe('raw-data')
  })

  it('assignSerializer sets serializer', () => {
    const tr = new TransportRequest('op', 'GET', 'request', 'c', 'u', 'tx', 'dt', 'en', {}, [], [], {}, null)
    const result = tr.assignSerializer(jsonSerializer)
    expect(result).toBe(tr)
    expect(tr.serializer).toBe(jsonSerializer)
  })
})

describe('TransportRequest', () => {
  describe('from()', () => {
    it('creates from input + context', () => {
      const ctx = new TransportContext(
        new OperationInformation('op1', 'CREATE', 'request', 'client-x', 'usage-x'),
        CallInformation.new('en-US', 'tenant-a', 'tx-abc'),
        jsonSerializer
      )
      const tr = TransportRequest.from({ foo: 'bar' }, ctx)
      expect(tr.operationId).toBe('op1')
      expect(tr.operationVerb).toBe('CREATE')
      expect(tr.callingClient).toBe('client-x')
      expect(tr.requestJson).toEqual({ foo: 'bar' })
      expect(tr.serializer).toBe(jsonSerializer)
    })
  })

  describe('from() generates transactionId when empty', () => {
    it('generates UUID if transactionId is falsy', () => {
      const ctx = new TransportContext(
        new OperationInformation('op1', 'GET', 'request', 'c', 'u'),
        new CallInformation('en-GB', '', {}, [], [], ''),
        jsonSerializer
      )
      const tr = TransportRequest.from({ data: 1 }, ctx)
      expect(tr.transactionId).toBeTruthy()
      expect(tr.transactionId.length).toBeGreaterThan(0)
    })
  })

  describe('serialize / deserialize', () => {
    it('throws without serializer', () => {
      const tr = new TransportRequest('op', 'GET', 'request', 'c', 'u', 'tx', 'dt', 'en', {}, [], [], {}, null)
      expect(() => tr.serialize()).toThrow('No serializer assigned')
    })

    it('round-trips through fromSerialized', () => {
      const ctx = new TransportContext(
        new OperationInformation('op1', 'GET', 'request', 'c', 'u'),
        CallInformation.new('en-GB', 'dt', 'tx-1'),
        jsonSerializer
      )
      const original = TransportRequest.from({ data: 123 }, ctx)
      const json = original.serialize()

      const restored = TransportRequest.fromSerialized<{ data: number }>(jsonSerializer, json)
      expect(restored.operationId).toBe('op1')
      expect(restored.requestJson.data).toBe(123)
      expect(restored.raw).toBe(json)
    })
  })

  describe('deserialize', () => {
    it('throws without serializer assigned', () => {
      const tr = new TransportRequest('op', 'GET', 'request', 'c', 'u', 'tx', 'dt', 'en', {}, [], [], {}, null)
      expect(() => tr.deserialize('anything')).toThrow('No serializer assigned')
    })
  })
})
