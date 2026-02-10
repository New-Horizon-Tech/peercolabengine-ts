import { describe, it, expect } from 'vitest'
import {
  Transport, TransportClient, Result, TransportSerializer, Attribute,
  RequestOperation, MessageOperation, RequestOperationRequest, MessageOperationRequest,
  TransportContext,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

class GetItemOp extends RequestOperation<{ id: string }, { name: string }> {
  constructor() { super('items.get', 'GET') }
}

class NotifyOp extends MessageOperation<{ text: string }> {
  constructor() { super('notify.send', 'PROCESS') }
}

function buildSession() {
  const getOp = new GetItemOp()
  const msgOp = new NotifyOp()
  return Transport.session('test')
    .assignSerializer(jsonSerializer)
    .intercept(getOp.handle(async (input) => Result.ok({ name: 'item-' + input.id })))
    .intercept(msgOp.handle(async () => Result.ok()))
    .build()
}

describe('TransportClient immutability', () => {
  it('withLocale returns new client', () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = c1.withLocale('nb-NO')
    expect(c2).not.toBe(c1)
  })

  it('withDataTenant returns new client', () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = c1.withDataTenant('tenant-x')
    expect(c2).not.toBe(c1)
  })

  it('withCharacters returns new client', () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = c1.withCharacters({ performer: undefined, responsible: undefined, subject: undefined })
    expect(c2).not.toBe(c1)
  })

  it('addAttribute returns new client', () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = c1.addAttribute('key', 'value')
    expect(c2).not.toBe(c1)
  })

  it('removeAttribute returns new client', () => {
    const session = buildSession()
    const c1 = session.createClient('c1').addAttribute('key', 'val')
    const c2 = c1.removeAttribute('key')
    expect(c2).not.toBe(c1)
  })

  it('addPathParam / removePathParam return new clients', () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = c1.addPathParam('p1', 'v1')
    expect(c2).not.toBe(c1)
    const c3 = c2.removePathParam('p1')
    expect(c3).not.toBe(c2)
  })

  it('withTransactionId returns new client', async () => {
    const session = buildSession()
    const c1 = session.createClient('c1')
    const c2 = await c1.withTransactionId('tx-custom')
    expect(c2).not.toBe(c1)
  })
})

describe('TransportClient.request()', () => {
  it('sends RequestOperationRequest', async () => {
    const session = buildSession()
    const client = session.createClient('c1')
    const op = new GetItemOp()
    const result = await client.request(new RequestOperationRequest('u1', op, { id: '42' }))
    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ name: 'item-42' })
  })

  it('sends MessageOperationRequest', async () => {
    const session = buildSession()
    const client = session.createClient('c1')
    const op = new NotifyOp()
    const result = await client.request(new MessageOperationRequest('u1', op, { text: 'hi' }))
    expect(result.isSuccess()).toBe(true)
  })
})

describe('TransportClient.request() context verification', () => {
  it('request carries locale and tenant', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const client = session.createClient('c1')
      .withLocale('nb-NO')
      .withDataTenant('my-tenant')

    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.call.locale).toBe('nb-NO')
    expect(capturedCtx!.call.dataTenant).toBe('my-tenant')
  })

  it('request carries attributes', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const client = session.createClient('c1').addAttribute('key', 'val')
    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.hasAttribute('key')).toBe(true)
    expect(capturedCtx!.getAttribute('key')).toBe('val')
  })

  it('request carries path params', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const client = session.createClient('c1').addPathParam('itemId', '42')
    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.hasPathParameter('itemId')).toBe(true)
    expect(capturedCtx!.getPathParameter('itemId')).toBe('42')
  })

  it('request carries characters', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const chars = { performer: { id: 'p1', type: 'user' }, responsible: undefined, subject: undefined }
    const client = session.createClient('c1').withCharacters(chars)
    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.call.characters.performer?.id).toBe('p1')
  })

  it('addAttribute updates existing attribute', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const client = session.createClient('c1')
      .addAttribute('key', 'first')
      .addAttribute('key', 'second')
    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.getAttribute('key')).toBe('second')
  })

  it('addPathParam updates existing param', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const client = session.createClient('c1')
      .addPathParam('id', 'first')
      .addPathParam('id', 'second')
    await client.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.getPathParameter('id')).toBe('second')
  })

  it('immutability preserves base client state after branching', async () => {
    const getOp = new GetItemOp()
    let capturedCtx: TransportContext | null = null
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()

    const base = session.createClient('c1').withLocale('en-US')
    const derived = base.withLocale('nb-NO')

    await derived.request(new RequestOperationRequest('u1', getOp, { id: '1' }))
    expect(capturedCtx!.call.locale).toBe('nb-NO')

    await base.request(new RequestOperationRequest('u2', getOp, { id: '2' }))
    expect(capturedCtx!.call.locale).toBe('en-US')
  })
})

describe('TransportClient.acceptOperation()', () => {
  it('handles request type OutOfContextOperation', async () => {
    const session = buildSession()
    const client = session.createClient('c1')
    const result = await client.acceptOperation({
      usageId: 'u1',
      operationId: 'items.get',
      operationVerb: 'GET',
      operationType: 'request',
      requestJson: { id: '99' },
    })
    expect(result.isSuccess()).toBe(true)
  })

  it('handles message type OutOfContextOperation', async () => {
    const session = buildSession()
    const client = session.createClient('c1')
    const result = await client.acceptOperation({
      usageId: 'u1',
      operationId: 'notify.send',
      operationVerb: 'PROCESS',
      operationType: 'message',
      requestJson: { text: 'msg' },
    })
    expect(result.isSuccess()).toBe(true)
  })

  it('passes path parameters and custom attributes', async () => {
    let capturedCtx: TransportContext | null = null
    const getOp = new GetItemOp()
    const session = Transport.session('test')
      .assignSerializer(jsonSerializer)
      .intercept(getOp.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'ok' })
      }))
      .build()
    const client = session.createClient('c1')

    await client.acceptOperation(
      {
        usageId: 'u1',
        operationId: 'items.get',
        operationVerb: 'GET',
        operationType: 'request',
        requestJson: { id: '1' },
        pathParameters: [{ name: 'itemId', value: '123' }],
      },
      [new Attribute('custom', 'attr-val' as unknown as object)]
    )

    expect(capturedCtx!.hasPathParameter('itemId')).toBe(true)
    expect(capturedCtx!.getPathParameter('itemId')).toBe('123')
    expect(capturedCtx!.hasAttribute('custom')).toBe(true)
  })
})
