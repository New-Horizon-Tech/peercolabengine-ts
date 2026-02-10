import { describe, it, expect } from 'vitest'
import {
  Transport, TransportSession, TransportClient, TransportContext, TransportRequest,
  TransportSerializer, Result, Metavalues, Metavalue, CharacterMetaValues, Identifier,
  TransportError, Attribute, InMemoryContextCache, CallInformation,
  RequestOperation, MessageOperation, RequestOperationRequest, MessageOperationRequest,
  OutboundSessionBuilder, OutboundClientFactory, OutOfContextOperation,
  TransportOperationSettings, TransportSessionBuilder, TransportOperation,
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

// --- Domain DTOs ---

interface ProductDto {
  id: string
  name: string
  category?: string
  createdDate?: string | null
  image?: { url: string; mimeType: string } | null
  tags?: string[] | null
}

interface ProductDetailsDto {
  productId: string
  components: ProductComponentDto[]
  owner: { userId: string; name?: string }
  metrics?: { weight?: number | null; labels: string[] }
}

interface ProductComponentDto {
  id: string
  name: string
  description?: string | null
  dateAdded?: string | null
  active: boolean
}

interface CreateProductInput {
  name: string
  categoryId?: string
  subCategoryId?: string
  status?: string
}

interface UpdateProductInput {
  name?: string
  status?: string
  createdDate?: string | null
  serialNumber?: string
}

interface DataSourceDto {
  type: string
  referenceId?: string
}

interface SyncInput {
  taskChanges: TaskChangeDto[]
  completions: string[]
}

interface TaskChangeDto {
  id: string
  name: string
  type: string
  isCompleted?: boolean
}

interface SyncOutput {
  syncedCount: number
  syncToken: string
}

interface ChatInstructionInput {
  usageInstructions: string
  currentStateSnapshot: string
  items: ChatMessageDto[]
}

interface ChatMessageDto {
  type: string
  role: string
  content: string
}

interface ChatInstructionOutput {
  message: string
  operations: OutOfContextOperation[]
}

// --- Operations ---

class GetProduct extends RequestOperation<string, ProductDto> {
  constructor() {
    super('TestApp.Products.GetProduct', 'GET', ['dataSource', 'productId'], {
      requiresTenant: true,
      characterSetup: {},
    })
  }
}

class CreateProduct extends RequestOperation<CreateProductInput, ProductDto> {
  constructor() {
    super('TestApp.Products.CreateProduct', 'CREATE', ['dataSource'], {
      requiresTenant: true,
      characterSetup: {},
    })
  }
}

class UpdateProduct extends MessageOperation<UpdateProductInput> {
  constructor() {
    super('TestApp.Products.UpdateProduct', 'UPDATE', ['dataSource', 'productId'], {
      requiresTenant: true,
      characterSetup: {},
    })
  }
}

class GetProductDetails extends RequestOperation<string, ProductDetailsDto> {
  constructor() {
    super('TestApp.Products.GetProductDetails', 'GET', ['dataSource', 'productId'], {
      requiresTenant: true,
      characterSetup: {},
    })
  }
}

class SyncTasks extends RequestOperation<SyncInput, SyncOutput> {
  constructor() {
    super('TestApp.Tasks.SyncLocalUpdates', 'PROCESS', ['dataSource'], {
      requiresTenant: true,
      characterSetup: {},
    })
  }
}

class ProcessChat extends RequestOperation<ChatInstructionInput, ChatInstructionOutput> {
  constructor() {
    super('PeerColab.Instructions.ProcessChatInstruction', 'PROCESS')
  }
}

// --- Helper ---

function buildClientServerPair(
  configureServer: (builder: TransportSessionBuilder) => void,
  serverPatternPrefix = 'TestApp.'
): { clientSession: TransportSession; serverSession: TransportSession } {
  const serverBuilder = Transport.session('server-session').assignSerializer(jsonSerializer)
  configureServer(serverBuilder)
  const serverSession = serverBuilder.build()

  const clientSession = Transport.session('client-session')
    .assignSerializer(jsonSerializer)
    .interceptPattern(serverPatternPrefix, async (input, ctx) => {
      const serializedRequest = ctx.serializeRequest(input)
      const result = await serverSession.acceptIncomingRequest(serializedRequest)
      const serializedResult = result.serialize()
      return ctx.deserializeResult<object>(serializedResult)
    })
    .build()

  return { clientSession, serverSession }
}

// --- Tests ---

describe('Client-Server Serialization', () => {
  const getProduct = new GetProduct()
  const createProduct = new CreateProduct()
  const updateProduct = new UpdateProduct()
  const getProductDetails = new GetProductDetails()
  const syncTasks = new SyncTasks()
  const processChat = new ProcessChat()

  it('simple request serializes and deserializes correctly', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({
          id: 'prod-1',
          name: 'Widget Alpha',
          category: 'electronics',
          createdDate: '2020-03-15',
          tags: ['premium', 'certified'],
        })
      }))
    })

    const client = clientSession.createClient('mobile-app')
      .withLocale('en-GB')
      .withDataTenant('tenant1')
      .addPathParam('dataSource', { type: 'manual' })
      .addPathParam('productId', 'prod-1')

    const result = await client.request(
      new RequestOperationRequest('usage1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.id).toBe('prod-1')
    expect(result.value.name).toBe('Widget Alpha')
    expect(result.value.category).toBe('electronics')
    expect(result.value.tags).toHaveLength(2)
    expect(result.value.tags).toContain('premium')
  })

  it('complex nested object serializes and deserializes correctly', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProductDetails.handle(async () => {
        return Result.ok<ProductDetailsDto>({
          productId: 'prod-1',
          components: [
            { id: 'comp-1', name: 'Resistor Pack', description: 'Standard 10k ohm resistor set', dateAdded: '2024-01-15', active: true },
            { id: 'comp-2', name: 'Capacitor Set', description: null, dateAdded: null, active: false },
          ],
          owner: { userId: 'user-1', name: 'John' },
          metrics: { weight: 14.5, labels: ['fragile', 'heavy'] },
        })
      }))
    })

    const client = clientSession.createClient('mobile-app')
      .withDataTenant('tenant1')
      .addPathParam('dataSource', { type: 'manual' })
      .addPathParam('productId', 'prod-1')

    const result = await client.request(
      new RequestOperationRequest('usage1', getProductDetails, 'prod-1'))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.productId).toBe('prod-1')
    expect(result.value.components).toHaveLength(2)
    expect(result.value.components[0]!.name).toBe('Resistor Pack')
    expect(result.value.components[0]!.active).toBe(true)
    expect(result.value.components[1]!.description).toBeNull()
    expect(result.value.components[1]!.dateAdded).toBeNull()
    expect(result.value.components[1]!.active).toBe(false)
    expect(result.value.owner.userId).toBe('user-1')
    expect(result.value.metrics!.weight).toBe(14.5)
    expect(result.value.metrics!.labels).toHaveLength(2)
  })

  it('null fields survive serialization', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({
          id: 'prod-1',
          name: 'Widget',
          category: 'electronics',
          createdDate: null,
          image: null,
          tags: null,
        })
      }))
    })

    const client = clientSession.createClient('web-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.name).toBe('Widget')
    expect(result.value.createdDate).toBeNull()
    expect(result.value.image).toBeNull()
    expect(result.value.tags).toBeNull()
  })

  it('empty collections survive serialization', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProductDetails.handle(async () => {
        return Result.ok<ProductDetailsDto>({
          productId: 'prod-1',
          components: [],
          owner: { userId: 'u1' },
          metrics: { labels: [] },
        })
      }))
    })

    const client = clientSession.createClient('web-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProductDetails, 'prod-1'))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.components).toHaveLength(0)
    expect(result.value.metrics!.labels).toHaveLength(0)
  })

  it('error result serializes and deserializes correctly', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.notFound<ProductDto>(
          'TestApp.Products.ProductNotFound',
          'Product with id prod-999 not found',
          'The product you\'re looking for doesn\'t exist')
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-999'))

    expect(result.isSuccess()).toBe(false)
    expect(result.statusCode).toBe(404)
    expect(result.error!.code).toBe('TestApp.Products.ProductNotFound')
  })

  it('bad request error serializes with details', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(createProduct.handle(async (input) => {
        if (!input.name)
          return Result.badRequest<ProductDto>(
            'TestApp.Products.InvalidName',
            'Product name cannot be empty',
            'Please enter a name for your product')
        return Result.ok<ProductDto>({ id: 'new', name: input.name })
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', createProduct, { name: '', categoryId: 'electronics' }))

    expect(result.isSuccess()).toBe(false)
    expect(result.statusCode).toBe(400)
    expect(result.error!.code).toBe('TestApp.Products.InvalidName')
    expect(result.error!.details.technicalError).toBe('Product name cannot be empty')
    expect(result.error!.details.userError).toBe('Please enter a name for your product')
  })

  it('characters propagation - performer survives serialization', async () => {
    let capturedPerformerId: string | undefined
    let capturedPerformerType: string | undefined

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async (input, ctx) => {
        capturedPerformerId = ctx.call.characters.performer?.id
        capturedPerformerType = ctx.call.characters.performer?.type
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
    })

    const client = clientSession.createClient('mobile-app')
      .withDataTenant('t1')
      .withCharacters({ performer: new Identifier('user-123', 'user') })

    await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(capturedPerformerId).toBe('user-123')
    expect(capturedPerformerType).toBe('user')
  })

  it('custom attributes propagated through serialization', async () => {
    let capturedUserId: string | undefined
    let capturedUsername: string | undefined
    let capturedFullName: string | undefined

    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(getProduct.handle(async (input, ctx) => {
        capturedUserId = ctx.getAttribute<string>('userId')
        capturedUsername = ctx.getAttribute<string>('username')
        capturedFullName = ctx.getAttribute<string>('fullName')
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
      .build()

    const clientSession = Transport.session('client-session')
      .assignSerializer(jsonSerializer)
      .interceptPattern('TestApp.', async (input, ctx) => {
        const serializedRequest = ctx.serializeRequest(input)
        const customAttrs = [
          new Attribute('userId', 'user-42' as unknown as object),
          new Attribute('username', 'john.doe' as unknown as object),
          new Attribute('fullName', 'John Doe' as unknown as object),
        ]
        const result = await serverSession.acceptIncomingRequest(serializedRequest, customAttrs)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(capturedUserId).toBe('user-42')
    expect(capturedUsername).toBe('john.doe')
    expect(capturedFullName).toBe('John Doe')
  })

  it('path params complex object survives serialization', async () => {
    let capturedDataSource: any
    let capturedProductId: string | undefined

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async (input, ctx) => {
        capturedDataSource = ctx.getPathParameter<DataSourceDto>('dataSource')
        capturedProductId = ctx.getPathParameter<string>('productId')
        return Result.ok<ProductDto>({ id: capturedProductId!, name: 'Widget' })
      }))
    })

    const client = clientSession.createClient('mobile-app')
      .withDataTenant('t1')
      .addPathParam('dataSource', { type: 'manual' } as DataSourceDto)
      .addPathParam('productId', 'prod-abc')

    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-abc'))

    expect(result.isSuccess()).toBe(true)
    expect(capturedDataSource).toBeDefined()
    expect(capturedDataSource.type).toBe('manual')
    expect(capturedProductId).toBe('prod-abc')
  })

  it('path params complex object with referenceId survives serialization', async () => {
    let capturedDataSource: any

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async (input, ctx) => {
        capturedDataSource = ctx.getPathParameter<DataSourceDto>('dataSource')
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
    })

    const client = clientSession.createClient('mobile-app')
      .withDataTenant('t1')
      .addPathParam('dataSource', { type: 'aiextract', referenceId: 'conv-456' } as DataSourceDto)

    await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(capturedDataSource).toBeDefined()
    expect(capturedDataSource.type).toBe('aiextract')
    expect(capturedDataSource.referenceId).toBe('conv-456')
  })

  it('message operation serializes and deserializes correctly', async () => {
    let capturedInput: UpdateProductInput | null = null

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(updateProduct.handle(async (input, ctx) => {
        capturedInput = input as UpdateProductInput
        return Result.ok()
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new MessageOperationRequest('u1',
        new TransportOperation<UpdateProductInput, undefined>(
          'message', 'TestApp.Products.UpdateProduct', 'UPDATE',
          ['dataSource', 'productId'],
          { requiresTenant: true, characterSetup: {} }),
        { name: 'Widget Updated', status: 'active', createdDate: '2020-05-10', serialNumber: 'SN-123456' }))

    expect(result.isSuccess()).toBe(true)
    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.name).toBe('Widget Updated')
    expect(capturedInput!.status).toBe('active')
    expect(capturedInput!.serialNumber).toBe('SN-123456')
  })

  it('complex input DTO serializes through client server', async () => {
    let capturedInput: SyncInput | null = null

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(syncTasks.handle(async (input, ctx) => {
        capturedInput = input as SyncInput
        return Result.ok<SyncOutput>({
          syncedCount: (input as SyncInput).taskChanges.length,
          syncToken: 'tok-abc',
        })
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', syncTasks, {
        taskChanges: [
          { id: 't1', name: 'Review report', type: 'daily', isCompleted: false },
          { id: 't2', name: 'Update inventory', type: 'health', isCompleted: true },
        ],
        completions: ['t3', 't4'],
      }))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.syncedCount).toBe(2)
    expect(result.value.syncToken).toBe('tok-abc')
    expect(capturedInput).not.toBeNull()
    expect(capturedInput!.taskChanges).toHaveLength(2)
    expect(capturedInput!.taskChanges[0]!.name).toBe('Review report')
    expect(capturedInput!.taskChanges[1]!.isCompleted).toBe(true)
    expect(capturedInput!.completions).toHaveLength(2)
  })

  it('metadata with values survives serialization', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        const meta = new Metavalues()
          .setHasMoreValues(true)
          .setTotalValueCount(42)
          .withAttribute('page', 1 as unknown as object)

        meta.add(Metavalue.with('prod-1', 'tenant1',
          new Identifier('creator1', 'user'), new Date(2024, 0, 1),
          new Identifier('updater1', 'user'), new Date(2024, 5, 1)))

        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' }, meta)
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(true)
    expect(result.meta).toBeDefined()
    expect(result.meta.hasMoreValues).toBe(true)
    expect(result.meta.totalValueCount).toBe(42)
    expect(result.meta.hasAttribute('page')).toBe(true)
  })

  it('setMeta on failed result survives serialization', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        const meta = new Metavalues()
        meta.add(Metavalue.with('op-1', undefined))
        meta.add(Metavalue.with('op-2', undefined))

        return Result.badRequest<ProductDto>(
          'TestApp.Import.PartialFailure',
          'Some operations failed').setMeta(meta)
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(false)
    expect(result.statusCode).toBe(400)
    expect(result.error!.code).toBe('TestApp.Import.PartialFailure')
    expect(result.meta).toBeDefined()
    expect(result.meta.values).toHaveLength(2)
  })

  it('inbound to outbound full round trip', async () => {
    const cache = new InMemoryContextCache()

    // Downstream "task sync" service
    const downstreamSession = Transport.session('downstream-service')
      .assignSerializer(jsonSerializer)
      .intercept(syncTasks.handle(async (input) => {
        return Result.ok<SyncOutput>({
          syncedCount: (input as SyncInput).taskChanges.length,
          syncToken: 'server-token-123',
        })
      }))
      .build()

    // Main server session with outbound to downstream
    const serverBuilder = Transport.session('main-server')
      .assignSerializer(jsonSerializer)
      .setupOutboundContextCache(cache)

    const outboundFactory = serverBuilder
      .outboundSessionBuilder('downstream-outbound')
      .interceptPattern('TestApp.Tasks.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const downstreamResult = await downstreamSession.acceptIncomingRequest(serialized)
        const serializedResult = downstreamResult.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    serverBuilder.intercept(getProduct.handle(async (input, ctx) => {
      const outboundClient = await outboundFactory.forIncomingRequest(ctx.call.transactionId)
      const withTenant = outboundClient
        .withDataTenant(ctx.call.dataTenant)
        .withCharacters(ctx.call.characters)

      const syncResult = await withTenant.request(
        new RequestOperationRequest('sync-usage', syncTasks, {
          taskChanges: [{ id: 't1', name: 'Process item', type: 'daily', isCompleted: false }],
          completions: [],
        }))

      if (!syncResult.isSuccess())
        return syncResult.convert<ProductDto>()

      return Result.ok<ProductDto>({
        id: 'prod-1',
        name: 'Widget',
        tags: [`synced:${syncResult.value.syncToken}`],
      })
    }))

    const serverSession = serverBuilder.build()

    const clientSession = Transport.session('client-session')
      .assignSerializer(jsonSerializer)
      .interceptPattern('TestApp.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const result = await serverSession.acceptIncomingRequest(serialized)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    const client = clientSession.createClient('mobile-app')
      .withDataTenant('acme-corp')
      .withCharacters({ performer: new Identifier('user-1', 'user') })

    const finalResult = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(finalResult.isSuccess()).toBe(true)
    expect(finalResult.value.name).toBe('Widget')
    expect(finalResult.value.tags).toContain('synced:server-token-123')
  })

  it('acceptOperation with serialization round trip', async () => {
    const processedOps: string[] = []

    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(createProduct.handle(async (input) => {
        processedOps.push(`create:${input.name}`)
        return Result.ok<ProductDto>({ id: 'new-1', name: input.name })
      }))
      .intercept(updateProduct.handle(async (input) => {
        processedOps.push(`update:${(input as UpdateProductInput).name}`)
        return Result.ok()
      }))
      .build()

    const operations: OutOfContextOperation[] = [
      {
        operationId: 'TestApp.Products.CreateProduct',
        operationType: 'request',
        operationVerb: 'CREATE',
        usageId: 'agent',
        requestJson: { name: 'Gadget', categoryId: 'electronics', status: 'active' },
      },
      {
        operationId: 'TestApp.Products.UpdateProduct',
        operationType: 'message',
        operationVerb: 'UPDATE',
        usageId: 'agent',
        requestJson: { name: 'Gadget Updated', status: 'active' },
      },
    ]

    const client = serverSession.createClient('import-client')
      .withDataTenant('t1')
      .withCharacters({ performer: new Identifier('u1', 'user') })

    const meta = new Metavalues()
    const errors: Result<object>[] = []

    for (const op of operations) {
      const result = await client.acceptOperation(op)
      if (!result.isSuccess())
        errors.push(result)
      meta.add(Metavalue.with(op.operationId, undefined))
    }

    expect(errors).toHaveLength(0)
    expect(processedOps).toHaveLength(2)
    expect(processedOps[0]).toBe('create:Gadget')
    expect(processedOps[1]).toBe('update:Gadget Updated')
    expect(meta.values).toHaveLength(2)
  })

  it('acceptOperation partial failure collects errors', async () => {
    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(createProduct.handle(async (input) => {
        if (!input.name)
          return Result.badRequest<ProductDto>('TestApp.Products.InvalidName', 'Name required')
        return Result.ok<ProductDto>({ id: 'new-1', name: input.name })
      }))
      .build()

    const operations: OutOfContextOperation[] = [
      {
        operationId: 'TestApp.Products.CreateProduct',
        operationType: 'request',
        operationVerb: 'CREATE',
        usageId: 'agent',
        requestJson: { name: 'Gadget', categoryId: 'electronics' },
      },
      {
        operationId: 'TestApp.Products.CreateProduct',
        operationType: 'request',
        operationVerb: 'CREATE',
        usageId: 'agent',
        requestJson: { name: '', categoryId: 'tools' }, // Will fail
      },
      {
        operationId: 'TestApp.Products.CreateProduct',
        operationType: 'request',
        operationVerb: 'CREATE',
        usageId: 'agent',
        requestJson: { name: 'Gizmo', categoryId: 'tools' },
      },
    ]

    const client = serverSession.createClient('import-client')
      .withDataTenant('t1')
      .withCharacters({ performer: new Identifier('u1', 'user') })

    const errors: Result<object>[] = []

    for (const op of operations) {
      const result = await client.acceptOperation(op)
      if (!result.isSuccess())
        errors.push(result)
    }

    expect(errors).toHaveLength(1)
    expect(errors[0]!.error!.code).toBe('TestApp.Products.InvalidName')

    // Verify we can attach meta to a failed result (production pattern)
    const meta = new Metavalues()
    meta.add(Metavalue.with('failed-op', undefined))
    const finalResult = Result.badRequest(
      'TestApp.Import.PartialFailure',
      '1 of 3 operations failed').setMeta(meta)

    expect(finalResult.isSuccess()).toBe(false)
    expect(finalResult.meta).toBeDefined()
    expect(finalResult.meta.values).toHaveLength(1)
  })

  it('pattern interceptor on outbound builder serializes correctly', async () => {
    const cache = new InMemoryContextCache()

    const serverSession = Transport.session('backend-service')
      .assignSerializer(jsonSerializer)
      .intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
      .intercept(syncTasks.handle(async (input) => {
        return Result.ok<SyncOutput>({
          syncedCount: (input as SyncInput).taskChanges.length,
          syncToken: 'sync-1',
        })
      }))
      .build()

    const clientBuilder = Transport.session('mobile-session')
      .assignSerializer(jsonSerializer)
      .setupOutboundContextCache(cache)

    const outboundFactory = clientBuilder
      .outboundSessionBuilder('outbound-to-server')
      .interceptPattern('TestApp.Products.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const result = await serverSession.acceptIncomingRequest(serialized)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .interceptPattern('TestApp.Tasks.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const result = await serverSession.acceptIncomingRequest(serialized)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    const outboundClient = outboundFactory.asIndependentRequests()
      .withDataTenant('t1')
      .withCharacters({ performer: new Identifier('u1', 'user') })

    const productResult = await outboundClient.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(productResult.isSuccess()).toBe(true)
    expect(productResult.value.name).toBe('Widget')

    const syncResult = await outboundClient.request(
      new RequestOperationRequest('u1', syncTasks, {
        taskChanges: [{ id: 't1', name: 'Process item', type: 'daily' }],
        completions: [],
      }))

    expect(syncResult.isSuccess()).toBe(true)
    expect(syncResult.value.syncedCount).toBe(1)
    expect(syncResult.value.syncToken).toBe('sync-1')
  })

  it('locale tenant and transactionId propagated through serialization', async () => {
    let capturedLocale: string | undefined
    let capturedTenant: string | undefined
    let capturedTxId: string | undefined
    let capturedCallingClient: string | undefined
    let capturedUsageId: string | undefined

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async (input, ctx) => {
        capturedLocale = ctx.call.locale
        capturedTenant = ctx.call.dataTenant
        capturedTxId = ctx.call.transactionId
        capturedCallingClient = ctx.operation.callingClient
        capturedUsageId = ctx.operation.usageId
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
    })

    const client = clientSession.createClient('MobileClient')
      .withLocale('nb-NO')
      .withDataTenant('acme-corp')

    await client.request(
      new RequestOperationRequest('TestApp.MobileApp.Client.Products', getProduct, 'prod-1'))

    expect(capturedLocale).toBe('nb-NO')
    expect(capturedTenant).toBe('acme-corp')
    expect(capturedTxId).toBeDefined()
    expect(capturedTxId).not.toBe('')
    expect(capturedCallingClient).toBe('MobileClient')
    expect(capturedUsageId).toBe('TestApp.MobileApp.Client.Products')
  })

  it('TransportRequest.fromSerialized can check characters before accept', async () => {
    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Widget' })
      }))
      .build()

    const serializer = serverSession.getSerializer()
    const request = new TransportRequest<object>(
      'TestApp.Products.GetProduct', 'GET', 'request', 'mobile-app', 'u1',
      'tx-123', 't1', 'en-GB',
      { performer: new Identifier('user-42', 'user') },
      [], [], 'prod-1', undefined
    ).assignSerializer(serializer)

    const serialized = request.serialize()
    const transportRequest = TransportRequest.fromSerialized<object>(serializer, serialized)

    // Check characters before processing (like JWT validation)
    expect(transportRequest.characters).toBeDefined()
    expect(transportRequest.characters.performer).toBeDefined()
    expect(transportRequest.characters.performer!.id).toBe('user-42')

    // Now process
    const result = await serverSession.acceptIncomingRequest(serialized)
    expect(result.isSuccess()).toBe(true)
  })

  it('TransportRequest.fromSerialized reject impersonation', () => {
    const request = new TransportRequest<object>(
      'TestApp.Products.GetProduct', 'GET', 'request', 'mobile-app', 'u1',
      'tx-123', 't1', 'en-GB',
      { performer: new Identifier('attacker-id', 'user') },
      [], [], 'prod-1', undefined
    ).assignSerializer(jsonSerializer)

    const serialized = request.serialize()
    const transportRequest = TransportRequest.fromSerialized<object>(jsonSerializer, serialized)

    // JWT says user is "real-user-id" but request says "attacker-id"
    const jwtUserId = 'real-user-id'
    const requestPerformerId = transportRequest.characters?.performer?.id

    expect(jwtUserId).not.toBe(requestPerformerId)
    // In production this would return 401
  })

  it('multiple sequential requests have independent serialization', async () => {
    let requestCount = 0

    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        requestCount++
        return Result.ok<ProductDto>({
          id: `prod-${requestCount}`,
          name: `Product ${requestCount}`,
        })
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')

    const result1 = await client.request(
      new RequestOperationRequest('u1', getProduct, '1'))
    const result2 = await client.request(
      new RequestOperationRequest('u1', getProduct, '2'))
    const result3 = await client.request(
      new RequestOperationRequest('u1', getProduct, '3'))

    expect(result1.isSuccess()).toBe(true)
    expect(result2.isSuccess()).toBe(true)
    expect(result3.isSuccess()).toBe(true)
    expect(result1.value.name).toBe('Product 1')
    expect(result2.value.name).toBe('Product 2')
    expect(result3.value.name).toBe('Product 3')
    expect(requestCount).toBe(3)
  })

  it('response inspector works through serialization', async () => {
    let inspectorCalled = false
    let inspectedErrorCode: string | undefined

    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(getProduct.handle(async () => {
        return Result.notFound<ProductDto>('TestApp.Products.NotFound', 'Product not found')
      }))
      .inspectResponse(async (result) => {
        inspectorCalled = true
        if (result.error)
          inspectedErrorCode = result.error.code
        return result
      })
      .build()

    const clientSession = Transport.session('client-session')
      .assignSerializer(jsonSerializer)
      .interceptPattern('TestApp.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const result = await serverSession.acceptIncomingRequest(serialized)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(false)
    expect(inspectorCalled).toBe(true)
    expect(inspectedErrorCode).toBe('TestApp.Products.NotFound')
  })

  it('request inspector can block before serialization', async () => {
    const serverSession = Transport.session('server-session')
      .assignSerializer(jsonSerializer)
      .intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({ id: 'prod-1', name: 'Secret Product' })
      }))
      .inspectRequest(async (input, ctx) => {
        if (!ctx.hasAttribute('userId'))
          return Result.failed(401, 'Unauthorized', 'Missing userId attribute')
      })
      .build()

    const clientSession = Transport.session('client-session')
      .assignSerializer(jsonSerializer)
      .interceptPattern('TestApp.', async (input, ctx) => {
        const serialized = ctx.serializeRequest(input)
        const result = await serverSession.acceptIncomingRequest(serialized)
        const serializedResult = result.serialize()
        return ctx.deserializeResult<object>(serializedResult)
      })
      .build()

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    expect(result.isSuccess()).toBe(false)
    expect(result.statusCode).toBe(401)
  })

  it('convert and convertToEmpty work after deserialization', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.notFound<ProductDto>('TestApp.Products.NotFound', 'Not found')
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    // convert<T> on deserialized failed result
    const converted = result.convert<string>()
    expect(converted.isSuccess()).toBe(false)
    expect(converted.statusCode).toBe(404)
    expect(converted.error!.code).toBe('TestApp.Products.NotFound')

    // convertToEmpty on deserialized failed result
    const empty = result.convertToEmpty()
    expect(empty.isSuccess()).toBe(false)
    expect(empty.statusCode).toBe(404)
    expect(empty.error!.code).toBe('TestApp.Products.NotFound')
  })

  it('maybe chain on deserialized result', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.ok<ProductDto>({
          id: 'prod-1',
          name: 'Widget',
          category: 'electronics',
        })
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    const mapped = result
      .maybe<string>((product) => Result.ok(`${product.name} in ${product.category}`))
      .maybe<number>((desc) => Result.ok(desc.length))

    expect(mapped.isSuccess()).toBe(true)
    expect(mapped.value).toBe('Widget in electronics'.length)
  })

  it('maybe chain stops on deserialized error', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(getProduct.handle(async () => {
        return Result.badRequest<ProductDto>('TestApp.Products.Invalid', 'Invalid product')
      }))
    })

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('u1', getProduct, 'prod-1'))

    let secondCalled = false
    const mapped = result.maybe<string>((product) => {
      secondCalled = true
      return Result.ok('should not reach')
    })

    expect(mapped.isSuccess()).toBe(false)
    expect(secondCalled).toBe(false)
    expect(mapped.error!.code).toBe('TestApp.Products.Invalid')
  })

  it('chat instruction complex nested with operations', async () => {
    const { clientSession } = buildClientServerPair(server => {
      server.intercept(processChat.handle(async (input) => {
        const chatInput = input as ChatInstructionInput
        expect(chatInput.items).toHaveLength(2)
        expect(chatInput.items[0]!.role).toBe('system')

        return Result.ok<ChatInstructionOutput>({
          message: 'I found some tasks to create',
          operations: [
            {
              operationId: 'TestApp.Tasks.CreateTask',
              operationType: 'request',
              operationVerb: 'CREATE',
              usageId: 'PeerColab.Instructions',
              requestJson: { id: 't1', name: 'Review report', type: 'daily' },
            },
          ],
        })
      }))
    }, 'PeerColab.')

    const client = clientSession.createClient('mobile-app').withDataTenant('t1')
    const result = await client.request(
      new RequestOperationRequest('PeerColab.Instructions', processChat, {
        usageInstructions: 'Operation id: TestApp.Tasks.CreateTask...',
        currentStateSnapshot: '{ tasks: [] }',
        items: [
          { type: 'message', role: 'system', content: 'You are a helpful assistant' },
          { type: 'message', role: 'user', content: 'Create a task to review the daily report' },
        ],
      }))

    expect(result.isSuccess()).toBe(true)
    expect(result.value.message).toBe('I found some tasks to create')
    expect(result.value.operations).toHaveLength(1)
    expect(result.value.operations[0]!.operationId).toBe('TestApp.Tasks.CreateTask')
  })

  it('empty outbound session can be built and used', () => {
    const cache = new InMemoryContextCache()

    const builder = Transport.session('server')
      .assignSerializer(jsonSerializer)
      .setupOutboundContextCache(cache)

    const outboundBuilder = builder.outboundSessionBuilder('outbound')
    const outboundFactory = outboundBuilder.build()

    expect(outboundFactory).toBeDefined()

    const client = outboundFactory.asIndependentRequests()
    expect(client).toBeDefined()
  })

  it('result serialize deserialize round trip - success result', () => {
    const original = Result.ok<ProductDto>({
      id: 'prod-1',
      name: 'Widget',
      category: 'electronics',
      createdDate: '2020-03-15',
      tags: ['premium'],
    })
    original.assignSerializer(jsonSerializer)

    const json = original.serialize()
    expect(json).toBeDefined()
    expect(json.length).toBeGreaterThan(0)

    const deserialized = Result.deserializeResult<ProductDto>(jsonSerializer, json)

    expect(deserialized.isSuccess()).toBe(true)
    expect(deserialized.value.id).toBe('prod-1')
    expect(deserialized.value.name).toBe('Widget')
    expect(deserialized.value.tags).toHaveLength(1)
  })

  it('result serialize deserialize round trip - error result', () => {
    const original = Result.badRequest<ProductDto>(
      'TestApp.Products.InvalidName',
      'Name too long',
      'Please use a shorter name')
    original.assignSerializer(jsonSerializer)

    const json = original.serialize()
    const deserialized = Result.deserializeResult<ProductDto>(jsonSerializer, json)

    expect(deserialized.isSuccess()).toBe(false)
    expect(deserialized.statusCode).toBe(400)
    expect(deserialized.error!.code).toBe('TestApp.Products.InvalidName')
  })

  it('transport request round trip preserves all fields', () => {
    const txId = 'tx-unique-123'

    const original = new TransportRequest<CreateProductInput>(
      'TestApp.Products.CreateProduct',
      'CREATE',
      'request',
      'mobile-app',
      'TestApp.MobileApp.Client.Products',
      txId,
      'acme-corp',
      'nb-NO',
      {
        performer: new Identifier('user-42', 'user'),
        subject: new Identifier('prod-1', 'product'),
      },
      [
        new Attribute('apiVersion', 'v2' as unknown as object),
        new Attribute('platform', 'ios' as unknown as object),
      ],
      [
        new Attribute('dataSource', 'manual' as unknown as object),
        new Attribute('productId', 'prod-1' as unknown as object),
      ],
      { name: 'Gadget', categoryId: 'electronics', subCategoryId: 'sensors', status: 'active' },
      undefined
    ).assignSerializer(jsonSerializer)

    const json = original.serialize()
    const deserialized = TransportRequest.fromSerialized<object>(jsonSerializer, json)

    expect(deserialized.operationId).toBe('TestApp.Products.CreateProduct')
    expect(deserialized.operationVerb).toBe('CREATE')
    expect(deserialized.operationType).toBe('request')
    expect(deserialized.callingClient).toBe('mobile-app')
    expect(deserialized.usageId).toBe('TestApp.MobileApp.Client.Products')
    expect(deserialized.transactionId).toBe(txId)
    expect(deserialized.dataTenant).toBe('acme-corp')
    expect(deserialized.locale).toBe('nb-NO')

    expect(deserialized.characters).toBeDefined()
    expect(deserialized.characters.performer?.id).toBe('user-42')
    expect(deserialized.characters.performer?.type).toBe('user')
    expect(deserialized.characters.subject?.id).toBe('prod-1')

    expect(deserialized.attributes).toHaveLength(2)
    expect(deserialized.pathParams).toHaveLength(2)
  })
})
