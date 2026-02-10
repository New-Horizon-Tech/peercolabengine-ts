import { describe, it, expect } from 'vitest'
import {
  Result, Metavalues, Metavalue, TransportError, TransportSerializer,
  CharacterMetaValues, Identifier, ResultPassthroughAsync
} from '../src/index.js'

const jsonSerializer: TransportSerializer = {
  serialize<T>(obj: T): string { return JSON.stringify(obj) },
  deserialize<T>(serialized: string): T { return JSON.parse(serialized) as T },
}

describe('Result', () => {
  describe('ok()', () => {
    it('creates a success result without value', () => {
      const r = Result.ok()
      expect(r.isSuccess()).toBe(true)
      expect(r.hasError()).toBe(false)
      expect(r.statusCode).toBe(200)
      expect(r.value).toBeUndefined()
    })

    it('creates a success result with value', () => {
      const r = Result.ok({ name: 'test' })
      expect(r.isSuccess()).toBe(true)
      expect(r.value).toEqual({ name: 'test' })
    })

    it('creates a success result with meta', () => {
      const meta = new Metavalues()
      meta.setHasMoreValues(true)
      const r = Result.ok('val', meta)
      expect(r.meta.hasMoreValues).toBe(true)
    })
  })

  describe('okStatus()', () => {
    it('creates success with specific status code', () => {
      const r = Result.okStatus(201)
      expect(r.isSuccess()).toBe(true)
      expect(r.statusCode).toBe(201)
      expect(r.value).toBeUndefined()
    })

    it('creates success with 308', () => {
      const r = Result.okStatus(308)
      expect(r.isSuccess()).toBe(true)
    })
  })

  describe('failed()', () => {
    it('creates a failed result', () => {
      const r = Result.failed(500, 'ERR_CODE', 'tech error', 'user error')
      expect(r.isSuccess()).toBe(false)
      expect(r.hasError()).toBe(true)
      expect(r.statusCode).toBe(500)
      expect(r.error!.code).toBe('ERR_CODE')
      expect(r.error!.details.technicalError).toBe('tech error')
      expect(r.error!.details.userError).toBe('user error')
    })

    it('accepts a TransportError directly', () => {
      const err = TransportError.basic('CODE', 'tech')
      const r = Result.failed(500, err)
      expect(r.error).toBe(err)
    })
  })

  describe('notFound()', () => {
    it('returns 404 result', () => {
      const r = Result.notFound('NOT_FOUND')
      expect(r.statusCode).toBe(404)
      expect(r.isSuccess()).toBe(false)
    })
  })

  describe('badRequest()', () => {
    it('returns 400 result', () => {
      const r = Result.badRequest('BAD_REQ')
      expect(r.statusCode).toBe(400)
      expect(r.isSuccess()).toBe(false)
    })
  })

  describe('internalServerError()', () => {
    it('returns 500 result', () => {
      const r = Result.internalServerError('ISE')
      expect(r.statusCode).toBe(500)
      expect(r.isSuccess()).toBe(false)
    })
  })

  describe('status code ranges', () => {
    it('200-308 are success', () => {
      for (const code of [200, 201, 204, 300, 308]) {
        const r = Result.okStatus(code)
        expect(r.isSuccess()).toBe(true)
      }
    })

    it('auto-creates error for non-success status codes', () => {
      const r = new Result({ statusCode: 400, value: undefined, success: false, meta: new Metavalues() } as Result)
      expect(r.hasError()).toBe(true)
      expect(r.error!.code).toBe('400')
    })
  })

  describe('serialize / deserialize', () => {
    it('throws without serializer', () => {
      const r = Result.ok('hello')
      expect(() => r.serialize()).toThrow('No serializer assigned to Result')
    })

    it('throws deserialize without serializer', () => {
      const r = Result.ok('hello')
      expect(() => r.deserialize('anything')).toThrow('No serializer assigned to Result')
    })

    it('round-trips through serialize/deserialize', () => {
      const r = Result.ok({ foo: 'bar' })
      r.assignSerializer(jsonSerializer)
      const json = r.serialize()
      const r2 = r.deserialize<{ foo: string }>(json)
      expect(r2.isSuccess()).toBe(true)
      expect(r2.value).toEqual({ foo: 'bar' })
    })
  })

  describe('meta manipulation', () => {
    it('setMeta replaces meta', () => {
      const r = Result.ok()
      const meta = new Metavalues()
      meta.setHasMoreValues(true)
      r.setMeta(meta)
      expect(r.meta.hasMoreValues).toBe(true)
    })

    it('withMeta allows handler to modify', () => {
      const r = Result.ok()
      r.withMeta(m => m.setTotalValueCount(42))
      expect(r.meta.totalValueCount).toBe(42)
    })

    it('AddMetaValue adds a single metavalue', () => {
      const r = Result.ok()
      const mv = new Metavalue()
      mv.valueId = 'v1'
      r.AddMetaValue(mv)
      expect(r.meta.values).toHaveLength(1)
      expect(r.meta.values[0]!.valueId).toBe('v1')
    })

    it('AddMetaValues adds multiple', () => {
      const r = Result.ok()
      const mv1 = new Metavalue(); mv1.valueId = 'a'
      const mv2 = new Metavalue(); mv2.valueId = 'b'
      r.AddMetaValues([mv1, mv2])
      expect(r.meta.values).toHaveLength(2)
    })
  })

  describe('convert with serializer', () => {
    it('returns error when conversion fails without serializer and value present', () => {
      const r = Result.ok({ x: 1 })
      const converted = r.convert<string>()
      expect(converted.isSuccess()).toBe(false)
    })

    it('convert returns self when value is null', () => {
      const r = Result.ok(null as unknown as string)
      const converted = r.convert<number>()
      expect(converted).toBe(r)
    })
  })

  describe('convert / convertToEmpty / asGeneric', () => {
    it('convertToEmpty on success returns ok with undefined value', () => {
      const r = Result.ok({ data: 1 })
      const e = r.convertToEmpty()
      expect(e.isSuccess()).toBe(true)
      expect(e.value).toBeUndefined()
    })

    it('convertToEmpty on failure preserves error', () => {
      const r = Result.failed<string>(500, 'ERR')
      const e = r.convertToEmpty()
      expect(e.isSuccess()).toBe(false)
      expect(e.error!.code).toBe('ERR')
    })

    it('asGeneric returns Result<object>', () => {
      const r = Result.ok()
      const g = r.asGeneric()
      expect(g.isSuccess()).toBe(true)
    })
  })

  describe('maybe', () => {
    it('calls onSuccess when result is success', () => {
      const r = Result.ok(10)
      const r2 = r.maybe(v => Result.ok(v * 2))
      expect(r2.value).toBe(20)
    })

    it('skips onSuccess when result is failure', () => {
      const r = Result.failed<number>(500, 'ERR')
      const r2 = r.maybe(v => Result.ok(v * 2))
      expect(r2.isSuccess()).toBe(false)
    })

    it('catches exceptions and returns error result', () => {
      const r = Result.ok(10)
      const r2 = r.maybe(() => { throw new Error('boom') })
      expect(r2.isSuccess()).toBe(false)
      expect(r2.statusCode).toBe(500)
    })
  })

  describe('maybeOk', () => {
    it('runs handler on success and returns original value', () => {
      let called = false
      const r = Result.ok(42)
      const r2 = r.maybeOk(() => { called = true })
      expect(called).toBe(true)
      expect(r2.value).toBe(42)
    })

    it('skips handler on failure', () => {
      let called = false
      const r = Result.failed<number>(400, 'ERR')
      r.maybeOk(() => { called = true })
      expect(called).toBe(false)
    })

    it('catches exceptions', () => {
      const r = Result.ok(1)
      const r2 = r.maybeOk(() => { throw new Error('fail') })
      expect(r2.isSuccess()).toBe(false)
    })
  })

  describe('maybePassThrough', () => {
    it('returns original on success path', () => {
      const r = Result.ok(99)
      const r2 = r.maybePassThrough(() => Result.ok('ignored'))
      expect(r2.value).toBe(99)
    })

    it('returns failure if inner fails', () => {
      const r = Result.ok(99)
      const r2 = r.maybePassThrough(() => Result.failed(400, 'BAD'))
      expect(r2.isSuccess()).toBe(false)
    })

    it('returns self on failure without calling handler', () => {
      const r = Result.failed<number>(500, 'ERR')
      let called = false
      const r2 = r.maybePassThrough(() => { called = true; return Result.ok() })
      expect(called).toBe(false)
      expect(r2).toBe(r)
    })

    it('catches exceptions', () => {
      const r = Result.ok(1)
      const r2 = r.maybePassThrough(() => { throw new Error('oops') })
      expect(r2.isSuccess()).toBe(false)
    })
  })

  describe('maybePassThroughOk', () => {
    it('returns ok with original value on success', () => {
      const r = Result.ok(5)
      const r2 = r.maybePassThroughOk(() => {})
      expect(r2.value).toBe(5)
      expect(r2.isSuccess()).toBe(true)
    })

    it('returns self on failure', () => {
      const r = Result.failed<number>(400, 'ERR')
      const r2 = r.maybePassThroughOk(() => {})
      expect(r2).toBe(r)
    })

    it('catches exceptions', () => {
      const r = Result.ok(1)
      const r2 = r.maybePassThroughOk(() => { throw new Error('boom') })
      expect(r2.isSuccess()).toBe(false)
    })
  })

  describe('maybePassThrough async variants', () => {
    it('async maybe on success calls handler', async () => {
      const r = Result.ok(10)
      // Simulate async by wrapping in ResultPassthroughAsync
      const result = await ResultPassthroughAsync
        .startWith(async () => r.maybe(v => Result.ok(v * 3)))
        .run()
      expect(result.value).toBe(30)
    })

    it('async maybe on failure skips handler', async () => {
      const r = Result.failed<number>(400, 'ERR')
      const result = await ResultPassthroughAsync
        .startWith(async () => r.maybe(v => Result.ok(v * 3)))
        .run()
      expect(result.isSuccess()).toBe(false)
    })
  })

  describe('copy constructor behavior', () => {
    it('constructor copies all fields', () => {
      const meta = new Metavalues()
      meta.setHasMoreValues(true)
      const original = { value: 'hello', statusCode: 200, success: true, meta, error: undefined } as unknown as Result<string>
      const copy = new Result(original)
      expect(copy.value).toBe('hello')
      expect(copy.statusCode).toBe(200)
      expect(copy.isSuccess()).toBe(true)
      expect(copy.meta.hasMoreValues).toBe(true)
    })

    it('constructor with error and no statusCode defaults to 500', () => {
      const err = TransportError.basic('ERR', 'tech')
      const r = new Result({ value: undefined, statusCode: 0, success: false, meta: new Metavalues(), error: err } as unknown as Result)
      expect(r.statusCode).toBe(500)
      expect(r.error).toBe(err)
    })
  })

  describe('deserializeResult', () => {
    it('fully deserializes including meta, characters, and error chains', () => {
      const original = Result.ok({ id: 1 })
      original.AddMetaValue(
        Metavalue.with('v1', 'tenant1', new Identifier('p1', 'user'), new Date(), new Identifier('p2', 'admin'))
      )
      original.meta.setHasMoreValues(true)
      original.meta.setTotalValueCount(10)
      original.meta.withAttribute('key', 'val' as unknown as object)

      original.assignSerializer(jsonSerializer)
      const json = original.serialize()
      const restored = Result.deserializeResult<{ id: number }>(jsonSerializer, json)

      expect(restored.isSuccess()).toBe(true)
      expect(restored.value).toEqual({ id: 1 })
      expect(restored.meta.hasMoreValues).toBe(true)
      expect(restored.meta.totalValueCount).toBe(10)
      expect(restored.meta.values).toHaveLength(1)
      expect(restored.meta.values[0]!.valueId).toBe('v1')
      expect(restored.meta.values[0]!.initialCharacters?.performer?.id).toBe('p1')
      expect(restored.meta.values[0]!.currentCharacters?.performer?.id).toBe('p2')
      expect(restored.meta.hasAttribute('key')).toBe(true)
    })

    it('deserializes error chains', () => {
      const parent = TransportError.basic('PARENT', 'parent tech')
      const related = TransportError.basic('RELATED', 'related tech')
      const err = new TransportError('MAIN', { technicalError: 'main tech' }, [related], parent)
      const r = Result.failed(500, err)
      r.assignSerializer(jsonSerializer)
      const json = r.serialize()
      const restored = Result.deserializeResult<undefined>(jsonSerializer, json)

      expect(restored.error!.code).toBe('MAIN')
      expect(restored.error!.parent!.code).toBe('PARENT')
      expect(restored.error!.related).toHaveLength(1)
      expect(restored.error!.related[0]!.code).toBe('RELATED')
    })
  })
})
