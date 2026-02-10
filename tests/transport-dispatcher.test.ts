import { describe, it, expect } from 'vitest'
import {
  TransportDispatcher, InMemoryContextCache, TransportContext, CallInformation,
  OperationInformation, Result, TransportSerializer,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

function makeCtx(opId: string, opType = 'request') {
  return new TransportContext(
    new OperationInformation(opId, 'GET', opType, 'client', 'usage'),
    CallInformation.new('en-GB', '', 'tx-1'),
    jsonSerializer
  )
}

describe('TransportDispatcher', () => {
  describe('handler registration', () => {
    it('addRequestHandler / addMessageHandler work', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok())
      d.addMessageHandler('op.msg', async () => Result.ok())
      // no throw = success
    })

    it('duplicate handler throws', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok())
      expect(() => d.addRequestHandler('op.req', async () => Result.ok())).toThrow('already has a handler')
    })

    it('duplicate across handler types throws', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.x', async () => Result.ok())
      expect(() => d.addMessageHandler('op.x', async () => Result.ok())).toThrow('already has a handler')
    })

    it('duplicate message handler throws', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addMessageHandler('op.msg', async () => Result.ok())
      expect(() => d.addMessageHandler('op.msg', async () => Result.ok())).toThrow('already has a handler')
    })

    it('duplicate pattern handler throws', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addPatternHandler('items.', async () => Result.ok())
      expect(() => d.addPatternHandler('items.', async () => Result.ok())).toThrow('already has a handler')
    })

    it('addPatternHandler registers patterns', () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addPatternHandler('items.', async () => Result.ok())
      // no throw = success
    })
  })

  describe('handleAsRequest', () => {
    it('routes to correct handler', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.get', async (input: any) => Result.ok({ echo: input.q }))
      const ctx = makeCtx('op.get')
      const result = await d.handleAsRequest({ q: 'hi' }, ctx)
      expect(result.isSuccess()).toBe(true)
      expect((result.value as any).echo).toBe('hi')
    })

    it('returns 400 when no handler found', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      const ctx = makeCtx('missing.op')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.statusCode).toBe(400)
      expect(result.error!.code).toContain('HandlerNotFound')
    })

    it('enriches error with calledOperation, callingClient, callingUsage', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.fail', async () => Result.failed(500, 'ERR'))
      const ctx = makeCtx('op.fail')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.error!.details.calledOperation).toBe('op.fail')
      expect(result.error!.details.callingClient).toBe('client')
      expect(result.error!.details.callingUsage).toBe('usage')
    })
  })

  describe('handleAsMessage', () => {
    it('routes to correct handler', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addMessageHandler('op.msg', async () => Result.ok())
      const ctx = makeCtx('op.msg', 'message')
      const result = await d.handleAsMessage({}, ctx)
      expect(result.isSuccess()).toBe(true)
    })

    it('returns 400 when no handler found', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      const ctx = makeCtx('missing.msg', 'message')
      const result = await d.handleAsMessage({}, ctx)
      expect(result.statusCode).toBe(400)
    })
  })

  describe('handler throws', () => {
    it('request handler throws returns error', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.throw', async () => { throw new Error('handler boom') })
      const ctx = makeCtx('op.throw')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.isSuccess()).toBe(false)
      expect(result.statusCode).toBe(500)
    })

    it('message handler throws returns error', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addMessageHandler('op.throw', async () => { throw new Error('msg boom') })
      const ctx = makeCtx('op.throw', 'message')
      const result = await d.handleAsMessage({}, ctx)
      expect(result.isSuccess()).toBe(false)
      expect(result.statusCode).toBe(500)
    })
  })

  describe('routeFromGatewayRequest', () => {
    it('routes request type', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.gw', async () => Result.ok({ routed: true }))
      const ctx = makeCtx('op.gw', 'request')
      const result = await d.routeFromGatewayRequest({}, ctx)
      expect(result.isSuccess()).toBe(true)
      expect((result.value as any).routed).toBe(true)
    })

    it('routes message type', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addMessageHandler('op.gw', async () => Result.ok())
      const ctx = makeCtx('op.gw', 'message')
      const result = await d.routeFromGatewayRequest({}, ctx)
      expect(result.isSuccess()).toBe(true)
    })
  })

  describe('pattern matching', () => {
    it('matches pattern prefix', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addPatternHandler('items.', async (input: any) => Result.ok({ matched: true }))
      const ctx = makeCtx('items.getAll')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.isSuccess()).toBe(true)
      expect((result.value as any).matched).toBe(true)
    })

    it('longest prefix match wins', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addPatternHandler('items.', async () => Result.ok({ handler: 'short' }))
      d.addPatternHandler('items.admin.', async () => Result.ok({ handler: 'long' }))
      const ctx = makeCtx('items.admin.delete')
      const result = await d.handleAsRequest({}, ctx)
      expect((result.value as any).handler).toBe('long')
    })
  })

  describe('request inspector', () => {
    it('can short-circuit by returning a result', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok({ normal: true }))
      d.requestsInspector = async () => Result.failed(403, 'DENIED')
      const ctx = makeCtx('op.req')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.statusCode).toBe(403)
    })

    it('returns void continues normally', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok({ data: 1 }))
      d.requestsInspector = async () => { /* return void */ }
      const ctx = makeCtx('op.req')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.isSuccess()).toBe(true)
      expect((result.value as any).data).toBe(1)
    })

    it('throws exception continues normally', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok({ data: 1 }))
      d.requestsInspector = async () => { throw new Error('inspector boom') }
      const ctx = makeCtx('op.req')
      const result = await d.handleAsRequest({}, ctx)
      expect(result.isSuccess()).toBe(true)
    })
  })

  describe('response inspector', () => {
    it('receives the result', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok({ data: 1 }))
      let inspectedResult: Result<object> | null = null
      d.responsesInspector = async (r) => { inspectedResult = r; return r }
      const ctx = makeCtx('op.req')
      await d.handleAsRequest({}, ctx)
      expect(inspectedResult).not.toBeNull()
      expect((inspectedResult! as any).value.data).toBe(1)
    })

    it('without inspector returns original result', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.addRequestHandler('op.req', async () => Result.ok({ data: 99 }))
      const ctx = makeCtx('op.req')
      const result = await d.handleAsRequest({}, ctx)
      expect((result.value as any).data).toBe(99)
    })

    it('inspectMessageResponse throws exception returns original', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      d.responsesInspector = async () => { throw new Error('msg inspector boom') }
      const ctx = makeCtx('op.msg')
      const original = Result.ok({ data: 42 }) as Result<object>
      const result = await d.inspectMessageResponse(original, {}, ctx)
      expect(result).toBe(original)
    })

    it('inspectMessageResponse works with inspector', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      let inspected = false
      d.responsesInspector = async (r) => { inspected = true; return r }
      const ctx = makeCtx('op.msg')
      const result = Result.ok({ msg: 'hi' }) as Result<object>
      await d.inspectMessageResponse(result, {}, ctx)
      expect(inspected).toBe(true)
    })

    it('inspectMessageResponse without inspector returns original', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      const ctx = makeCtx('op.msg')
      const original = Result.ok({ msg: 'hi' }) as Result<object>
      const result = await d.inspectMessageResponse(original, {}, ctx)
      expect(result).toBe(original)
    })
  })

  describe('context cache', () => {
    it('put/get flow with cacheReads=false stores on handle', async () => {
      const cache = new InMemoryContextCache()
      const d = new TransportDispatcher('s1', cache, false)
      d.addRequestHandler('op.req', async () => Result.ok())
      const ctx = makeCtx('op.req')
      await d.handleAsRequest({}, ctx)
      // The cache should have the entry now
      const cached = await cache.get('tx-1')
      expect(cached).not.toBeNull()
      expect(cached!.locale).toBe('en-GB')
    })

    it('cacheReads=true skips cache put', async () => {
      const cache = new InMemoryContextCache()
      const d = new TransportDispatcher('s1', cache, true)
      d.addRequestHandler('op.req', async () => Result.ok())
      const ctx = makeCtx('op.req')
      await d.handleAsRequest({}, ctx)
      // With cacheReads=true, it should NOT store (it just reads)
      const cached = await cache.get('tx-1')
      expect(cached).toBeNull()
    })
  })

  describe('getCallInfoFromCache', () => {
    it('returns callInfo when cacheReads=false', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), false)
      const info = CallInformation.new('en-US')
      const result = await d.getCallInfoFromCache('tx-1', info, true)
      expect(result).toBe(info) // cacheReads is false, returns as-is
    })

    it('returns callInfo when matchSessions=false', async () => {
      const d = new TransportDispatcher('s1', new InMemoryContextCache(), true)
      const info = CallInformation.new('en-US')
      const result = await d.getCallInfoFromCache('tx-1', info, false)
      expect(result).toBe(info)
    })

    it('cache miss returns fallback', async () => {
      const cache = new InMemoryContextCache()
      const d = new TransportDispatcher('s1', cache, true)
      const fallback = CallInformation.new('en-US')
      const result = await d.getCallInfoFromCache('nonexistent', fallback, true)
      expect(result).toBe(fallback)
    })

    it('returns cached value when cacheReads=true and matchSessions=true', async () => {
      const cache = new InMemoryContextCache()
      const stored = CallInformation.new('nb-NO', 'cached-tenant', 'tx-stored')
      await cache.put('tx-stored', stored)

      const d = new TransportDispatcher('s1', cache, true)
      const fallback = CallInformation.new('en-US')
      const result = await d.getCallInfoFromCache('tx-stored', fallback, true)
      expect(result.locale).toBe('nb-NO')
    })
  })
})
