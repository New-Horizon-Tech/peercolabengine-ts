import { describe, it, expect } from 'vitest'
import { TransportError } from '../src/index.js'

describe('TransportError', () => {
  describe('constructor', () => {
    it('accepts string details', () => {
      const e = new TransportError('CODE', 'some error')
      expect(e.code).toBe('CODE')
      expect(e.details.technicalError).toBe('some error')
    })

    it('accepts object details', () => {
      const e = new TransportError('CODE', { technicalError: 'tech', userError: 'user' })
      expect(e.details.technicalError).toBe('tech')
      expect(e.details.userError).toBe('user')
    })

    it('defaults related to empty array', () => {
      const e = new TransportError('C', 'err')
      expect(e.related).toEqual([])
    })

    it('defaults parent to undefined', () => {
      const e = new TransportError('C', 'err')
      expect(e.parent).toBeUndefined()
    })
  })

  describe('basic()', () => {
    it('creates error with code and technical error', () => {
      const e = TransportError.basic('ERR_CODE', 'tech error', 'user error')
      expect(e.code).toBe('ERR_CODE')
      expect(e.details.technicalError).toBe('tech error')
      expect(e.details.userError).toBe('user error')
    })

    it('creates error with related errors', () => {
      const related = TransportError.basic('R1', 'related')
      const e = TransportError.basic('MAIN', 'main', undefined, [related])
      expect(e.related).toHaveLength(1)
      expect(e.related[0]!.code).toBe('R1')
    })
  })

  describe('fromParent()', () => {
    it('creates error with parent chain', () => {
      const parent = TransportError.basic('PARENT', 'parent error')
      const child = TransportError.fromParent(parent, 'CHILD', 'child error')
      expect(child.code).toBe('CHILD')
      expect(child.parent).toBe(parent)
    })
  })

  describe('toShortString()', () => {
    it('returns code - technicalError', () => {
      const e = TransportError.basic('CODE', 'tech error')
      expect(e.toShortString()).toBe('CODE - tech error')
    })

    it('returns just code when no technical error', () => {
      const e = new TransportError('CODE', { technicalError: '' })
      expect(e.toShortString()).toBe('CODE')
    })
  })

  describe('toString()', () => {
    it('includes related errors', () => {
      const r = TransportError.basic('R1', 'related1')
      const e = TransportError.basic('MAIN', 'main', undefined, [r])
      const s = e.toString()
      expect(s).toContain('MAIN - main')
      expect(s).toContain('Related errors')
      expect(s).toContain('R1 - related1')
    })

    it('returns short string when no related', () => {
      const e = TransportError.basic('CODE', 'tech')
      expect(e.toString()).toBe('CODE - tech')
    })
  })

  describe('TransportErrorDetails', () => {
    it('all properties can be set', () => {
      const e = new TransportError('CODE', {
        technicalError: 'tech',
        userError: 'user',
        sessionIdentifier: 'sess',
        callingClient: 'client',
        callingUsage: 'usage',
        calledOperation: 'op',
        transactionId: 'tx',
      })
      expect(e.details.technicalError).toBe('tech')
      expect(e.details.userError).toBe('user')
      expect(e.details.sessionIdentifier).toBe('sess')
      expect(e.details.callingClient).toBe('client')
      expect(e.details.callingUsage).toBe('usage')
      expect(e.details.calledOperation).toBe('op')
      expect(e.details.transactionId).toBe('tx')
    })
  })

  describe('toLongString()', () => {
    it('includes parent error info', () => {
      const parent = TransportError.basic('PARENT', 'parent tech')
      const child = TransportError.fromParent(parent, 'CHILD', 'child tech')
      const s = child.toLongString()
      expect(s).toContain('CHILD - child tech')
      expect(s).toContain('Parent error')
      expect(s).toContain('PARENT - parent tech')
    })

    it('includes detail fields when present', () => {
      const e = new TransportError('CODE', {
        technicalError: 'tech',
        transactionId: 'tx-1',
        sessionIdentifier: 'sess-1',
        callingClient: 'client-1',
        callingUsage: 'usage-1',
        calledOperation: 'op-1',
      })
      const s = e.toLongString()
      expect(s).toContain('TransactionId: tx-1')
      expect(s).toContain('Session: sess-1')
      expect(s).toContain('Client: client-1')
      expect(s).toContain('Usage: usage-1')
      expect(s).toContain('Operation: op-1')
    })
  })
})
