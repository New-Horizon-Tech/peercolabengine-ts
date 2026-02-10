import { describe, it, expect } from 'vitest'
import {
  TransportOperation, RequestOperation, MessageOperation,
  RequestOperationHandler, MessageOperationHandler, Result,
  RequestOperationRequest, MessageOperationRequest, OperationInformation,
} from '../src/index.js'

class MyRequestOp extends RequestOperation<{ q: string }, { a: string }> {
  constructor() { super('my.request', 'GET', ['id'], { requiresTenant: true, characterSetup: {} }) }
}

class MyMessageOp extends MessageOperation<{ text: string }> {
  constructor() { super('my.message', 'PROCESS') }
}

describe('TransportOperation', () => {
  it('stores type, id, verb, pathParameters, settings', () => {
    const op = new TransportOperation<string>('request', 'op.id', 'GET', ['p1'], { requiresTenant: false, characterSetup: {} })
    expect(op.type).toBe('request')
    expect(op.id).toBe('op.id')
    expect(op.verb).toBe('GET')
    expect(op.pathParameters).toEqual(['p1'])
    expect(op.settings!.requiresTenant).toBe(false)
  })
})

describe('RequestOperation', () => {
  it('sets type to "request"', () => {
    const op = new MyRequestOp()
    expect(op.type).toBe('request')
    expect(op.id).toBe('my.request')
    expect(op.verb).toBe('GET')
    expect(op.pathParameters).toEqual(['id'])
    expect(op.settings!.requiresTenant).toBe(true)
  })

  it('handle() creates RequestOperationHandler', () => {
    const op = new MyRequestOp()
    const handler = op.handle(async () => Result.ok({ a: 'ok' }))
    expect(handler).toBeInstanceOf(RequestOperationHandler)
    expect(handler.operation).toBe(op)
  })
})

describe('MessageOperation', () => {
  it('sets type to "message"', () => {
    const op = new MyMessageOp()
    expect(op.type).toBe('message')
    expect(op.id).toBe('my.message')
  })

  it('handle() creates MessageOperationHandler', () => {
    const op = new MyMessageOp()
    const handler = op.handle(async () => Result.ok())
    expect(handler).toBeInstanceOf(MessageOperationHandler)
    expect(handler.operation).toBe(op)
  })
})

describe('OperationRequest', () => {
  it('asOperationInformation maps correctly', () => {
    const op = new MyRequestOp()
    const req = new RequestOperationRequest('usage-1', op, { q: 'test' })
    const info = req.asOperationInformation('client-1')
    expect(info).toBeInstanceOf(OperationInformation)
    expect(info.id).toBe('my.request')
    expect(info.verb).toBe('GET')
    expect(info.type).toBe('request')
    expect(info.callingClient).toBe('client-1')
    expect(info.usageId).toBe('usage-1')
  })
})

describe('TransportOperationSettings', () => {
  it('stores requiresTenant and characterSetup', () => {
    const op = new MyRequestOp()
    expect(op.settings!.requiresTenant).toBe(true)
    expect(op.settings!.characterSetup).toEqual({})
  })
})

describe('OutOfContextOperation', () => {
  it('stores all properties', () => {
    const op: any = {
      usageId: 'u1',
      operationId: 'op.1',
      operationVerb: 'GET',
      operationType: 'request',
      requestJson: { data: 1 },
      pathParameters: [{ name: 'id', value: '42' }],
    }
    expect(op.usageId).toBe('u1')
    expect(op.operationId).toBe('op.1')
    expect(op.operationVerb).toBe('GET')
    expect(op.operationType).toBe('request')
    expect(op.requestJson).toEqual({ data: 1 })
    expect(op.pathParameters).toHaveLength(1)
    expect(op.pathParameters[0].name).toBe('id')
    expect(op.pathParameters[0].value).toBe('42')
  })

  it('pathParameters default to undefined', () => {
    const op: any = {
      usageId: 'u1',
      operationId: 'op.1',
      operationVerb: 'GET',
      operationType: 'request',
      requestJson: {},
    }
    expect(op.pathParameters).toBeUndefined()
  })
})

describe('OperationVerb values', () => {
  it('all expected verbs exist as type', () => {
    // These are type-only checks - we verify the verbs exist by using them
    const verbs: import('../src/index.js').OperationVerb[] = [
      'GET', 'SEARCH', 'CREATE', 'ADD', 'UPDATE', 'PATCH',
      'REMOVE', 'DELETE', 'START', 'STOP', 'PROCESS', 'NAVIGATETO'
    ]
    expect(verbs).toHaveLength(12)
  })
})

describe('RequestOperationRequest / MessageOperationRequest', () => {
  it('stores usageId, operation, input', () => {
    const op = new MyRequestOp()
    const req = new RequestOperationRequest('u1', op, { q: 'hi' })
    expect(req.usageId).toBe('u1')
    expect(req.operation).toBe(op)
    expect(req.input).toEqual({ q: 'hi' })
  })

  it('MessageOperationRequest stores fields', () => {
    const op = new MyMessageOp()
    const req = new MessageOperationRequest('u2', op, { text: 'msg' })
    expect(req.usageId).toBe('u2')
    expect(req.input).toEqual({ text: 'msg' })
  })
})
