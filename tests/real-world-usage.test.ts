import { describe, it, expect } from 'vitest'
import {
  Transport, TransportSession, TransportClient, TransportContext, TransportRequest,
  TransportSerializer, Result, Metavalues, Metavalue, CharacterMetaValues, Identifier,
  TransportError, Attribute, InMemoryContextCache, CallInformation,
  RequestOperation, MessageOperation, RequestOperationRequest, MessageOperationRequest,
  OutboundSessionBuilder, OutboundClientFactory, ResultPassthroughAsync,
  OutOfContextOperation, TransportOperationSettings, TransportSessionBuilder,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

// --- Operation definitions mirroring petkey-owner style ---

class GetPet extends RequestOperation<{ petId: string }, { name: string; breed: string }> {
  constructor() {
    super('petkey.pet.get', 'GET', ['petId'], {
      requiresTenant: true,
      characterSetup: {
        performer: { required: true, validTypes: ['user'] },
        responsible: undefined,
        subject: undefined,
      }
    })
  }
}

class UpdatePet extends MessageOperation<{ petId: string; name: string }> {
  constructor() {
    super('petkey.pet.update', 'UPDATE', ['petId'], {
      requiresTenant: true,
      characterSetup: {
        performer: { required: true },
        responsible: undefined,
        subject: undefined,
      }
    })
  }
}

class CreatePet extends RequestOperation<{ name: string; breed: string }, { id: string }> {
  constructor() {
    super('petkey.pet.create', 'CREATE', [], {
      requiresTenant: true,
      characterSetup: {
        performer: { required: true },
        responsible: undefined,
        subject: undefined,
      }
    })
  }
}

class ExtractInfo extends RequestOperation<{ fileId: string }, { extracted: string }> {
  constructor() {
    super('petkey.agent.extractInfo', 'PROCESS', [], {
      requiresTenant: true,
      characterSetup: {
        performer: { required: true },
        responsible: undefined,
        subject: undefined,
      }
    })
  }
}

class GetTasks extends RequestOperation<object, { tasks: string[] }> {
  constructor() {
    super('petkey.tasks.get', 'GET', ['dataSource'], {
      requiresTenant: false,
      characterSetup: {}
    })
  }
}

// --- Tests ---

describe('Operation .handle() -> builder.intercept() pattern', () => {
  it('registers request operation via .handle() and executes', async () => {
    const getPet = new GetPet()
    const session = Transport.session('PetKeyServer')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        return Result.ok({ name: 'Buddy', breed: 'Labrador' })
      }))
      .build()

    const client = session.createClient('MobileClient')
    const result = await client.request(
      new RequestOperationRequest('u1', getPet, { petId: 'pet-1' })
    )
    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ name: 'Buddy', breed: 'Labrador' })
  })

  it('registers message operation via .handle() and executes', async () => {
    const updatePet = new UpdatePet()
    const session = Transport.session('PetKeyServer')
      .assignSerializer(jsonSerializer)
      .intercept(updatePet.handle(async (input, ctx) => {
        return Result.ok()
      }))
      .build()

    const client = session.createClient('MobileClient')
    const result = await client.request(
      new MessageOperationRequest('u1', updatePet, { petId: 'pet-1', name: 'Rex' })
    )
    expect(result.isSuccess()).toBe(true)
  })

  it('operation carries settings (requiresTenant, characterSetup)', () => {
    const op = new GetPet()
    expect(op.settings).toBeDefined()
    expect(op.settings!.requiresTenant).toBe(true)
    expect(op.settings!.characterSetup.performer).toBeDefined()
    expect(op.settings!.characterSetup.performer!.required).toBe(true)
    expect(op.settings!.characterSetup.performer!.validTypes).toEqual(['user'])
  })

  it('operation carries path parameters', () => {
    const op = new GetPet()
    expect(op.pathParameters).toEqual(['petId'])
  })

  it('multiple operations registered on same session', async () => {
    const getPet = new GetPet()
    const createPet = new CreatePet()
    const updatePet = new UpdatePet()
    const session = Transport.session('PetKeyServer')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async () => Result.ok({ name: 'Buddy', breed: 'Lab' })))
      .intercept(createPet.handle(async (input) => Result.ok({ id: 'new-' + input.name })))
      .intercept(updatePet.handle(async () => Result.ok()))
      .build()

    const client = session.createClient('MobileClient')
    const r1 = await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))
    expect(r1.value).toEqual({ name: 'Buddy', breed: 'Lab' })

    const r2 = await client.request(new RequestOperationRequest('u2', createPet, { name: 'Rex', breed: 'Poodle' }))
    expect(r2.value).toEqual({ id: 'new-Rex' })

    const r3 = await client.request(new MessageOperationRequest('u3', updatePet, { petId: 'p1', name: 'New Name' }))
    expect(r3.isSuccess()).toBe(true)
  })
})

describe('Outbound builder intercept and context forwarding', () => {
  it('outbound builder intercept with .handle() pattern', async () => {
    const extractOp = new ExtractInfo()
    const builder = Transport.session('InboundServer')
      .assignSerializer(jsonSerializer)

    const outbound = builder.outboundSessionBuilder('AgentService')
      .intercept(extractOp.handle(async (input) => Result.ok({ extracted: 'data-' + input.fileId })))
      .build()

    const client = outbound.asIndependentRequests()
    const result = await client.request(
      new RequestOperationRequest('u1', extractOp, { fileId: 'f1' })
    )
    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ extracted: 'data-f1' })
  })

  it('outbound interceptPattern with .handle() on builder', async () => {
    const builder = Transport.session('InboundServer')
      .assignSerializer(jsonSerializer)

    const outbound = builder.outboundSessionBuilder('AgentService')
      .interceptPattern('petkey.agent.', async (input) => Result.ok({ routed: true }))
      .build()

    const client = outbound.asIndependentRequests()
    const result = await client.request(new RequestOperationRequest('u1',
      { id: 'petkey.agent.extractInfo', type: 'request', verb: 'PROCESS' } as any,
      { fileId: 'f1' }))
    expect(result.isSuccess()).toBe(true)
    expect((result.value as any).routed).toBe(true)
  })

  it('forIncomingRequest propagates cached context (locale, tenant, attributes, characters)', async () => {
    const cache = new InMemoryContextCache()
    const callInfo = CallInformation.new('nb-NO', 'tenant-1', 'tx-inbound')
    callInfo.characters = { performer: { id: 'user-1', type: 'user' } }
    callInfo.attributes = [new Attribute('userId', 'u123' as unknown as object)]
    callInfo.pathParams = [new Attribute('petId', 'pet-42' as unknown as object)]
    await cache.put('tx-inbound', callInfo)

    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()

    const outbound = new OutboundSessionBuilder('PetService', cache, jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))
      .build()

    const client = await outbound.forIncomingRequest('tx-inbound')
    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'pet-42' }))

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx!.call.locale).toBe('nb-NO')
    expect(capturedCtx!.call.dataTenant).toBe('tenant-1')
    expect(capturedCtx!.call.characters.performer?.id).toBe('user-1')
    expect(capturedCtx!.hasAttribute('userId')).toBe(true)
    expect(capturedCtx!.getAttribute('userId')).toBe('u123')
    expect(capturedCtx!.call.transactionId).toBe('tx-inbound')
  })
})

describe('acceptIncomingRequest with characters', () => {
  it('characters survive serialize -> acceptIncomingRequest round-trip', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('PetSystemServer')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))
      .build()

    const request = new TransportRequest(
      'petkey.pet.get', 'GET', 'request', 'MobileClient', 'usage-1',
      'tx-1', 'tenant-1', 'nb-NO',
      { performer: { id: 'user-123', type: 'user' }, responsible: { id: 'org-1', type: 'org' }, subject: { id: 'pet-1', type: 'pet' } },
      [new Attribute('userId', 'user-123' as unknown as object), new Attribute('username', 'john' as unknown as object)],
      [new Attribute('petId', 'pet-1' as unknown as object)],
      { petId: 'pet-1' }, null
    ).assignSerializer(jsonSerializer)

    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.isSuccess()).toBe(true)

    // Verify characters came through
    expect(capturedCtx!.call.characters.performer?.id).toBe('user-123')
    expect(capturedCtx!.call.characters.performer?.type).toBe('user')
    expect(capturedCtx!.call.characters.responsible?.id).toBe('org-1')
    expect(capturedCtx!.call.characters.subject?.id).toBe('pet-1')
  })

  it('acceptIncomingRequest with custom attributes does not overwrite existing', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))
      .build()

    const request = new TransportRequest(
      'petkey.pet.get', 'GET', 'request', 'client', 'u1',
      'tx-1', '', 'en-GB',
      { performer: { id: 'user-1', type: 'user' } },
      [new Attribute('userId', 'original' as unknown as object)],
      [], { petId: 'p1' }, null
    ).assignSerializer(jsonSerializer)

    await session.acceptIncomingRequest(
      request.serialize(),
      [
        new Attribute('userId', 'should-not-overwrite' as unknown as object),
        new Attribute('fullName', 'John Doe' as unknown as object),
      ]
    )

    expect(capturedCtx!.getAttribute('userId')).toBe('original')
    expect(capturedCtx!.getAttribute('fullName')).toBe('John Doe')
  })

  it('acceptIncomingRequest handles message type', async () => {
    const updatePet = new UpdatePet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(updatePet.handle(async () => Result.ok()))
      .build()

    const request = new TransportRequest(
      'petkey.pet.update', 'UPDATE', 'message', 'client', 'u1',
      'tx-1', '', 'en-GB', {}, [], [],
      { petId: 'p1', name: 'Rex' }, null
    ).assignSerializer(jsonSerializer)

    const result = await session.acceptIncomingRequest(request.serialize())
    expect(result.isSuccess()).toBe(true)
  })
})

describe('TransportContext.serializeRequest / deserializeResult flow', () => {
  it('interceptor can serialize outbound request and deserialize result', async () => {
    // Simulates: inbound handler makes an "outbound call" by serializing request,
    // then deserializing the response (the real-world pattern from petkey-owner)
    let serializedOutboundRequest: string | null = null
    let deserializedOutboundResult: Result<{ extracted: string }> | null = null

    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        // Simulate making an outbound call within the interceptor
        serializedOutboundRequest = ctx.serializeRequest({ fileId: 'f-abc' })

        // Simulate receiving a serialized response
        const mockResponse = Result.ok({ extracted: 'data-from-agent' })
        mockResponse.assignSerializer(jsonSerializer)
        const mockResponseJson = mockResponse.serialize()

        // Deserialize it as an interceptor would
        deserializedOutboundResult = ctx.deserializeResult<{ extracted: string }>(mockResponseJson)

        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))
      .build()

    const client = session.createClient('c1')
    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))

    // Verify the outbound request was properly serialized
    expect(serializedOutboundRequest).not.toBeNull()
    const parsed = JSON.parse(serializedOutboundRequest!)
    expect(parsed.requestJson).toEqual({ fileId: 'f-abc' })
    expect(parsed.operationId).toBe('petkey.pet.get')

    // Verify the response was properly deserialized
    expect(deserializedOutboundResult).not.toBeNull()
    expect(deserializedOutboundResult!.isSuccess()).toBe(true)
    expect(deserializedOutboundResult!.value).toEqual({ extracted: 'data-from-agent' })
  })

  it('serializeRequest preserves transactionId, locale, tenant, and characters', async () => {
    let serializedRequest: string | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        serializedRequest = ctx.serializeRequest({ outboundData: true })
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()

    const client = session.createClient('c1', 'my-tenant')
      .withLocale('nb-NO')
      .withCharacters({ performer: { id: 'user-1', type: 'user' } })

    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))

    const parsed = JSON.parse(serializedRequest!)
    expect(parsed.locale).toBe('nb-NO')
    expect(parsed.dataTenant).toBe('my-tenant')
    expect(parsed.characters.performer.id).toBe('user-1')
    expect(parsed.requestJson).toEqual({ outboundData: true })
  })

  it('deserializeResult restores metadata with metavalues and characters', async () => {
    let restored: Result<{ data: number }> | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        // Build a rich response simulating what a remote server would return
        const meta = new Metavalues()
        meta.setHasMoreValues(true)
        meta.setTotalValueCount(50)
        meta.withAttribute('source', 'remote' as unknown as object)
        const mv = Metavalue.with('rec-1', 'tenant-1',
          new Identifier('creator-1', 'user'), new Date(2024, 0, 1),
          new Identifier('modifier-1', 'admin'), new Date(2024, 5, 15))
        mv.withAttribute('createdSource', 'mobile' as unknown as object)
        meta.add(mv)

        const response = Result.ok({ data: 42 }, meta)
        response.assignSerializer(jsonSerializer)
        const json = response.serialize()

        // Deserialize it as ctx.deserializeResult would
        restored = ctx.deserializeResult<{ data: number }>(json)
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()

    await session.createClient('c1').request(
      new RequestOperationRequest('u1', getPet, { petId: 'p1' })
    )

    expect(restored).not.toBeNull()
    expect(restored!.isSuccess()).toBe(true)
    expect(restored!.value).toEqual({ data: 42 })
    expect(restored!.meta.hasMoreValues).toBe(true)
    expect(restored!.meta.totalValueCount).toBe(50)
    expect(restored!.meta.hasAttribute('source')).toBe(true)
    expect(restored!.meta.getAttribute('source')).toBe('remote')

    // Metavalue-level checks
    const mv = restored!.meta.getMetaValue('rec-1')
    expect(mv).toBeDefined()
    expect(mv!.initialCharacters?.performer?.id).toBe('creator-1')
    expect(mv!.currentCharacters?.performer?.id).toBe('modifier-1')
    expect(mv!.hasAttribute('createdSource')).toBe(true)
    expect(mv!.getAttribute('createdSource')).toBe('mobile')
  })

  it('deserializeResult restores error with all detail fields', async () => {
    let restored: Result<undefined> | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        const err = new TransportError('VALIDATION_ERROR', {
          technicalError: 'Field X is required',
          userError: 'Please fill in field X',
          sessionIdentifier: 'sess-1',
          callingClient: 'MobileClient',
          calledOperation: 'petkey.pet.create',
          transactionId: 'tx-abc',
        })
        const response = Result.failed(422, err)
        response.assignSerializer(jsonSerializer)
        const json = response.serialize()
        restored = ctx.deserializeResult<undefined>(json)
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()

    await session.createClient('c1').request(
      new RequestOperationRequest('u1', getPet, { petId: 'p1' })
    )

    expect(restored).not.toBeNull()
    expect(restored!.isSuccess()).toBe(false)
    expect(restored!.error!.code).toBe('VALIDATION_ERROR')
    expect(restored!.error!.details.technicalError).toBe('Field X is required')
    expect(restored!.error!.details.userError).toBe('Please fill in field X')
    expect(restored!.error!.details.sessionIdentifier).toBe('sess-1')
    expect(restored!.error!.details.callingClient).toBe('MobileClient')
    expect(restored!.error!.details.calledOperation).toBe('petkey.pet.create')
    expect(restored!.error!.details.transactionId).toBe('tx-abc')
  })
})

describe('Result factory methods with full arguments', () => {
  it('Result.internalServerError with code, technicalError, and userError', () => {
    const r = Result.internalServerError('SERVER_ERR', 'DB connection failed', 'Something went wrong')
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(500)
    expect(r.error!.code).toBe('SERVER_ERR')
    expect(r.error!.details.technicalError).toBe('DB connection failed')
    expect(r.error!.details.userError).toBe('Something went wrong')
  })

  it('Result.badRequest with code, technicalError, and userError', () => {
    const r = Result.badRequest('INVALID_INPUT', 'Missing field: name', 'Please provide a name')
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(400)
    expect(r.error!.code).toBe('INVALID_INPUT')
    expect(r.error!.details.technicalError).toBe('Missing field: name')
    expect(r.error!.details.userError).toBe('Please provide a name')
  })

  it('Result.notFound with code, technicalError, and userError', () => {
    const r = Result.notFound('PET_NOT_FOUND', 'No pet with id pet-99', 'Pet not found')
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(404)
    expect(r.error!.code).toBe('PET_NOT_FOUND')
    expect(r.error!.details.technicalError).toBe('No pet with id pet-99')
    expect(r.error!.details.userError).toBe('Pet not found')
  })

  it('Result.failed with 3 string args', () => {
    const r = Result.failed(409, 'CONFLICT', 'Resource already exists')
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(409)
    expect(r.error!.code).toBe('CONFLICT')
    expect(r.error!.details.technicalError).toBe('Resource already exists')
  })
})

describe('Metavalue attributes survive serialization round-trip', () => {
  it('metavalue custom attributes round-trip through Result serialization', () => {
    const mv = Metavalue.with('rec-1', 'tenant-1',
      new Identifier('user-1', 'user'), new Date(2024, 0, 1))
    mv.withAttribute('createdSource', 'mobile' as unknown as object)
    mv.withAttribute('modifiedSource', 'web' as unknown as object)

    const result = Result.ok({ id: 1 })
    result.AddMetaValue(mv)
    result.assignSerializer(jsonSerializer)
    const json = result.serialize()
    const restored = Result.deserializeResult<{ id: number }>(jsonSerializer, json)

    expect(restored.meta.values).toHaveLength(1)
    const restoredMv = restored.meta.values[0]!
    expect(restoredMv.hasAttribute('createdSource')).toBe(true)
    expect(restoredMv.getAttribute('createdSource')).toBe('mobile')
    expect(restoredMv.hasAttribute('modifiedSource')).toBe(true)
    expect(restoredMv.getAttribute('modifiedSource')).toBe('web')
  })

  it('multiple metavalues with attributes round-trip', () => {
    const mv1 = Metavalue.with('rec-1', 'tenant-1', new Identifier('u1', 'user'))
    mv1.withAttribute('status', 'active' as unknown as object)
    const mv2 = Metavalue.with('rec-2', 'tenant-1', new Identifier('u2', 'admin'))
    mv2.withAttribute('status', 'archived' as unknown as object)

    const result = Result.ok({ items: ['a', 'b'] })
    result.AddMetaValues([mv1, mv2])
    result.assignSerializer(jsonSerializer)
    const json = result.serialize()
    const restored = Result.deserializeResult<{ items: string[] }>(jsonSerializer, json)

    expect(restored.meta.values).toHaveLength(2)
    expect(restored.meta.getMetaValue('rec-1')?.getAttribute('status')).toBe('active')
    expect(restored.meta.getMetaValue('rec-2')?.getAttribute('status')).toBe('archived')
  })

  it('Metavalues.values iteration after deserialization', () => {
    const meta = new Metavalues()
    for (let i = 0; i < 5; i++) {
      const mv = new Metavalue()
      mv.valueId = `item-${i}`
      mv.dataTenant = 'tenant-1'
      meta.add(mv)
    }

    const result = Result.ok({ data: true }, meta)
    result.assignSerializer(jsonSerializer)
    const json = result.serialize()
    const restored = Result.deserializeResult<{ data: boolean }>(jsonSerializer, json)

    const ids = restored.meta.values.map(v => v.valueId)
    expect(ids).toEqual(['item-0', 'item-1', 'item-2', 'item-3', 'item-4'])
  })
})

describe('TransportRequest characters round-trip', () => {
  it('characters survive TransportRequest serialize/deserialize', () => {
    const request = new TransportRequest(
      'op1', 'GET', 'request', 'client', 'usage1',
      'tx-1', 'tenant', 'en-GB',
      {
        performer: { id: 'user-1', type: 'user' },
        responsible: { id: 'org-1', type: 'org' },
        subject: { id: 'item-1', type: 'item' },
      },
      [], [], { data: 'test' }, null
    ).assignSerializer(jsonSerializer)

    const json = request.serialize()
    const restored = TransportRequest.fromSerialized<{ data: string }>(jsonSerializer, json)

    expect(restored.characters.performer?.id).toBe('user-1')
    expect(restored.characters.performer?.type).toBe('user')
    expect(restored.characters.responsible?.id).toBe('org-1')
    expect(restored.characters.responsible?.type).toBe('org')
    expect(restored.characters.subject?.id).toBe('item-1')
    expect(restored.characters.subject?.type).toBe('item')
  })

  it('attributes and pathParams survive TransportRequest serialize/deserialize', () => {
    const request = new TransportRequest(
      'op1', 'GET', 'request', 'client', 'usage1',
      'tx-1', 'tenant', 'en-GB', {},
      [new Attribute('userId', 'u1' as unknown as object), new Attribute('fullName', 'John' as unknown as object)],
      [new Attribute('petId', 'pet-42' as unknown as object)],
      {}, null
    ).assignSerializer(jsonSerializer)

    const json = request.serialize()
    const restored = TransportRequest.fromSerialized<object>(jsonSerializer, json)

    expect(restored.attributes).toHaveLength(2)
    expect(restored.attributes.find(a => a.name === 'userId')?.value).toBe('u1')
    expect(restored.attributes.find(a => a.name === 'fullName')?.value).toBe('John')
    expect(restored.pathParams).toHaveLength(1)
    expect(restored.pathParams.find(a => a.name === 'petId')?.value).toBe('pet-42')
  })
})

describe('TransportClient.getSerializer()', () => {
  it('returns the session serializer', () => {
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .build()
    const client = session.createClient('c1')
    expect(client.getSerializer()).toBe(jsonSerializer)
  })
})

describe('TransportSession.withLocale()', () => {
  it('sets locale on session and propagates to acceptIncomingRequest', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()
      .withLocale('nb-NO')

    const client = session.createClient('c1')
    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))
    expect(capturedCtx!.call.locale).toBe('nb-NO')
  })
})

describe('TransportSessionBuilder.onLogMessage()', () => {
  it('sets a custom logger', () => {
    const messages: string[] = []
    const builder = Transport.session('svc')
      .onLogMessage({
        logLevel: 3, // INFO
        write: (msg) => { messages.push(msg.toString()) }
      })
      .assignSerializer(jsonSerializer)
      .build()
    // Logger is global so it should be set — we just check it doesn't throw
    expect(builder).toBeInstanceOf(TransportSession)
  })
})

describe('acceptOperation with path parameters from OutOfContextOperation', () => {
  it('path parameters from OutOfContextOperation are accessible in handler', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))
      .build()
    const client = session.createClient('c1')

    const operation: OutOfContextOperation = {
      usageId: 'u1',
      operationId: 'petkey.pet.get',
      operationVerb: 'GET',
      operationType: 'request',
      requestJson: { petId: 'pet-1' },
      pathParameters: [
        { name: 'petId', value: 'pet-1' },
        { name: 'dataSource', value: 'remote' },
      ],
    }

    await client.acceptOperation(operation)
    expect(capturedCtx!.hasPathParameter('petId')).toBe(true)
    expect(capturedCtx!.getPathParameter('petId')).toBe('pet-1')
    expect(capturedCtx!.hasPathParameter('dataSource')).toBe(true)
    expect(capturedCtx!.getPathParameter('dataSource')).toBe('remote')
  })

  it('acceptOperation message type via OutOfContextOperation', async () => {
    const updatePet = new UpdatePet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(updatePet.handle(async () => Result.ok()))
      .build()
    const client = session.createClient('c1')

    const result = await client.acceptOperation({
      usageId: 'u1',
      operationId: 'petkey.pet.update',
      operationVerb: 'UPDATE',
      operationType: 'message',
      requestJson: { petId: 'p1', name: 'Rex' },
    })
    expect(result.isSuccess()).toBe(true)
  })

  it('acceptOperation does not overwrite existing path params from client', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()
    const client = session.createClient('c1').addPathParam('petId', 'from-client')

    await client.acceptOperation({
      usageId: 'u1',
      operationId: 'petkey.pet.get',
      operationVerb: 'GET',
      operationType: 'request',
      requestJson: { petId: 'p1' },
      pathParameters: [{ name: 'petId', value: 'from-operation' }],
    })

    // The client-set path param should take precedence
    expect(capturedCtx!.getPathParameter('petId')).toBe('from-client')
  })
})

describe('Result.serialize() / deserializeResult() full round-trip', () => {
  it('Result with ok value, full meta, characters, and attributes round-trips', () => {
    const meta = new Metavalues()
    meta.setHasMoreValues(true)
    meta.setTotalValueCount(200)
    meta.withAttribute('page', 1 as unknown as object)
    meta.withAttribute('filter', 'active' as unknown as object)

    const mv1 = Metavalue.with('pet-1', 'tenant-1',
      new Identifier('user-1', 'user'), new Date(2024, 0, 15),
      new Identifier('admin-1', 'admin'), new Date(2024, 6, 20))
    mv1.withAttribute('createdSource', 'mobile' as unknown as object)

    const mv2 = new Metavalue()
    mv2.valueId = 'pet-2'
    mv2.dataTenant = 'tenant-1'
    mv2.withInitialCharacters(
      CharacterMetaValues.fromPerformer(new Identifier('user-2', 'user'))
        .withResponsible(new Identifier('org-1', 'org'))
        .withSubject(new Identifier('pet-2', 'pet'))
        .withTimestamp(new Date(2024, 3, 10))
    )

    meta.add([mv1, mv2])

    const original = Result.ok({ pets: [{ id: 'pet-1', name: 'Buddy' }] }, meta)
    original.assignSerializer(jsonSerializer)
    const json = original.serialize()

    const restored = Result.deserializeResult<{ pets: { id: string; name: string }[] }>(jsonSerializer, json)

    expect(restored.isSuccess()).toBe(true)
    expect(restored.value.pets).toHaveLength(1)
    expect(restored.value.pets[0]!.name).toBe('Buddy')
    expect(restored.meta.hasMoreValues).toBe(true)
    expect(restored.meta.totalValueCount).toBe(200)
    expect(restored.meta.getAttribute('page')).toBe(1)
    expect(restored.meta.getAttribute('filter')).toBe('active')
    expect(restored.meta.values).toHaveLength(2)

    const rmv1 = restored.meta.getMetaValue('pet-1')!
    expect(rmv1.initialCharacters?.performer?.id).toBe('user-1')
    expect(rmv1.currentCharacters?.performer?.id).toBe('admin-1')
    expect(rmv1.getAttribute('createdSource')).toBe('mobile')

    const rmv2 = restored.meta.getMetaValue('pet-2')!
    expect(rmv2.initialCharacters?.performer?.id).toBe('user-2')
    expect(rmv2.initialCharacters?.responsible?.id).toBe('org-1')
    expect(rmv2.initialCharacters?.subject?.id).toBe('pet-2')
  })

  it('failed Result with nested error chain round-trips', () => {
    const rootErr = TransportError.basic('DB_ERROR', 'Connection refused', 'Database unavailable')
    const middleErr = TransportError.fromParent(rootErr, 'SERVICE_ERROR', 'Pet service failed')
    const topErr = TransportError.fromParent(middleErr, 'API_ERROR', 'Request failed', 'Something went wrong')

    const r = Result.failed(503, topErr)
    r.assignSerializer(jsonSerializer)
    const json = r.serialize()
    const restored = Result.deserializeResult<undefined>(jsonSerializer, json)

    expect(restored.isSuccess()).toBe(false)
    expect(restored.statusCode).toBe(503)
    expect(restored.error!.code).toBe('API_ERROR')
    expect(restored.error!.details.userError).toBe('Something went wrong')
    expect(restored.error!.parent!.code).toBe('SERVICE_ERROR')
    expect(restored.error!.parent!.parent!.code).toBe('DB_ERROR')
    expect(restored.error!.parent!.parent!.details.technicalError).toBe('Connection refused')
    expect(restored.error!.parent!.parent!.details.userError).toBe('Database unavailable')
  })
})

describe('End-to-end: inbound -> interceptor serialize/deserialize -> outbound', () => {
  it('simulates full request pipeline with serialized outbound and deserialized response', async () => {
    // This test simulates the most common real-world pattern from petkey-owner:
    // 1. Inbound request arrives
    // 2. Interceptor serializes an outbound request using ctx.serializeRequest()
    // 3. Outbound "service" processes it
    // 4. Interceptor deserializes the response using ctx.deserializeResult()

    const getPet = new GetPet()
    const extractOp = new ExtractInfo()

    // "Remote service" handler: takes a serialized request, returns a serialized result
    const remoteService = async (serializedRequest: string): Promise<string> => {
      const request = TransportRequest.fromSerialized<{ fileId: string }>(jsonSerializer, serializedRequest)
      const meta = new Metavalues()
      const mv = Metavalue.with('extract-1', undefined, new Identifier(request.characters.performer?.id ?? 'unknown', 'user'))
      mv.withAttribute('source', 'ai-agent' as unknown as object)
      meta.add(mv)
      const response = Result.ok({ extracted: 'info-for-' + request.requestJson.fileId }, meta)
      response.assignSerializer(jsonSerializer)
      return response.serialize()
    }

    const session = Transport.session('PetKeyServer')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        // Step 1: serialize outbound request
        const outboundJson = ctx.serializeRequest({ fileId: 'file-abc' })

        // Step 2: "send" to remote service
        const responseJson = await remoteService(outboundJson)

        // Step 3: deserialize response
        const agentResult = ctx.deserializeResult<{ extracted: string }>(responseJson)
        if (!agentResult.isSuccess()) {
          return agentResult.convert<{ name: string; breed: string }>()
        }

        // Step 4: use the data
        return Result.ok(
          { name: agentResult.value.extracted, breed: 'unknown' },
          agentResult.meta
        )
      }))
      .build()

    const client = session.createClient('MobileClient', 'my-tenant')
      .withLocale('nb-NO')
      .withCharacters({ performer: { id: 'user-42', type: 'user' } })

    const result = await client.request(
      new RequestOperationRequest('u1', getPet, { petId: 'pet-1' })
    )

    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ name: 'info-for-file-abc', breed: 'unknown' })
    // Metadata from the "remote service" should flow through
    expect(result.meta.values).toHaveLength(1)
    expect(result.meta.getMetaValue('extract-1')).toBeDefined()
    expect(result.meta.getMetaValue('extract-1')!.getAttribute('source')).toBe('ai-agent')
    // The performer was forwarded to the remote service
    expect(result.meta.getMetaValue('extract-1')!.initialCharacters?.performer?.id).toBe('user-42')
  })

  it('error from outbound service propagates back through interceptor', async () => {
    const getPet = new GetPet()

    const failingRemoteService = async (): Promise<string> => {
      const err = TransportError.basic('EXTRACTION_FAILED', 'File corrupt', 'Could not process file')
      const response = Result.failed(422, err)
      response.assignSerializer(jsonSerializer)
      return response.serialize()
    }

    const session = Transport.session('PetKeyServer')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        const responseJson = await failingRemoteService()
        const agentResult = ctx.deserializeResult<{ extracted: string }>(responseJson)
        if (!agentResult.isSuccess()) {
          return agentResult.convert<{ name: string; breed: string }>()
        }
        return Result.ok({ name: 'should-not-reach', breed: 'x' })
      }))
      .build()

    const client = session.createClient('MobileClient')
    const result = await client.request(
      new RequestOperationRequest('u1', getPet, { petId: 'pet-1' })
    )

    expect(result.isSuccess()).toBe(false)
    expect(result.error!.code).toBe('EXTRACTION_FAILED')
    expect(result.error!.details.technicalError).toBe('File corrupt')
    expect(result.error!.details.userError).toBe('Could not process file')
  })
})

describe('Result.isSuccess() and Result.hasError() methods', () => {
  it('isSuccess() returns true for ok results', () => {
    expect(Result.ok().isSuccess()).toBe(true)
    expect(Result.ok('value').isSuccess()).toBe(true)
    expect(Result.okStatus(201).isSuccess()).toBe(true)
  })

  it('isSuccess() returns false for failed results', () => {
    expect(Result.failed(400, 'ERR').isSuccess()).toBe(false)
    expect(Result.badRequest('ERR').isSuccess()).toBe(false)
    expect(Result.notFound('ERR').isSuccess()).toBe(false)
    expect(Result.internalServerError('ERR').isSuccess()).toBe(false)
  })

  it('hasError() returns false for ok results', () => {
    expect(Result.ok().hasError()).toBe(false)
    expect(Result.ok('value').hasError()).toBe(false)
  })

  it('hasError() returns true for failed results', () => {
    expect(Result.failed(500, 'ERR').hasError()).toBe(true)
    expect(Result.badRequest('ERR').hasError()).toBe(true)
  })
})

describe('inspectResponse on session builder', () => {
  it('inspectResponse callback receives the result after interceptor processes', async () => {
    const inspected: Result<object>[] = []
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async () => Result.ok({ name: 'Buddy', breed: 'Lab' })))
      .inspectResponse(async (result, input, ctx) => {
        inspected.push(result)
        return result
      })
      .build()

    const client = session.createClient('c1')
    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))
    await client.request(new RequestOperationRequest('u2', getPet, { petId: 'p2' }))

    expect(inspected).toHaveLength(2)
    expect(inspected[0]!.isSuccess()).toBe(true)
  })
})

describe('TransportClient.withCharacters() with full character set', () => {
  it('performer, responsible, and subject all propagate through request', async () => {
    let capturedCtx: TransportContext | null = null
    const getPet = new GetPet()
    const session = Transport.session('svc')
      .assignSerializer(jsonSerializer)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedCtx = ctx
        return Result.ok({ name: 'x', breed: 'y' })
      }))
      .build()

    const client = session.createClient('c1')
      .withCharacters({
        performer: { id: 'user-1', type: 'user' },
        responsible: { id: 'org-1', type: 'organization' },
        subject: { id: 'pet-1', type: 'pet' },
      })

    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))

    expect(capturedCtx!.call.characters.performer?.id).toBe('user-1')
    expect(capturedCtx!.call.characters.performer?.type).toBe('user')
    expect(capturedCtx!.call.characters.responsible?.id).toBe('org-1')
    expect(capturedCtx!.call.characters.responsible?.type).toBe('organization')
    expect(capturedCtx!.call.characters.subject?.id).toBe('pet-1')
    expect(capturedCtx!.call.characters.subject?.type).toBe('pet')
  })
})

describe('Result.maybe chain with metadata preservation', () => {
  it('meta passes through maybe chain', () => {
    const meta = new Metavalues()
    meta.setHasMoreValues(true)
    const mv = Metavalue.with('rec-1', 'tenant')
    meta.add(mv)

    const result = Result.ok({ id: 1 }, meta)
      .maybe((value, meta) => {
        expect(meta.hasMoreValues).toBe(true)
        expect(meta.values).toHaveLength(1)
        return Result.ok({ doubled: value.id * 2 })
      })

    expect(result.isSuccess()).toBe(true)
    expect(result.value).toEqual({ doubled: 2 })
  })

  it('maybePassThroughOk receives meta in callback', () => {
    const meta = new Metavalues()
    meta.withAttribute('key', 'val' as unknown as object)

    let receivedMeta: Metavalues | null = null
    Result.ok({ id: 1 }, meta).maybePassThroughOk((value, m) => {
      receivedMeta = m
    })

    expect(receivedMeta).not.toBeNull()
    expect(receivedMeta!.hasAttribute('key')).toBe(true)
  })
})

describe('setupOutboundContextCache', () => {
  it('allows sharing context cache between session and outbound', async () => {
    const sharedCache = new InMemoryContextCache()

    let capturedTransactionId: string | null = null
    const getPet = new GetPet()
    const extractOp = new ExtractInfo()

    const builder = Transport.session('InboundServer')
      .assignSerializer(jsonSerializer)
      .setupOutboundContextCache(sharedCache)
      .intercept(getPet.handle(async (input, ctx) => {
        capturedTransactionId = ctx.call.transactionId
        return Result.ok({ name: 'Buddy', breed: 'Lab' })
      }))

    const outbound = builder.outboundSessionBuilder('OutboundService')
      .intercept(extractOp.handle(async () => Result.ok({ extracted: 'data' })))
      .build()

    const session = builder.build()
    const client = session.createClient('c1')
    await client.request(new RequestOperationRequest('u1', getPet, { petId: 'p1' }))

    // The inbound request should have cached its context
    expect(capturedTransactionId).not.toBeNull()
    const cached = await sharedCache.get(capturedTransactionId!)
    expect(cached).not.toBeNull()
  })
})
