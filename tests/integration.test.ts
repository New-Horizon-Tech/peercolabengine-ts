import { describe, it, expect } from 'vitest'
import {
  Transport, Result, TransportContext, TransportRequest, TransportSerializer,
  RequestOperation, MessageOperation, RequestOperationRequest, MessageOperationRequest,
  Metavalues, Metavalue, Identifier, CharacterMetaValues, ResultPassthroughAsync,
  Attribute, TransportError,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

class GetItemsOp extends RequestOperation<{ query: string }, { items: string[] }> {
  constructor() { super('items.get', 'GET') }
}

class CreateItemOp extends RequestOperation<{ name: string }, { id: string }> {
  constructor() { super('items.create', 'CREATE') }
}

class NotifyOp extends MessageOperation<{ text: string }> {
  constructor() { super('notify.send', 'PROCESS') }
}

describe('Integration', () => {
  it('end-to-end inbound request handling', async () => {
    const op = new GetItemsOp()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(op.handle(async (input) => Result.ok({ items: ['a', 'b'] })))
      .build()

    const request = new TransportRequest(
      op.id, op.verb, op.type, 'client-1', 'usage-1',
      'tx-1', 'tenant', 'en-GB', {}, [], [],
      { query: 'test' }, null
    ).assignSerializer(jsonSerializer)

    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.isSuccess()).toBe(true)
    expect((result.value as any).items).toEqual(['a', 'b'])
  })

  it('end-to-end client to session communication', async () => {
    const getOp = new GetItemsOp()
    const createOp = new CreateItemOp()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input) => Result.ok({ items: [input.query] })))
      .intercept(createOp.handle(async (input) => Result.ok({ id: 'new-' + input.name })))
      .build()

    const client = session.createClient('c1')

    const r1 = await client.request(new RequestOperationRequest('u1', getOp, { query: 'foo' }))
    expect(r1.isSuccess()).toBe(true)
    expect(r1.value).toEqual({ items: ['foo'] })

    const r2 = await client.request(new RequestOperationRequest('u2', createOp, { name: 'bar' }))
    expect(r2.isSuccess()).toBe(true)
    expect(r2.value).toEqual({ id: 'new-bar' })
  })

  it('end-to-end outbound session communication', async () => {
    const getOp = new GetItemsOp()
    const builder = Transport.session('inbound')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async () => Result.ok({ items: ['x'] })))

    const outbound = builder.outboundSessionBuilder('outbound-svc')
      .intercept(getOp.handle(async () => Result.ok({ items: ['outbound-item'] })))
      .build()

    const client = outbound.asIndependentRequests()
    const result = await client.request(new RequestOperationRequest('u1', getOp, { query: 'q' }))
    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ items: ['outbound-item'] })
  })

  it('end-to-end request and response inspection', async () => {
    const op = new GetItemsOp()
    const inspectedRequests: object[] = []
    const inspectedResponses: Result<object>[] = []

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(op.handle(async () => Result.ok({ items: ['a'] })))
      .inspectRequest(async (input, ctx) => { inspectedRequests.push(input) })
      .inspectResponse(async (result, input, ctx) => { inspectedResponses.push(result); return result })
      .build()

    const client = session.createClient('c1')
    await client.request(new RequestOperationRequest('u1', op, { query: 'test' }))

    expect(inspectedRequests).toHaveLength(1)
    expect(inspectedResponses).toHaveLength(1)
    expect(inspectedResponses[0]!.isSuccess()).toBe(true)
  })

  it('end-to-end result chaining with maybe pattern', () => {
    const r = Result.ok(10)
      .maybe(v => Result.ok(v * 2))
      .maybe(v => Result.ok(v + 5))
    expect(r.value).toBe(25)
  })

  it('end-to-end result chaining maybe stops on error', () => {
    let thirdCalled = false
    const r = Result.ok(10)
      .maybe(v => Result.ok(v * 2))
      .maybe(() => Result.failed(400, 'STOP'))
      .maybe(() => { thirdCalled = true; return Result.ok(999) })
    expect(r.isSuccess()).toBe(false)
    expect(thirdCalled).toBe(false)
  })

  it('end-to-end async pipeline with ResultPassthroughAsync', async () => {
    const results: number[] = []
    const r = await ResultPassthroughAsync
      .startWith(async () => { results.push(1); return Result.ok('initial') })
      .then(async () => { results.push(2); return Result.ok() })
      .then(async () => { results.push(3); return Result.ok() })
      .run()
    expect(r.isSuccess()).toBe(true)
    expect(r.value).toBe('initial')
    expect(results).toEqual([1, 2, 3])
  })

  it('end-to-end metadata flow', async () => {
    const op = new GetItemsOp()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(op.handle(async () => {
        const meta = new Metavalues()
        meta.setHasMoreValues(true)
        meta.setTotalValueCount(100)
        const mv = Metavalue.with('v1', 'tenant', new Identifier('p1', 'user'))
        meta.add(mv)
        return Result.ok({ items: ['a'] }, meta)
      }))
      .build()

    const client = session.createClient('c1')
    const result = await client.request(new RequestOperationRequest('u1', op, { query: 'q' }))
    expect(result.isSuccess()).toBe(true)
    expect(result.meta.hasMoreValues).toBe(true)
    expect(result.meta.totalValueCount).toBe(100)
    expect(result.meta.values).toHaveLength(1)
  })

  it('end-to-end error propagation', async () => {
    const op = new GetItemsOp()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(op.handle(async () => {
        return Result.failed(422, TransportError.basic('VALIDATION', 'Field required', 'Please fill in all fields'))
      }))
      .build()

    const client = session.createClient('c1')
    const result = await client.request(new RequestOperationRequest('u1', op, { query: '' }))
    expect(result.isSuccess()).toBe(false)
    expect(result.statusCode).toBe(422)
    expect(result.error!.code).toBe('VALIDATION')
    expect(result.error!.details.technicalError).toBe('Field required')
    expect(result.error!.details.userError).toBe('Please fill in all fields')
  })

  it('end-to-end multiple pattern handlers', async () => {
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .interceptPattern('items.', async () => Result.ok({ handler: 'items' }))
      .interceptPattern('items.admin.', async () => Result.ok({ handler: 'items.admin' }))
      .build()

    const client = session.createClient('c1')

    // items.admin.delete should match the longer pattern
    const r1 = await client.request(new RequestOperationRequest('u1',
      { id: 'items.admin.delete', type: 'request', verb: 'DELETE' } as any,
      {}))
    expect((r1.value as any).handler).toBe('items.admin')

    // items.list should match the shorter pattern
    const r2 = await client.request(new RequestOperationRequest('u2',
      { id: 'items.list', type: 'request', verb: 'GET' } as any,
      {}))
    expect((r2.value as any).handler).toBe('items')
  })

  it('end-to-end context propagation', async () => {
    let capturedCtx: TransportContext | null = null
    const op = new GetItemsOp()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(op.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ items: [] })
      }))
      .build()

    const client = session.createClient('c1', 'my-tenant')
      .withLocale('nb-NO')
      .addAttribute('userId', 'u123')
      .addPathParam('itemId', '456')

    await client.request(new RequestOperationRequest('u1', op, { query: 'test' }))

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx!.call.locale).toBe('nb-NO')
    expect(capturedCtx!.call.dataTenant).toBe('my-tenant')
    expect(capturedCtx!.hasAttribute('userId')).toBe(true)
    expect(capturedCtx!.getAttribute('userId')).toBe('u123')
    expect(capturedCtx!.hasPathParameter('itemId')).toBe(true)
    expect(capturedCtx!.getPathParameter('itemId')).toBe('456')
  })
})
