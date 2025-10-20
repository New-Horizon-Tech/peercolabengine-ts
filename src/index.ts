/**
 * “Commons Clause” License Condition v1.0
 * 
 * The Software is provided to you by the Licensor under the License, as defined below, subject to the following condition.
 * 
 * Without limiting other conditions in the License, the grant of rights under the License will not include, and the License 
 * does not grant to you, the right to Sell the Software.
 * 
 * For purposes of the foregoing, “Sell” means practicing any or all of the rights granted to you under the License to provide 
 * to third parties, for a fee or other consideration (including without limitation fees for hosting or consulting/ support 
 * services related to the Software), a product or service whose value derives, entirely or substantially, from the 
 * functionality of the Software. Any license notice or attribution required by the License must also include this Commons 
 * Clause License Condition notice.
 * 
 * Software: PeerColab Engine
 * License: Apache 2.0
 * Licensor: New Horizon Invest AS
 * 
 * ---------------------------------------------------------------------------------------------------------------------------
 * 
 * The operation verb is not to confuse with HTTP verbs. The operation verbs is to mark the operation
 * with what type of data processing it is doing
 *   GET: Reading information
 *   CREATE: Creating a new record
 *   ADD: Adding a record to another
 *   UPDATE: Updating / overwriting a full record
 *   PATCH: Partially updating a record
 *   REMOVE: Removing a record from another
 *   DELETE: Deleting a record
 *   START: Initiating something
 *   STOP: Ending / aborting something that was initiated
 *   PROCESS: Processing information
 *   SEARCH: Processing information
 *   NAVIGATETO: UI navigation
 */
export type OperationVerb = 'GET' | 'SEARCH' | 'CREATE' | 'ADD' | 'UPDATE' | 'PATCH' | 'REMOVE' | 'DELETE' | 'START' | 'STOP' | 'PROCESS' | 'SEARCH' | 'NAVIGATETO'

export type OutOfContextOperation = {
    usageId: string;
    operationId: string;
    operationVerb: string;
    operationType: string;
    requestJson: any;
};

export interface ContextCache {
    put(transactionId: UUID, ctx: CallInformation): Promise<boolean>
    get(transactionId: UUID): Promise<CallInformation | null>
}

export class InMemoryContextCache implements ContextCache {
    private cache: Map<UUID, { ctx: CallInformation, expiresAt: number }> = new Map()
    private readonly maxLifetimeMs: number

    constructor(maxLifetimeMs: number = 3000 * 1000) { // 3000 seconds default
        this.maxLifetimeMs = maxLifetimeMs
    }

    async put(transactionId: UUID, ctx: CallInformation): Promise<boolean> {
        const expiresAt = Date.now() + this.maxLifetimeMs
        this.cache.set(transactionId, { ctx, expiresAt })
        return true
    }

    async get(transactionId: UUID): Promise<CallInformation | null> {
        const entry = this.cache.get(transactionId)
        if (!entry) return null
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(transactionId)
            return null
        }
        return entry.ctx
    }
}

export class Transport {
    public static session(identifier: string) : TransportAbstractionBuilder {
        return new TransportAbstractionBuilder(identifier)
    }
}

export class TransportAbstractionBuilder {
    private config: TransportSessionConfiguration

    public constructor(identifier: string) {
        this.config = {
            locale: "en-GB",
            interceptors: new TransportDispatcher(
                identifier,
                new InMemoryContextCache(),
                false
            ),
            serializer: {
                serialize<T>(obj: T): string {
                    return JSON.stringify(obj)
                },
                deserialize<T>(serialized: string): T {
                    return JSON.parse(serialized) as T
                }
            }
        }
    }

    public setupOutboundContextCache(cache: ContextCache): TransportAbstractionBuilder {
        this.config.interceptors.contextCache = cache
        return this;
    }

    public assignSerializer(serializer: TransportSerializer): TransportAbstractionBuilder {
        this.config.serializer = serializer
        return this
    }

    public intercept<T,R>(handler: OperationHandler<T,R>): TransportAbstractionBuilder {
        if (handler instanceof RequestOperationHandler)
            this.config.interceptors.addRequestHandler(handler.operation.id, handler.handler)
        else if (handler instanceof MessageOperationHandler)
            this.config.interceptors.addMessageHandler(handler.operation.id, handler.handler)
        return this
    }

    public interceptPattern(pattern: string, handler: RequestInterceptor<object,object>): TransportAbstractionBuilder {
        this.config.interceptors.addPatternHandler(pattern, handler)
        return this
    }

    public inspectRequest(inspector: RequestInspector): TransportAbstractionBuilder {
        this.config.interceptors.requestsInspector = inspector
        return this
    }

    public inspectResponse(inspector: ResponseInspector): TransportAbstractionBuilder {
        this.config.interceptors.responsesInspector = inspector
        return this
    }

    public outboundSessionBuilder(clientIdentifer: string): OutboundSessionBuilder {
        return new OutboundSessionBuilder(clientIdentifer, this.config.interceptors.contextCache, this.config.serializer)
    }

    public build(): TransportSession {
        return new TransportSession(this.config)
    }

    public onLogMessage(logger: TransportAbstractionLogger): TransportAbstractionBuilder {
        Logger.assignLogger(logger)
        return this
    }
}

export class OutboundSessionBuilder {
    private serviceId: string
    private config: TransportSessionConfiguration

    public constructor(serviceId: string, contextCache: ContextCache, serializer: TransportSerializer) {
        this.serviceId = serviceId
        this.config = {
            locale: "en-GB",
            interceptors: new TransportDispatcher(serviceId, contextCache, true),
            serializer: serializer
        }
    }

    public intercept<T,R>(handler: OperationHandler<T,R>): OutboundSessionBuilder {
        if (handler instanceof RequestOperationHandler)
            this.config.interceptors.addRequestHandler(handler.operation.id, handler.handler)
        else if (handler instanceof MessageOperationHandler)
            this.config.interceptors.addMessageHandler(handler.operation.id, handler.handler)
        return this
    }

    public interceptPattern(pattern: string, handler: RequestInterceptor<object,object>): OutboundSessionBuilder {
        this.config.interceptors.addPatternHandler(pattern, handler)
        return this
    }

    public inspectRequest(inspector: RequestInspector): OutboundSessionBuilder {
        this.config.interceptors.requestsInspector = inspector
        return this
    }

    public inspectResponse(inspector: ResponseInspector): OutboundSessionBuilder {
        this.config.interceptors.responsesInspector = inspector
        return this
    }

    public build(): OutboundClientFactory {
        return new OutboundClientFactory(this.serviceId, this.config)
    }
}

export class OutboundClientFactory {
    private serviceId: string
    private config: TransportSessionConfiguration

    constructor(serviceId: string, config: TransportSessionConfiguration) {
        this.serviceId = serviceId
        this.config = config
    }

    public async forIncomingRequest(transactionId: UUID): Promise<TransportClient> {
        return await new TransportSession(this.config, true)
            .createClient(this.serviceId)
            .withTransactionId(transactionId)
    }

    public asIndependentRequests(): TransportClient {
        return new TransportSession(this.config)
            .createClient(this.serviceId)
    }
}

export interface TransportSerializer {
    serialize<T>(obj: T): string
    deserialize<T>(serialized: string): T
}

export class TransportSession {
    private config: TransportSessionConfiguration
    private matchSessions: boolean

    public constructor(config: TransportSessionConfiguration, matchSessions: boolean = false) {
        this.config = config
        this.matchSessions = matchSessions
    }

    public withLocale(locale: string): TransportSession {
        this.config.locale = locale
        return this
    }

    public async acceptIncomingRequest(json: string, customAttributes: Attribute[] = []): Promise<Result<object>> {
        const tr = TransportRequest.fromSerialized<object>(this.config.serializer, json)
        const ctx = TransportContext.from(tr)
        // Append missing attributes
        customAttributes.forEach((attribute) => {
            if (ctx.getAttribute(attribute.name))
                return
            ctx.call.attributes.push(attribute)
        }) 
        if (ctx.operation.type === "request") {
            const result = await this.config.interceptors.handleAsRequest(tr.requestJson as object, ctx) as Result<object>
            return result.assignSerializer(this.config.serializer)
        } else {
            const result = await this.config.interceptors.handleAsMessage(tr.requestJson as object, ctx) as Result<object>
            return result.assignSerializer(this.config.serializer)
        }
    } 

    public createClient(clientIdentifier: string, dataTenant?: string): TransportClient {
        const info: CallInformation = CallInformation.new(
            this.config.locale, 
            dataTenant)
        return new TransportClient(clientIdentifier, this.config, info, this.matchSessions)
    }

    public getSerializer(): TransportSerializer {
        return this.config.serializer
    }
}

export class TransportClient {
    private clientIdentifier: string
    private config: TransportSessionConfiguration
    private callInfo: CallInformation
    private matchSessions: boolean

    public constructor(clientIdentifier: string, config: TransportSessionConfiguration, callInformation: CallInformation, matchSessions: boolean = false) {
        this.clientIdentifier = clientIdentifier
        this.config = config
        this.callInfo = callInformation
        this.matchSessions = matchSessions
    }

    public async withTransactionId(transactionId: UUID): Promise<TransportClient> {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, (await this.config.interceptors.getCallInfoFromCache(transactionId, this.callInfo, this.matchSessions)))
        newCallInfo.transactionId = transactionId
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public withLocale(locale: string): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        newCallInfo.locale = locale
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public withDataTenant(tenant: string): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        newCallInfo.dataTenant = tenant
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public withCharacters(characters: ICharacters): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        newCallInfo.characters = characters 
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public addAttribute<T>(name: string, value: T): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        const attr = newCallInfo.attributes.find(x => x.name === name)
        if (attr)
            attr.value = value as object
        else
            newCallInfo.attributes.push({ name: name, value: value as object })
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public removeAttribute(name: string): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        newCallInfo.attributes = newCallInfo.attributes.filter(a => a.name === name)
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public addPathParam<T>(name: string, value: T): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        const param = newCallInfo.pathParams.find(x => x.name === name)
        if (param)
            param.value = value as object
        else
            newCallInfo.pathParams.push({ name: name, value: value as object})
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public removePathParam(name: string): TransportClient {
        // Clone to avoid state sharing issues
        const newCallInfo = Object.assign({}, this.callInfo)
        newCallInfo.pathParams = newCallInfo.pathParams.filter(a => a.name === name) 
        return new TransportClient(this.clientIdentifier, this.config, newCallInfo, this.matchSessions)
    }

    public getSerializer(): TransportSerializer {
        return this.config.serializer
    }

    public async request<T,R>(call: OperationRequest<T,R>): Promise<Result<R>> {
        // Clone before sending to avoid state sharing issues
        const requestCallInfo = Object.assign({}, this.callInfo)
        if (!requestCallInfo.transactionId)
            requestCallInfo.transactionId = generateUUID()
        const ctx = new TransportContext(
            call.asOperationInformation(this.clientIdentifier),
            requestCallInfo,
            this.config.serializer
        )
        if (call instanceof RequestOperationRequest)
            return await this.config.interceptors.handleAsRequest(call.input as object, ctx, this.matchSessions) as Result<R>
        else
            return await this.config.interceptors.handleAsMessage(call.input as object, ctx, this.matchSessions) as Result<R>
    }

    public async acceptOperation(operation: OutOfContextOperation, customAttributes: Attribute[] = []): Promise<Result<object>> {
        const call: OperationRequest<object,object> = operation.operationType === 'request' ?
            new RequestOperationRequest<object,object>(
              operation.usageId, 
              { 
                id: operation.operationId, 
                type: operation.operationType,
                verb: operation.operationVerb,
                pathParameters: [],
                settings: { requiresTenant: false, characterSetup: {} }
              },
              operation.requestJson
            ) :
            new MessageOperationRequest<object>(
              operation.usageId, 
              { 
                id: operation.operationId, 
                type: operation.operationType,
                verb: operation.operationVerb,
                pathParameters: [],
                settings: { requiresTenant: false, characterSetup: {} }
              },
              operation.requestJson
            )
        const requestCallInfo = Object.assign({}, this.callInfo)
        if (!requestCallInfo.transactionId)
            requestCallInfo.transactionId = generateUUID()
        const ctx = new TransportContext(
            call.asOperationInformation(this.clientIdentifier),
            requestCallInfo,
            this.config.serializer
        )
        
        // Append missing attributes
        customAttributes.forEach((attribute) => {
            if (ctx.getAttribute(attribute.name))
                return
            ctx.call.attributes.push(attribute)
        }) 

        if (ctx.operation.type === "request") {
            const result = await this.config.interceptors.handleAsRequest(operation.requestJson as object, ctx) as Result<object>
            return result.assignSerializer(this.config.serializer)
        } else {
            const result = await this.config.interceptors.handleAsMessage(operation.requestJson as object, ctx) as Result<object>
            return result.assignSerializer(this.config.serializer)
        }
    }
}

export type RequestInterceptor<T,R> = (input: T, ctx: TransportContext) => Promise<Result<R>>
export type MessageInterceptor<T> = (input: T, ctx: TransportContext) => Promise<Result>

export type RequestInspector = (input: object, ctx: TransportContext) => Promise<Result<object> | void>
export type ResponseInspector = (result: Result<object>, input: object, ctx: TransportContext) => Promise<Result<object>>

export type UUID = string

export const generateUUID = (): UUID => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0,
        v = c === 'x' ? r : ((r & 0x3) | 0x8)
        return v.toString(16)
    })
}

export class Attribute {
  constructor(
    public name: string,
    public value: object) {}
}

export class TransportRequest<T> {
    static fromSerialized<T>(serializer: TransportSerializer, serialized: string): TransportRequest<T> {
        return new TransportRequest<T>(
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            {
                performer: undefined,
                responsible: undefined,
                subject: undefined,
            },
            [],
            [],
            {} as unknown as T,
            undefined
        )
            .assignSerializer(serializer)
            .deserialize(serialized)
    }

    public serializer?: TransportSerializer

    constructor(
        public readonly operationId: string,
        public readonly operationVerb:string, 
        public readonly operationType:string,
        public readonly callingClient:string,
        public readonly usageId:string,

        public readonly transactionId: UUID,
        public readonly dataTenant: string,
        public readonly locale: string,
        public readonly characters: ICharacters,
        public readonly attributes: Attribute[],
        public readonly pathParams: Attribute[],
        public readonly requestJson: T,
        public raw?: string | null
    ) {
    }

    public static from<T>(input: T, ctx: TransportContext): TransportRequest<T> {
        return new TransportRequest<T>(
            ctx.operation.id,
            ctx.operation.verb,
            ctx.operation.type,
            ctx.operation.callingClient,
            ctx.operation.usageId,

            // The generateUUID here is for the compiler only. It is ALWAYS set on request
            ctx.call.transactionId ? ctx.call.transactionId : generateUUID(),
            ctx.call.dataTenant || '',
            ctx.call.locale,
            ctx.call.characters,
            ctx.call.attributes,
            ctx.call.pathParams,
            input
        ).assignSerializer(ctx.serializer)
    }

    public assignSerializer(serializer: TransportSerializer): TransportRequest<T> {
        this.serializer = serializer
        return this
    }

    public serialize() : string {
        if (!this.serializer)
            throw new Error('No serializer assigned to TransportRequest')
        return this.serializer.serialize(this)
    }

    public deserialize<T>(serialized: string) : TransportRequest<T> {
        if (!this.serializer)
            throw new Error('No serializer assigned to TransportRequest')
        const deserialized = this.serializer.deserialize<TransportRequest<T>>(serialized)
        const newFromDeserialized = new TransportRequest<T>(
            deserialized.operationId,
            deserialized.operationVerb,
            deserialized.operationType,
            deserialized.callingClient,
            deserialized.usageId,
            deserialized.transactionId,
            deserialized.dataTenant,
            deserialized.locale,
            deserialized.characters,
            deserialized.attributes,
            deserialized.pathParams,
            deserialized.requestJson,
            serialized
        )
        newFromDeserialized.assignSerializer(this.serializer)
        return newFromDeserialized
    }
}

export class OperationInformation {
    constructor(
        public readonly id: string,
        public readonly verb: string,
        public readonly type: string,
        public readonly callingClient: string,
        public readonly usageId: string
    ) { }
    
}

export class CallInformation {
    static new(locale: string, dataTenant?: string, transactionId?: UUID): CallInformation {
        return new CallInformation(
            locale,
            dataTenant ? dataTenant : "",
            {},
            [],
            [],
            transactionId ? transactionId : generateUUID()
        )
    }

    constructor(
        public locale: string,
        public dataTenant: string,
        public characters: ICharacters,

        public attributes: Attribute[],
        public pathParams: Attribute[],
        public transactionId: UUID
    ) { }
    
}

export class TransportContext {
    constructor(
        public readonly operation: OperationInformation,
        public readonly call: CallInformation,
        public readonly serializer: TransportSerializer
    ) { }

    public hasAttribute(name: string): boolean {
        return !!this.call.attributes.find(item => item.name === name)
    }

    public getAttribute<T>(name: string): T {
        const item = this.call.attributes.find(item => item.name === name)
        return item?.value as T
    }

    public hasPathParameter(name: string): boolean {
        return !!this.call.pathParams.find(item => item.name === name)
    }

    public getPathParameter<T>(name: string): T {
        const item = this.call.pathParams.find(item => item.name === name) as Attribute
        return item?.value as T
    }

    public static from(gatewayRequest: TransportRequest<object>): TransportContext {
        if (!gatewayRequest.serializer)
            throw new Error('Serializer requred to convert from gateway request')
        return new TransportContext(
            new OperationInformation(
                gatewayRequest.operationId,
                gatewayRequest.operationVerb,
                gatewayRequest.operationType,
                gatewayRequest.callingClient,
                gatewayRequest.usageId
            ),
            new CallInformation(
                gatewayRequest.locale,
                gatewayRequest.dataTenant,
                gatewayRequest.characters,
                gatewayRequest.attributes,
                gatewayRequest.pathParams,
                gatewayRequest.transactionId
            ),
            gatewayRequest.serializer
        )
    }

    public deserializeResult<T>(data: string): Result<T> {
        const plain = this.serializer.deserialize<Result<T>>(data)
        const result = new Result<T>(plain)
        if (plain.meta) {
            result.meta = new Metavalues()
            plain.meta.values.forEach(v => {
                const mv = new Metavalue()
                mv.dataTenant = v.dataTenant
                mv.valueId = v.valueId
                if (v.initialCharacters) {
                    const c = new  CharacterMetaValues()
                    if (v.initialCharacters?.performer) c.withPerformer(new Identifier(v.initialCharacters.performer.id, v.initialCharacters.performer.type))
                    if (v.initialCharacters?.responsible) c.withResponsible(new Identifier(v.initialCharacters.responsible.id, v.initialCharacters.responsible.type))
                    if (v.initialCharacters?.subject) c.withSubject(new Identifier(v.initialCharacters.subject.id, v.initialCharacters.subject.type))
                    mv.withInitialCharacters(c)
                }
                if (v.currentCharacters) {
                    const c = new  CharacterMetaValues()
                    if (v.currentCharacters?.performer) c.withPerformer(new Identifier(v.currentCharacters.performer.id, v.currentCharacters.performer.type))
                    if (v.currentCharacters?.responsible) c.withResponsible(new Identifier(v.currentCharacters.responsible.id, v.currentCharacters.responsible.type))
                    if (v.currentCharacters?.subject) c.withSubject(new Identifier(v.currentCharacters.subject.id, v.currentCharacters.subject.type))
                    mv.withCurrentCharacters(c)
                } 
                result.AddMetaValue(mv)
            })
        }
        const convertError = (plain: TransportError): TransportError => {
            return new TransportError(
                plain.code,
                {
                    technicalError: plain.details?.technicalError,
                    userError: plain.details?.userError,
                    sessionIdentifier: plain.details?.sessionIdentifier,
                    calledOperation: plain.details?.calledOperation,
                    callingClient: plain.details?.callingClient,
                    transactionId: plain.details?.transactionId,
                },
                plain.related ? plain.related.map(e => convertError(e)) : [],
                plain.parent ? convertError(plain.parent) : undefined
            )
        }
        if (plain.error) {
            result.error = convertError(plain.error)
        }
        return result
    }

    public serializeRequest<T>(input: T): string {
        return TransportRequest.from(input, this).serialize()
    }
}

export class Result<T = undefined> {
    private serializer?: TransportSerializer

    public asGeneric(): Result<object> {
        return this.convert(undefined)
    }

    public value: T
    public statusCode: number
    public success: boolean
    public meta?: Metavalues | undefined
    public error?: TransportError | undefined

    public constructor(params: Result<T>) {
        this.value = params.value
        this.statusCode = !params.statusCode && params.error ? 500 : (params.statusCode || 200)
        this.success = params.success || this.isStatusCodeSuccess(this.statusCode)
        this.meta = params.meta ?? new Metavalues()
        this.error = params.error
            ? params.error
            : !this.isStatusCodeSuccess(this.statusCode)
                ? new TransportError(this.statusCode.toString(), 'Unknown error')
                : undefined
    }

    private isStatusCodeSuccess(statusCode: number): boolean {
        return statusCode >= 200 && statusCode <= 308
    }

    public isSuccess(): boolean {
        return this.success
    }

    public hasError(): boolean {
        return !!this.error
    }

    public assignSerializer(serializer: TransportSerializer): Result<T> {
        this.serializer = serializer
        return this
    }

    public serialize() : string {
        if (!this.serializer)
            throw new Error('No serializer assigned to Result')
        return this.serializer.serialize(this)
    }

    public deserialize<T>(serialized: string) : Result<T> {
        if (!this.serializer)
            throw new Error('No serializer assigned to Result')
        const deserialized = this.serializer.deserialize<Result<T>>(serialized)
        const newFromDeserialized = new Result<T>(deserialized)
        newFromDeserialized.assignSerializer(this.serializer)
        return newFromDeserialized
    }

    public static ok<V = undefined>(value?: V , code?: number): Result<V> {
        return new Result<V>({
            success: true,
            value: value,
            meta: new Metavalues(),
            statusCode: code ?? 200
        } as Result<V>)
    }

    public static okStatus(code: number): Result<undefined> {
        return new Result({
            success: true,
            value: undefined,
            meta: new Metavalues(),
            statusCode: code
        } as Result)
    }

    public static notFound<T>(errorData: string | TransportError, technicalError?: string, userError?: string): Result<T> {
        return Result.failed<T>(404, errorData, technicalError, userError)
    }

    public static badRequest<T>(errorData: string | TransportError, technicalError?: string, userError?: string): Result<T> {
        return Result.failed<T>(400, errorData, technicalError, userError)
    }

    public static internalServerError<T>(errorData: string | TransportError, technicalError?: string, userError?: string): Result<T> {
        return Result.failed<T>(500, errorData, technicalError, userError)
    }

    public static failed<T>(statusCode: number, errorData: string | TransportError, technicalError?: string, userError?: string): Result<T> {
        return new Result({
            value: undefined,
            statusCode: statusCode,
            meta: new Metavalues(),
            success: false,
            error: (typeof(errorData) == 'string' ? 
                new TransportError(
                    errorData,
                    {
                        technicalError: technicalError ?? '',
                        sessionIdentifier: '',
                        userError: userError ?? ''
                    },
                    [],
                    undefined) :
                errorData)
        } as Result<T>)
    }

    public withMeta(meta: Metavalues): Result<T> {
        this.meta = meta
        return this
    }

    public AddMetaValue(value: Metavalue): Result<T> {
        if (!this.meta) {
            this.meta = new Metavalues()
        }
        this.meta.add(value)
        return this
    }

    public AddMetaValues(values: Metavalue[]): Result<T> {
        if (!this.meta) {
            this.meta = new Metavalues()
        }
        this.meta.add(values)
        return this
    }

    public convert<R>(resultType?: any): Result<R> {
        if (this instanceof(Result) && this.value == null) {
            return this as unknown as Result<R>
        } else if (this instanceof(Result) && typeof this.value == resultType) {
            return this as unknown as Result<R>
        } else if (this.serializer) {
            try {
                const serializer = this.serializer
                return serializer.deserialize<Result<R>>(serializer.serialize(this))
            } catch (error) {
                return Result.internalServerError("TransportAbstraction.Serialization.DeserializeError", 'Could not deserialize response') as Result<R>
            }
        } else {
            return Result.internalServerError("TransportAbstraction.Serialization.DeserializeError", 'Could not convert Result') as Result<R>
        }
    }

    public maybe<R>(onSuccess: (value: T) => Result<R>): Result<R> {
        try {
            if (!this.success)
                return this.convert<R>()
            return onSuccess(this.value)
        } catch (e) {
            return this.maybeError(e) as Result<R>
        }
    }

    public maybeOk(onSuccess: (value: T) => any): Result<T> {
        try {
            if (!this.success)
                return this.convert()
            onSuccess(this.value)
            return Result.ok(this.value)
        } catch (e) {
            return this.maybeError(e) as Result<T>
        }
    }

    public maybePassThrough(onSuccess: (value: T) => Result<any>): Result<T> {
        try {
            if (!this.success)
                return this
            const result = onSuccess(this.value)
            if (!result.success)
                return result.convert<T>()
            return this
        } catch (e) {
            return this.maybeError(e) as Result<T>
        }
    }

    public maybePassThroughOk(onSuccess: (value: T) => any): Result<T> {
        try {
            if (!this.success)
                return this
            onSuccess(this.value)
            return Result.ok(this.value)
        } catch (e) {
            return this.maybeError(e) as Result<T>
        }
    }

    private maybeError(e: unknown): Result<object> {
        if (e) {
            const err = (e as Error)
            Logger.error('MaybeException: ', err)
            return Result.failed(500, "TransportAbstraction.MaybeException", err.message + ": " + err.name + (err.stack ? "\n" + err.stack : ""))
        }
        Logger.error('MaybeException: Unknown error')
        return Result.failed(500, "TransportAbstraction.MaybeException", "Unknown error")
    }
}

export class ResultPassthroughAsync<T> {
  private initialAction: (() => Promise<Result<T>>)
  private actions: (() => Promise<Result<any>>)[] = []

  public static startWith<R>(action: () => Promise<Result<R>>): ResultPassthroughAsync<R> {
    return new ResultPassthroughAsync(action)
  }

  constructor(action: () => Promise<Result<T>>) {
    this.initialAction = action
  }

  public then(action: () => Promise<Result<any>>): ResultPassthroughAsync<T> {
    this.actions.push(action)
    return this
  }

  public async run(): Promise<Result<T>> {
    let initialResult: Result<T> = Result.failed(500, "TransportAbstraction.MaybeException", "Unknown error")
    try {
      initialResult = await this.initialAction() 
    } catch (e) {
      return this.maybeError(e)
    }

    if (!initialResult.success)
      return initialResult

    for (const action of this.actions) {
      try {
        const result = await action()
        if (!result.success)
          return result
      } catch (e) {
        return this.maybeError(e)
      } 
    }

    return initialResult
  }

  private maybeError(e: unknown): Result<any> {
    if (e) {
      const err = (e as Error)
      Logger.error('MaybeException: ', err)
      return Result.failed(500, "TransportAbstraction.MaybeException", err.message + ": " + err.name + (err.stack ? "\n" + err.stack : ""))
    }
    Logger.error('MaybeException: Unknown error')
    return Result.failed(500, "TransportAbstraction.MaybeException", "Unknown error")
  }
}
 

export class Metavalues {
  public hasMoreValues: boolean
  public values: Metavalue[]

  constructor() {
    this.hasMoreValues = false
    this.values = []
  }

  public hasMetaValue(valueId: string): boolean {
    return this.values.some(i => i.valueId === valueId)
  }

  public getMetaValue(valueId: string): Metavalue | undefined {
    return this.values.find(i => i.valueId === valueId)
  }

  public setHasMoreValues(): Metavalues {
    this.hasMoreValues = true
    return this
  }

  public add(value: Metavalue | Metavalue[]): Metavalues {
    Array.isArray(value) ? this.values.push(...value) : this.values.push(value)
    return this
  }
}

export class Metavalue {
  public valueId?: string | undefined
  public dataTenant: string | undefined
  public initialCharacters?: CharacterMetaValues
  public currentCharacters?: CharacterMetaValues

  public knowsInitialCharacters() : boolean {
    return this.initialCharacters === undefined
  }

  public knowsCurrentCharacters() : boolean {
    return this.currentCharacters === undefined
  }

  public withInitialCharacters(characters: CharacterMetaValues): Metavalue {
    this.initialCharacters = characters
    return this
  }

  public withCurrentCharacters(characters: CharacterMetaValues): Metavalue {
    this.currentCharacters = characters
    return this
  }

  public static with(
    valueId: string,
    dataTenant: string | undefined,
    initialPerformer?: Identifier | undefined,
    createdAt?: Date | undefined,
    currentPerformer?: Identifier | undefined,
    updatedAt?: Date | undefined
  ) {
    const ret = new Metavalue()
    if (initialPerformer) {
      ret.withInitialCharacters(CharacterMetaValues.fromPerformer(initialPerformer)
        .withTimestamp(createdAt))
    }
    if (currentPerformer) {
      ret.withCurrentCharacters(CharacterMetaValues.fromPerformer(currentPerformer)
        .withTimestamp(updatedAt))
    }

    ret.valueId = valueId
    ret.dataTenant = dataTenant
    return ret
  }
}

export class Identifier {
    type: string | undefined;
    id: string;

    constructor(id: string, type?: string | undefined) {
        this.type = type;
        this.id = id;
    }
}

export class CharacterMetaValues implements ICharacters {
    subject?: Identifier | undefined
    responsible?: Identifier | undefined
    performer?: Identifier | undefined
    public timestamp?: Date | undefined

    public hasSubject(): boolean {
        return this.subject != null
    }

    public hasResponsible(): boolean {
        return this.responsible != null
    }

    public hasPerformer(): boolean {
        return this.performer != null
    }

    public hasTimestamp(): boolean {
        return this.timestamp != null
    }

    public static fromSubject(subjectOrTerm: Identifier): CharacterMetaValues {
        return new CharacterMetaValues().withSubject(subjectOrTerm)
    }

    public static fromResponsible(responsibleOrTerm: Identifier): CharacterMetaValues {
        return new CharacterMetaValues().withResponsible(responsibleOrTerm)
    }

    public static fromPerformer(performerOrTerm: Identifier): CharacterMetaValues {
        return new CharacterMetaValues().withPerformer(performerOrTerm)
    }

    public static fromTimestamp(timestamp?: Date): CharacterMetaValues {
        return new CharacterMetaValues().withTimestamp(timestamp)
    }

    public withSubject(subjectOrTerm: Identifier): CharacterMetaValues {
        this.subject = subjectOrTerm
        return this
    }

    public withResponsible(responsibleOrTerm: Identifier): CharacterMetaValues {
        this.responsible = responsibleOrTerm
        return this
    }

    public withPerformer(performerOrTerm: Identifier): CharacterMetaValues {
        this.performer = performerOrTerm
        return this
    }

    public withTimestamp(timestamp?: Date): CharacterMetaValues {
        this.timestamp = timestamp
        return this
    }
}

export interface ICharacters {
    subject?: Identifier | undefined 
    responsible?: Identifier | undefined
    performer?: Identifier | undefined
}

export interface TransportErrorDetails {
    technicalError?: string | undefined,
    userError?: string | undefined,
    sessionIdentifier?: string | undefined,
    callingClient?: string | undefined,
    callingUsage?: string | undefined,
    calledOperation?: string | undefined,
    transactionId?: string | undefined,
}

export class TransportError {
    public static basic(code: string, technicalError: string, userError?: string, relatedErrors?: TransportError[]): TransportError {
        return new TransportError(
            code,
            {
                technicalError: technicalError,
                userError: userError,
                sessionIdentifier: undefined,
                calledOperation: undefined,
                callingClient: undefined,
                transactionId: undefined
            },
            relatedErrors,
            undefined
        )
    }

    public static fromParent(parentError: TransportError, code: string, technicalError: string, userError?: string, relatedErrors?: TransportError[]): TransportError {
        return new TransportError(
            code,
            {
                technicalError: technicalError,
                userError: userError,
                sessionIdentifier: undefined,
                calledOperation: undefined,
                callingClient: undefined,
                transactionId: undefined
            },
            relatedErrors,
            parentError
        )
    }

    public readonly code: string
    public readonly details: TransportErrorDetails
    public readonly related: TransportError[]
    public readonly parent?: TransportError | undefined

    public constructor(
        code: string,
        details: TransportErrorDetails | string,
        related?: TransportError[] | undefined,
        parent?: TransportError | undefined
    ) {
        this.code = code
        this.details = typeof(details) == 'string' ? 
            {technicalError: details} : 
            details ?? { technicalError: 'Unknown error'}
        this.related = related ?? new Array<TransportError>()
        this.parent = parent
    }

    public toShortString = () : string => {
        return TransportError.getShortString(this, '')
    }

    public toString = () : string => {
        return TransportError.getString(this, '')
    }

    public toLongString = () : string => {
        return TransportError.getLongString(this, '')
    }

    private static getShortString(error: TransportError, initialTabs: string): string {
        const tech = error.details?.technicalError;
        if (!tech || tech.trim().length === 0) {
            return `${initialTabs}${error.code}`;
        }
        return `${initialTabs}${error.code} - ${tech}`;
    }

    private static getString(error: TransportError, initialTabs: string): string {
        let sb = TransportError.getShortString(error, initialTabs);
        if (!error.related || error.related.length === 0) {
            return sb;
        }
        sb += `\n${initialTabs}    Related errors:`;
        for (const r of error.related) {
            sb += `\n${TransportError.getShortString(r, initialTabs + '        ')}`;
        }
        return sb;
    }

    private static getLongString(error: TransportError, initialTabs: string): string {
        let sb = ""
        if (error.details) {
            if (error.details.transactionId)
                sb += `\n${initialTabs}TransactionId: ${error.details.transactionId}`; 
            if (error.details.sessionIdentifier)
                sb += `\n${initialTabs}Session: ${error.details.sessionIdentifier}`;
            if (error.details.callingClient)
                sb += `\n${initialTabs}Client: ${error.details.callingClient}`;
            if (error.details.callingUsage)
                sb += `\n${initialTabs}Usage: ${error.details.callingUsage}`;
            if (error.details.calledOperation)
                sb += `\n${initialTabs}Operation: ${error.details.calledOperation}`;
        }
        sb += `\n${initialTabs}${TransportError.getString(error, initialTabs)}`
        if (!error.parent) {
            return sb;
        }
        sb += `\n${initialTabs}Parent error:`;
        // Remove trailing newlines from parent string
        let parentStr = TransportError.getLongString(error.parent, initialTabs);
        // Indent each line of the parent string
        parentStr = parentStr
            .split('\n')
            .map(line => (line.length > 0 ? initialTabs + '   ' + line : line))
            .join('\n')
            .replace(/[\n\r]+$/, '')
            .replace(/^\s*\n/, '')
        sb += `\n${parentStr}`;
        // Trim leading empty lines before returning
        return sb.replace(/^\s*\n/, '');
    }

    private isNullOrEmpty(s: string | undefined) : boolean {
        return !s || s.length === 0
    }
}

export interface TransportSessionConfiguration {
    locale: string
    interceptors: TransportDispatcher
    serializer: TransportSerializer
}

export class TransportDispatcher {
    private sortPatterns: boolean
    private sortedPatterns: string[] = []

    public requestsInspector: RequestInspector | null = null
    public responsesInspector: ResponseInspector | null = null 

    private requestHandlers: Map<string,RequestInterceptor<object,object>> = new Map<string,RequestInterceptor<object,object>>()
    private messageHandlers: Map<string,MessageInterceptor<object>> = new Map<string,MessageInterceptor<object>>()
    private patternHandlers: Map<string,RequestInterceptor<object,object>> = new Map<string,RequestInterceptor<object,object>>()

    constructor(
        public sessionIdentifier: string,
        public contextCache: ContextCache,
        public cacheReads: boolean
    ) {
        this.sortPatterns = false
    }

    public addRequestHandler(operationId: string, handler: RequestInterceptor<object,object>): void {
        this.validateUniqueHandler(operationId)
        this.requestHandlers.set(operationId, handler)
    }

    public addMessageHandler(operationId: string, handler: MessageInterceptor<object>): void {
        this.validateUniqueHandler(operationId)
        this.messageHandlers.set(operationId, handler)
    }

    public addPatternHandler(pattern: string, handler: RequestInterceptor<object,object>): void {
        this.validateUniqueHandler(pattern)
        this.patternHandlers.set(pattern, handler)
        this.sortPatterns = true
    }

    public async routeFromGatewayRequest(input: object, ctx: TransportContext): Promise<Result<object>> {
        if (ctx.operation.type === "request")
            return await this.handleAsRequest(input, ctx)
        else
            return (await this.handleAsMessage(input, ctx)).asGeneric()
    }

    public async handleAsMessage(input: object, ctx: TransportContext, matchSessions: boolean = false): Promise<Result<unknown>> {
        const inspectionResult = await this.inspectRequest(input, ctx)
        const cacheResult = await this.handleCache(ctx, matchSessions)
        if (!cacheResult.success)
            return cacheResult
        if (inspectionResult)
            return inspectionResult
        const handler = this.messageHandlers.get(cacheResult.value.operation.id)
        if (handler)
            return await this.runMessageHandler(handler, input, cacheResult.value)
        return await this.runPatternHandler(input, cacheResult.value)
    }

    public async handleAsRequest(input: object, ctx: TransportContext, matchSessions: boolean = false): Promise<Result<object>> {
        const inspectionResult = await this.inspectRequest(input, ctx)
        const cacheResult = await this.handleCache(ctx, matchSessions)
        if (!cacheResult.success)
            return cacheResult
        if (inspectionResult)
            return inspectionResult
        const handler = this.requestHandlers.get(cacheResult.value.operation.id)
        if (handler)
            return await this.runRequestHandler(handler, input, cacheResult.value)
        return await this.runPatternHandler(input, cacheResult.value)
    }

    private validateUniqueHandler(id: string) {
        if (
            this.requestHandlers.has(id) ||
            this.messageHandlers.has(id) ||
            this.patternHandlers.has(id)
        ) {
            throw new Error('The path ' + id + ' already has a handler')
        }
    }

    private async handleCache(ctx: TransportContext, matchSessions: boolean): Promise<Result<TransportContext>> {
        if (this.cacheReads)
            return Result.ok(ctx)

        try {
            const result = await this.contextCache.put(ctx.call.transactionId as string, ctx.call)
            if (!result)
                return Result.failed(500, "TransportAbstraction.ContextCachePersistance", "The incoming context could not be presisted for transaction " + ctx.call.transactionId)
            return Result.ok(ctx)
        } catch (e) {
            Logger.error((e as Error).message)
            return this.genericError(e) as unknown as Result<TransportContext>
        }
    }

    public async getCallInfoFromCache(newTransactionId: string, callInfo: CallInformation, matchSessions: boolean): Promise<CallInformation> {
        if (!this.cacheReads)
            return callInfo
        if (!matchSessions)
            return callInfo

        try {
            const result = await this.contextCache.get(newTransactionId)
            if (!result) {
                Logger.error("Failed to read context cache for recrod " + callInfo.transactionId)
                return callInfo
            }
            return result
        } catch (e) {
            Logger.error((e as Error).message)
            return callInfo
        }
    }

    private async runPatternHandler(input: object, ctx: TransportContext): Promise<Result<object>> {
        const matchingPattern = this.findMatchingPattern(ctx.operation.id)
        if (matchingPattern) {
            const patternHandler = this.patternHandlers.get(matchingPattern)
            if (patternHandler)
                return await this.runRequestHandler(patternHandler, input, ctx)
            return await this.inspectResponse(this.handlerNotFound(ctx.operation.id).asGeneric(), input, ctx)
        }
        return await this.inspectResponse(this.handlerNotFound(ctx.operation.id).asGeneric(), input, ctx)
    }

    private async runMessageHandler(handler: MessageInterceptor<object>, input: object, ctx: TransportContext): Promise<Result<object>> {
        let result: Result<object>
        try {
            result = (await handler(input, ctx)).convert<object>()
        } catch (e) {
            result = this.genericError(e)
        }
        return await this.inspectResponse(result, input, ctx)
    }

    private async runRequestHandler(handler: RequestInterceptor<object,object>, input: object, ctx: TransportContext): Promise<Result<object>> {
        let result: Result<object>
        try {
            result = await handler(input, ctx) 
        } catch (e) {
            result = this.genericError(e)
        }
        return await this.inspectResponse(result, input, ctx)
    }

    private findMatchingPattern(featureId: string) : string | null {
        if (this.sortPatterns)
            this.reSortPatterns()
        for (const key of this.sortedPatterns) {
            if (featureId.startsWith(key))
                return key
        }
        return null as unknown as string
    }

    private reSortPatterns(): void {
        const keys = Array.from(this.patternHandlers.keys())
        keys.sort((a,b) => a.toLowerCase().length > b.toLowerCase().length ? -1 : 1)
        this.sortedPatterns = keys
        this.sortPatterns = false
    }

    private async inspectRequest(cinput: object, ctx: TransportContext): Promise<Result<object> | void> {
        if (this.requestsInspector == null)
            return

        try {
            return await this.requestsInspector(cinput, ctx)
        } catch (e) {
            Logger.error((e as Error).message)
        }
    }

    public async inspectMessageResponse(result: Result<object>, cinput: object, ctx: TransportContext): Promise<Result<object>> {
        if (this.responsesInspector == null)
            return result

        try {
            return await this.responsesInspector(result, cinput, ctx)
        } catch (e) {
            Logger.error((e as Error).message)
        }

        return result
    }

    public async inspectResponse(result: Result<object>, cinput: object, ctx: TransportContext): Promise<Result<object>> {
        this.enrichError(result, ctx)
        if (this.responsesInspector == null)
            return result

        try {
            const awaitedResult = await result
            this.responsesInspector(awaitedResult, cinput, ctx)
        } catch (e) {
            Logger.error((e as Error).message)
        }

        return result
    }

    private enrichError(result: Result<object>, ctx: TransportContext) {
        if (result.error && result.error.details) {
            result.error.details.calledOperation = ctx.operation.id
            result.error.details.callingClient = ctx.operation.callingClient
            result.error.details.callingUsage = ctx.operation.usageId
        }
    }

    private handlerNotFound(operationId: string): Result<object> {
        return Result.badRequest("TransportAbstraction.HandlerNotFound", "There are no matching handlers for the operation: " + operationId)
    }

    private genericError(e: unknown): Result<object> {
        if (e) {
            const err = (e as Error)
            return Result.failed(500, "TransportAbstraction.UnhandledError", err.message + ": " + err.name + (err.stack ? "\n" + err.stack : ""))
        }
        return Result.failed(500, "TransportAbstraction.UnhandledError", "Unknown error")
    }
}

export enum LogLevel {
    TRACE = 5,
    DEBUG = 4,
    INFO = 3,
    WARNING = 2,
    ERROR = 1,
    FATAL = 0,
}

export class LogMessage {
    public constructor(
        private source: string,
        private timestamp: Date,
        private level: LogLevel,
        private message: string,
        private error?: Error,
    ) { }

    public isWithin(level: LogLevel): boolean {
        return this.level <= level
    }

    public toString(): string {
        const pad = (n: number, z = 2) => String(n).padStart(z, '0');
        const formatTimestamp = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
        let s = `${formatTimestamp(this.timestamp)} ${LogLevel[this.level]} - ${this.message}\n`

        if (this.error) {
            s += `${formatTimestamp(this.timestamp)} ${LogLevel[this.level]} - ${this.error.message}\n`
        }

        return s
    }

    public toJSON(): string {
        return this.toString()
    }
}

export interface TransportAbstractionLogger {
    logLevel: LogLevel
    write: (message: LogMessage) => void;
}

export class DefaultLogger implements TransportAbstractionLogger {
    public logLevel = LogLevel.DEBUG

    public write(message: LogMessage): void {
        if (message.isWithin(this.logLevel)) {
            console.log(message.toString())
        }
    }
}

export class Logger {
    private static source = ''
    private static logger: TransportAbstractionLogger = new DefaultLogger()

    public static assignLogger(logger: TransportAbstractionLogger): void {
        this.logger = logger
    }

    public static updateSource(source: string): void {
        this.source = source
    }

    public static write(message: string, level: LogLevel, error?: Error) {
        if (!this.logger) throw new Error('Logger has not been assigned')
        this.logger.write(new LogMessage(this.source, new Date(), level, message, error))
    }

    public static trace(message: string, error?: Error) {
        this.write(message, LogLevel.TRACE, error)
    }

    public static info(message: string, error?: Error) {
        this.write(message, LogLevel.INFO, error)
    }

    public static debug(message: string, error?: Error) {
        this.write(message, LogLevel.DEBUG, error)
    }

    public static warning(message: string, error?: Error) {
        this.write(message, LogLevel.WARNING, error)
    }

    public static error(message: string, error?: Error) {
        this.write(message, LogLevel.ERROR, error)
    }

    public static fatal(message: string, error?: Error) {
        this.write(message, LogLevel.FATAL, error)
    }
}

export type TransportOperationCharacter = {
    required: boolean
    validTypes?: string[] | undefined
}

export type TransportOperationCharacterSetup = {
    performer?: TransportOperationCharacter | undefined
    responsible?: TransportOperationCharacter | undefined
    subject?: TransportOperationCharacter | undefined
}

export type TransportOperationSettings = {
    requiresTenant: boolean,
    characterSetup: TransportOperationCharacterSetup
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class TransportOperation<T, R = undefined> { 
    constructor(
        public type: string,
        public id: string,
        public verb: string,
        public pathParameters?: string[],
        public settings?: TransportOperationSettings
    ) { } 
}

export abstract class OperationHandler<T, R> {
    constructor(
        public operation: TransportOperation<T,R>
    ) { }
}

export class RequestOperationHandler<T, R> extends OperationHandler<T, R> {
    constructor(
        operation: RequestOperation<T,R>,
        public handler: (input: T, ctx: TransportContext) => Promise<Result<R>>
    ) {
        super(operation)
    }
}

export class MessageOperationHandler<T> extends OperationHandler<T, undefined> {
    constructor(
        operation: MessageOperation<T>,
        public handler: (input: T, ctx: TransportContext) => Promise<Result>
    ) {
        super(operation)
    }
}

export abstract class OperationRequest<T,R> {
    public constructor(
        public usageId: string,
        public operation: TransportOperation<T,R>,
        public input: T
    ) { }

    public asOperationInformation(callingClient: string): OperationInformation {
        return new OperationInformation(
            this.operation.id,
            this.operation.verb,
            this.operation.type,
            callingClient,
            this.usageId)
    }
}

export class RequestOperationRequest<T,R> extends OperationRequest<T,R> { }
export class MessageOperationRequest<T> extends OperationRequest<T,undefined> { }

export abstract class RequestOperation<T, R> extends TransportOperation<T, R> { 
    constructor(id: string, verb: string, pathParameters?: string[], settings?: TransportOperationSettings) {
        super("request", id, verb, pathParameters, settings)
    }

    protected createHandler<T,R>(instance: RequestOperation<T, R>, interceptor: RequestInterceptor<T, R>): RequestOperationHandler<T, R> {
		return new RequestOperationHandler<T,R>(instance, interceptor)
    }

    public handle(interceptor: RequestInterceptor<T, R>): RequestOperationHandler<T, R> {
		return this.createHandler(this, interceptor)
	}
}

export abstract class MessageOperation<T> extends TransportOperation<T, undefined> { 
    constructor(id: string, verb: string, pathParameters?: string[], settings?: TransportOperationSettings) {
        super("message", id, verb, pathParameters, settings)
    }

    protected createHandler<T>(instance: MessageOperation<T>, interceptor: MessageInterceptor<T>): MessageOperationHandler<T> {
		return new MessageOperationHandler<T>(instance, interceptor)
    }

    public handle(interceptor: MessageInterceptor<T>): MessageOperationHandler<T> {
		return this.createHandler(this, interceptor)
	}
}