import { describe, it, expect } from 'vitest'
import {
  OutboundSessionBuilder, OutboundClientFactory, InMemoryContextCache,
  TransportSerializer, TransportClient, Result, CallInformation,
  RequestOperation, MessageOperation, RequestOperationRequest, MessageOperationRequest,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

class TestReqOp extends RequestOperation<{ q: string }, { a: string }> {
  constructor() { super('test.req', 'GET') }
}

class TestMsgOp extends MessageOperation<{ text: string }> {
  constructor() { super('test.msg', 'PROCESS') }
}

describe('OutboundSessionBuilder', () => {
  it('fluent API returns builder', () => {
    const builder = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
    expect(builder.inspectRequest(async () => {})).toBe(builder)
    expect(builder.inspectResponse(async (r) => r)).toBe(builder)
    expect(builder.interceptPattern('test.', async () => Result.ok())).toBe(builder)
  })

  it('intercept adds request handler', () => {
    const op = new TestReqOp()
    const builder = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
    expect(builder.intercept(op.handle(async () => Result.ok({ a: 'ok' })))).toBe(builder)
  })

  it('intercept adds message handler', () => {
    const op = new TestMsgOp()
    const builder = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
    expect(builder.intercept(op.handle(async () => Result.ok()))).toBe(builder)
  })

  it('build() returns OutboundClientFactory', () => {
    const builder = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
    const factory = builder.build()
    expect(factory).toBeInstanceOf(OutboundClientFactory)
  })
})

describe('OutboundClientFactory', () => {
  it('forIncomingRequest creates client with transaction ID', async () => {
    const cache = new InMemoryContextCache()
    const callInfo = CallInformation.new('en-US', 'tenant', 'tx-original')
    await cache.put('tx-original', callInfo)

    const factory = new OutboundSessionBuilder('svc', cache, jsonSerializer).build()
    const client = await factory.forIncomingRequest('tx-original')
    expect(client).toBeInstanceOf(TransportClient)
  })

  it('asIndependentRequests creates standalone client', () => {
    const factory = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer).build()
    const client = factory.asIndependentRequests()
    expect(client).toBeInstanceOf(TransportClient)
  })

  it('asIndependentRequests can execute request', async () => {
    const op = new TestReqOp()
    const factory = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
      .intercept(op.handle(async (input) => Result.ok({ a: input.q + '!' })))
      .build()
    const client = factory.asIndependentRequests()
    const result = await client.request(new RequestOperationRequest('u1', op, { q: 'hi' }))
    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ a: 'hi!' })
  })

  it('message handler works through outbound', async () => {
    const op = new TestMsgOp()
    const factory = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
      .intercept(op.handle(async () => Result.ok()))
      .build()
    const client = factory.asIndependentRequests()
    const result = await client.request(new MessageOperationRequest('u1', op, { text: 'msg' }))
    expect(result.isSuccess()).toBe(true)
  })

  it('pattern handler works through outbound', async () => {
    const factory = new OutboundSessionBuilder('svc', new InMemoryContextCache(), jsonSerializer)
      .interceptPattern('items.', async () => Result.ok({ matched: true }))
      .build()
    const client = factory.asIndependentRequests()
    const result = await client.request(new RequestOperationRequest('u1',
      { id: 'items.list', type: 'request', verb: 'GET' } as any, {}))
    expect(result.isSuccess()).toBe(true)
    expect((result.value as any).matched).toBe(true)
  })
})
