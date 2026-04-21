import { describe, it, expect } from 'vitest'
import {
  Transport, Result, TransportSerializer, TransportEvent, TransportContext,
  DispatchOperation, EventDispatchRequest, Attribute, OutOfContextEvent,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

class ItemCreatedEvent extends DispatchOperation<{ itemId: string }> {
  constructor() { super('items.itemCreated', 'action') }
}

class ItemUpdatedEvent extends DispatchOperation<{ itemId: string }> {
  constructor() { super('items.itemUpdated', 'action') }
}

describe('TransportEvent', () => {
  it('serialize and deserialize round-trip', () => {
    const te = new TransportEvent(
      'items.itemCreated', 'action', 'client-1', 'usage-1',
      'tx-1', 'tenant-1', 'en-GB',
      { performer: undefined, responsible: undefined, subject: undefined },
      [new Attribute('a1', 'v1' as unknown as object)],
      [new Attribute('p1', 'pv1' as unknown as object)],
      { itemId: '123' },
      null,
      'corr-1'
    ).assignSerializer(jsonSerializer)

    const serialized = te.serialize()
    const restored = TransportEvent.fromSerialized<{ itemId: string }>(jsonSerializer, serialized)

    expect(restored.eventId).toBe('items.itemCreated')
    expect(restored.eventType).toBe('action')
    expect(restored.callingClient).toBe('client-1')
    expect(restored.usageId).toBe('usage-1')
    expect(restored.transactionId).toBe('tx-1')
    expect(restored.dataTenant).toBe('tenant-1')
    expect(restored.correlationId).toBe('corr-1')
    expect(restored.requestJson).toEqual({ itemId: '123' })
  })

  it('correlationId is optional', () => {
    const te = new TransportEvent(
      'e', 'action', 'c', 'u', 'tx', 'dt', 'en',
      {}, [], [], { x: 1 }, null
    ).assignSerializer(jsonSerializer)

    const restored = TransportEvent.fromSerialized<{ x: number }>(jsonSerializer, te.serialize())
    expect(restored.correlationId).toBeUndefined()
  })

  it('from(ctx) carries correlationId from call info', () => {
    const ev = new ItemCreatedEvent()
    const request = new EventDispatchRequest('u1', ev, { itemId: '123' })
    const ctx = new TransportContext(
      request.asOperationInformation('client-1'),
      {
        locale: 'en-GB',
        dataTenant: 't',
        characters: {},
        attributes: [],
        pathParams: [],
        transactionId: 'tx-1',
        correlationId: 'corr-xyz',
      } as any,
      jsonSerializer
    )
    const te = TransportEvent.from({ itemId: '123' }, ctx)
    expect(te.correlationId).toBe('corr-xyz')
  })
})

describe('Transport.session().subscribe() + client.dispatch()', () => {
  it('single subscriber receives dispatched event and returns ok', async () => {
    const ev = new ItemCreatedEvent()
    let received: { itemId: string } | null = null

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async (input) => {
        received = input
        return Result.ok()
      }))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '123' }))

    expect(result.isSuccess()).toBe(true)
    expect(received).toEqual({ itemId: '123' })
  })

  it('no subscribers returns handler-not-found', async () => {
    const ev = new ItemCreatedEvent()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '123' }))

    expect(result.isSuccess()).toBe(false)
    expect(result.error?.code).toBe('TransportSession.HandlerNotFound')
  })

  it('fan-out: all subscribers for same event id are invoked', async () => {
    const ev = new ItemCreatedEvent()
    const calls: string[] = []

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => { calls.push('a'); return Result.ok() }))
      .subscribe(ev.handle(async () => { calls.push('b'); return Result.ok() }))
      .subscribe(ev.handle(async () => { calls.push('c'); return Result.ok() }))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '123' }))

    expect(result.isSuccess()).toBe(true)
    expect(calls.sort()).toEqual(['a', 'b', 'c'])
  })

  it('failing subscribers surface as related errors while others run', async () => {
    const ev = new ItemCreatedEvent()
    let okRan = false

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => Result.failed(500, 'Subscriber.A.Failed', 'a failed')))
      .subscribe(ev.handle(async () => { okRan = true; return Result.ok() }))
      .subscribe(ev.handle(async () => Result.failed(500, 'Subscriber.B.Failed', 'b failed')))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '123' }))

    expect(okRan).toBe(true)
    expect(result.isSuccess()).toBe(false)
    expect(result.error?.code).toBe('TransportSession.DispatchPartialFailure')
    expect(result.error?.related).toHaveLength(2)
    const codes = result.error!.related.map(e => e.code).sort()
    expect(codes).toEqual(['Subscriber.A.Failed', 'Subscriber.B.Failed'])
  })

  it('thrown exceptions in a subscriber are captured as related error', async () => {
    const ev = new ItemCreatedEvent()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => { throw new Error('boom') }))
      .subscribe(ev.handle(async () => Result.ok()))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '123' }))

    expect(result.isSuccess()).toBe(false)
    expect(result.error?.related).toHaveLength(1)
    expect(result.error?.related[0].code).toBe('TransportSession.UnhandledError')
  })
})

describe('subscribePattern', () => {
  it('pattern handler receives events whose id starts with the pattern', async () => {
    const created = new ItemCreatedEvent()
    const updated = new ItemUpdatedEvent()
    const received: string[] = []

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribePattern('items.', async (_input, ctx) => {
        received.push(ctx.operation.id)
        return Result.ok()
      })
      .build()

    const client = session.createClient('c1')
    await client.dispatch(new EventDispatchRequest('u1', created, { itemId: '1' }))
    await client.dispatch(new EventDispatchRequest('u1', updated, { itemId: '2' }))

    expect(received.sort()).toEqual(['items.itemCreated', 'items.itemUpdated'])
  })

  it('specific and pattern subscribers both fire (fan-out)', async () => {
    const ev = new ItemCreatedEvent()
    const calls: string[] = []

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => { calls.push('specific'); return Result.ok() }))
      .subscribePattern('items.', async () => { calls.push('pattern'); return Result.ok() })
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: '1' }))

    expect(result.isSuccess()).toBe(true)
    expect(calls.sort()).toEqual(['pattern', 'specific'])
  })
})

describe('TransportSession.acceptIncomingEvent', () => {
  it('routes a serialized TransportEvent to subscribers', async () => {
    const ev = new ItemCreatedEvent()
    let received: { itemId: string } | null = null

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async (input) => { received = input; return Result.ok() }))
      .build()

    const incoming = new TransportEvent(
      ev.id, ev.verb, 'remote-client', 'u-99',
      'tx-99', 'tenant', 'en-GB', {}, [], [],
      { itemId: '999' }, null, 'corr-99'
    ).assignSerializer(jsonSerializer)

    const result = await session.acceptIncomingEvent(incoming.serialize())

    expect(result.isSuccess()).toBe(true)
    expect(received).toEqual({ itemId: '999' })
  })

  it('correlationId survives the serialize/accept boundary', async () => {
    const ev = new ItemCreatedEvent()
    let capturedCorrelation: string | undefined

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async (_input, ctx) => {
        capturedCorrelation = ctx.call.correlationId
        return Result.ok()
      }))
      .build()

    const incoming = new TransportEvent(
      ev.id, ev.verb, 'rc', 'u', 'tx', 'dt', 'en-GB', {}, [], [],
      { itemId: 'x' }, null, 'my-correlation'
    ).assignSerializer(jsonSerializer)

    await session.acceptIncomingEvent(incoming.serialize())
    expect(capturedCorrelation).toBe('my-correlation')
  })
})

describe('TransportSession.acceptEvent (out-of-context)', () => {
  it('routes an OutOfContextEvent to subscribers', async () => {
    const ev = new ItemCreatedEvent()
    let received: { itemId: string } | null = null

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async (input) => { received = input; return Result.ok() }))
      .build()

    const ooce: OutOfContextEvent = {
      usageId: 'u-1',
      eventId: ev.id,
      eventType: ev.verb,
      requestJson: { itemId: 'abc' },
      correlationId: 'corr-1',
    }

    const result = await session.acceptEvent(ooce)

    expect(result.isSuccess()).toBe(true)
    expect(received).toEqual({ itemId: 'abc' })
  })
})

describe('TransportClient.dispatch timeout', () => {
  it('returns timeout error when subscriber does not complete in time', async () => {
    const ev = new ItemCreatedEvent()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return Result.ok()
      }))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: 'x' }), 20)

    expect(result.isSuccess()).toBe(false)
    expect(result.error?.code).toBe('TransportSession.DispatchTimeout')
  })

  it('clears timer when subscriber completes first', async () => {
    const ev = new ItemCreatedEvent()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async () => Result.ok()))
      .build()

    const client = session.createClient('c1')
    const result = await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: 'x' }), 500)

    expect(result.isSuccess()).toBe(true)
  })
})

describe('TransportClient.withCorrelationId', () => {
  it('returns a new client', () => {
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .build()
    const c1 = session.createClient('c1')
    const c2 = c1.withCorrelationId('corr-42')
    expect(c2).not.toBe(c1)
  })

  it('correlationId flows from client into subscriber context', async () => {
    const ev = new ItemCreatedEvent()
    let captured: string | undefined

    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .subscribe(ev.handle(async (_input, ctx) => {
        captured = ctx.call.correlationId
        return Result.ok()
      }))
      .build()

    const client = session.createClient('c1').withCorrelationId('corr-42')
    await client.dispatch(new EventDispatchRequest('u1', ev, { itemId: 'x' }))

    expect(captured).toBe('corr-42')
  })
})
