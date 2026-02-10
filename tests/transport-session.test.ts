import { describe, it, expect, vi } from 'vitest'
import {
  Transport, TransportSession, TransportSessionBuilder,
  Result, TransportContext, TransportSerializer, Attribute,
  RequestOperation, RequestOperationHandler, MessageOperation,
  MessageOperationHandler, TransportRequest, InMemoryContextCache,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

class TestGetOp extends RequestOperation<{ q: string }, { a: string }> {
  constructor() { super('test.get', 'GET') }
}

class TestMsgOp extends MessageOperation<{ msg: string }> {
  constructor() { super('test.msg', 'PROCESS') }
}

describe('Transport.session()', () => {
  it('returns a TransportSessionBuilder', () => {
    const builder = Transport.session('test-session')
    expect(builder).toBeInstanceOf(TransportSessionBuilder)
  })
})

describe('TransportSessionBuilder', () => {
  it('fluent API returns the builder', () => {
    const builder = Transport.session('s1')
    expect(builder.assignSerializer(jsonSerializer)).toBe(builder)
    expect(builder.inspectRequest(async () => {})).toBe(builder)
    expect(builder.inspectResponse(async (r) => r)).toBe(builder)
    expect(builder.onLogMessage({ logLevel: 3, write: () => {} })).toBe(builder)
    expect(builder.setupOutboundContextCache(new InMemoryContextCache())).toBe(builder)
  })

  it('intercept() accepts request handlers', () => {
    const op = new TestGetOp()
    const handler = op.handle(async () => Result.ok({ a: 'ok' }))
    const builder = Transport.session('s1')
    expect(builder.intercept(handler)).toBe(builder)
  })

  it('intercept() accepts message handlers', () => {
    const op = new TestMsgOp()
    const handler = op.handle(async () => Result.ok())
    const builder = Transport.session('s1')
    expect(builder.intercept(handler)).toBe(builder)
  })

  it('interceptPattern returns builder', () => {
    const builder = Transport.session('s1')
    expect(builder.interceptPattern('test.', async () => Result.ok())).toBe(builder)
  })

  it('build() returns TransportSession', () => {
    const session = Transport.session('s1').build()
    expect(session).toBeInstanceOf(TransportSession)
  })

  it('outboundSessionBuilder() returns an OutboundSessionBuilder', () => {
    const builder = Transport.session('s1')
    const outbound = builder.outboundSessionBuilder('outbound-client')
    expect(outbound).toBeDefined()
    expect(typeof outbound.build).toBe('function')
  })
})

describe('TransportSession', () => {
  it('withLocale sets locale', () => {
    const session = Transport.session('s1').build()
    expect(session.withLocale('nb-NO')).toBe(session)
  })

  it('createClient returns a TransportClient', () => {
    const session = Transport.session('s1').build()
    const client = session.createClient('c1')
    expect(client).toBeDefined()
  })

  it('getSerializer returns the serializer', () => {
    const session = Transport.session('s1').assignSerializer(jsonSerializer).build()
    expect(session.getSerializer()).toBe(jsonSerializer)
  })

  it('createClient with tenant', () => {
    const session = Transport.session('s1').build()
    const client = session.createClient('c1', 'my-tenant')
    expect(client).toBeDefined()
  })

  it('acceptIncomingRequest no handler returns bad request', async () => {
    const session = Transport.session('s1').build()
    const request = new TransportRequest(
      'nonexistent.op', 'GET', 'request', 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [], {}, null
    ).assignSerializer(jsonSerializer)
    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.statusCode).toBe(400)
  })

  it('pattern handler matches prefix via session', async () => {
    const session = Transport.session('s1')
      .interceptPattern('items.', async () => Result.ok({ matched: true }))
      .build()

    const request = new TransportRequest(
      'items.getAll', 'GET', 'request', 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [], {}, null
    ).assignSerializer(jsonSerializer)
    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.isSuccess()).toBe(true)
    expect((result.value as any).matched).toBe(true)
  })

  it('request inspector can short circuit via session', async () => {
    const op = new TestGetOp()
    const session = Transport.session('s1')
      .intercept(op.handle(async () => Result.ok({ a: 'normal' })))
      .inspectRequest(async () => Result.failed(403, 'BLOCKED'))
      .build()

    const request = new TransportRequest(
      op.id, op.verb, op.type, 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [], { q: 'test' }, null
    ).assignSerializer(jsonSerializer)
    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.statusCode).toBe(403)
  })

  it('response inspector receives result via session', async () => {
    let inspectedResult: Result<object> | null = null
    const op = new TestGetOp()
    const session = Transport.session('s1')
      .intercept(op.handle(async () => Result.ok({ a: 'data' })))
      .inspectResponse(async (r) => { inspectedResult = r; return r })
      .build()

    const request = new TransportRequest(
      op.id, op.verb, op.type, 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [], { q: 'test' }, null
    ).assignSerializer(jsonSerializer)
    await session.acceptIncomingRequest(request.serialize())
    expect(inspectedResult).not.toBeNull()
  })

  it('acceptIncomingRequest routes request type', async () => {
    const op = new TestGetOp()
    const session = Transport.session('s1')
      .intercept(op.handle(async (input) => Result.ok({ a: (input as any).q + '!' })))
      .build()

    const request = new TransportRequest(
      op.id, op.verb, op.type, 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [],
      { q: 'hi' }, null
    ).assignSerializer(jsonSerializer)
    const json = request.serialize()

    const result = await session.acceptIncomingRequest(json)
    expect(result.isSuccess()).toBe(true)
  })

  it('acceptIncomingRequest routes message type', async () => {
    const op = new TestMsgOp()
    const handler = op.handle(async () => Result.ok())
    const session = Transport.session('s1')
      .intercept(handler)
      .build()

    // Build a serialized request
    const client = session.createClient('c1')
    const request = new TransportRequest(
      op.id, op.verb, op.type, 'c1', 'u1',
      'tx-1', '', 'en-GB', {}, [], [],
      { msg: 'hello' }, null
    ).assignSerializer(jsonSerializer)
    const json = request.serialize()

    const result = await session.acceptIncomingRequest(json)
    expect(result.isSuccess()).toBe(true)
  })

  it('acceptIncomingRequest appends custom attributes (no overwrite)', async () => {
    let capturedCtx: TransportContext | null = null
    const op = new TestGetOp()
    const session = Transport.session('s1')
      .intercept(op.handle(async (_input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ a: 'ok' })
      }))
      .build()

    const request = new TransportRequest(
      op.id, op.verb, op.type, 'c1', 'u1',
      'tx-1', '', 'en-GB', {},
      [new Attribute('existing', 'keep' as unknown as object)],
      [],
      { q: 'test' }, null
    ).assignSerializer(jsonSerializer)
    const json = request.serialize()

    await session.acceptIncomingRequest(json, [
      new Attribute('existing', 'should-not-overwrite' as unknown as object),
      new Attribute('new-attr', 'added' as unknown as object),
    ])

    expect(capturedCtx!.getAttribute('existing')).toBe('keep')
    expect(capturedCtx!.getAttribute('new-attr')).toBe('added')
  })
})
