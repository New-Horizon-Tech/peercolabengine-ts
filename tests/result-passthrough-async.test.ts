import { describe, it, expect } from 'vitest'
import { ResultPassthroughAsync, Result } from '../src/index.js'

describe('ResultPassthroughAsync', () => {
  it('returns initial result on success with no chained actions', async () => {
    const r = await ResultPassthroughAsync
      .startWith(async () => Result.ok(42))
      .run()
    expect(r.isSuccess()).toBe(true)
    expect(r.value).toBe(42)
  })

  it('returns initial result when all chained actions succeed', async () => {
    const r = await ResultPassthroughAsync
      .startWith(async () => Result.ok('hello'))
      .then(async () => Result.ok())
      .then(async () => Result.ok())
      .run()
    expect(r.value).toBe('hello')
  })

  it('stops on first chained failure', async () => {
    let thirdCalled = false
    const r = await ResultPassthroughAsync
      .startWith(async () => Result.ok(1))
      .then(async () => Result.failed(400, 'BAD'))
      .then(async () => { thirdCalled = true; return Result.ok() })
      .run()
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(400)
    expect(thirdCalled).toBe(false)
  })

  it('returns failure when initial action fails', async () => {
    const r = await ResultPassthroughAsync
      .startWith(async () => Result.failed(500, 'INIT_FAIL'))
      .then(async () => Result.ok())
      .run()
    expect(r.isSuccess()).toBe(false)
    expect(r.error!.code).toBe('INIT_FAIL')
  })

  it('handles exception in initial action', async () => {
    const r = await ResultPassthroughAsync
      .startWith<number>(async () => { throw new Error('boom') })
      .run()
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(500)
  })

  it('handles exception in chained action', async () => {
    const r = await ResultPassthroughAsync
      .startWith(async () => Result.ok(1))
      .then(async () => { throw new Error('chain boom') })
      .run()
    expect(r.isSuccess()).toBe(false)
    expect(r.statusCode).toBe(500)
  })
})
