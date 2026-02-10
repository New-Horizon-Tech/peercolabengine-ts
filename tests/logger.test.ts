import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogMessage, LogLevel, Logger, DefaultLogger, type TransportSessionLogger } from '../src/index.js'

describe('LogMessage', () => {
  it('isWithin filters by level', () => {
    const msg = new LogMessage('src', new Date(), LogLevel.ERROR, 'err')
    expect(msg.isWithin(LogLevel.ERROR)).toBe(true)
    expect(msg.isWithin(LogLevel.FATAL)).toBe(false)
    expect(msg.isWithin(LogLevel.DEBUG)).toBe(true)
  })

  it('toString() includes timestamp and level', () => {
    const d = new Date(2024, 0, 1, 12, 30, 45, 123)
    const msg = new LogMessage('src', d, LogLevel.INFO, 'hello')
    const s = msg.toString()
    expect(s).toContain('12:30:45.123')
    expect(s).toContain('INFO')
    expect(s).toContain('hello')
  })

  it('toString() includes error when present', () => {
    const msg = new LogMessage('src', new Date(), LogLevel.ERROR, 'msg', new Error('boom'))
    const s = msg.toString()
    expect(s).toContain('boom')
  })

  it('toJSON returns same as toString', () => {
    const msg = new LogMessage('src', new Date(), LogLevel.INFO, 'test')
    expect(msg.toJSON()).toBe(msg.toString())
  })
})

describe('Logger', () => {
  beforeEach(() => {
    // Reset to default logger
    Logger.assignLogger(new DefaultLogger())
  })

  it('write() at all levels without throwing', () => {
    Logger.trace('trace msg')
    Logger.debug('debug msg')
    Logger.info('info msg')
    Logger.warning('warning msg')
    Logger.error('error msg')
    Logger.fatal('fatal msg')
  })

  it('write() with error passes exception', () => {
    const messages: LogMessage[] = []
    Logger.assignLogger({
      logLevel: LogLevel.TRACE,
      write: (msg) => { messages.push(msg) }
    })
    const err = new Error('test error')
    Logger.error('something failed', err)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.toString()).toContain('test error')
  })

  it('updateSource sets source', () => {
    Logger.updateSource('my-service')
    // No direct way to verify source, but it shouldn't throw
  })

  it('assignLogger() uses custom logger', () => {
    const messages: string[] = []
    Logger.assignLogger({
      logLevel: LogLevel.TRACE,
      write: (msg) => { messages.push(msg.toString()) }
    })
    Logger.info('custom message')
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0]).toContain('custom message')
  })
})

describe('LogLevel ordering', () => {
  it('levels are ordered from FATAL (0) to TRACE (5)', () => {
    expect(LogLevel.FATAL).toBe(0)
    expect(LogLevel.ERROR).toBe(1)
    expect(LogLevel.WARNING).toBe(2)
    expect(LogLevel.INFO).toBe(3)
    expect(LogLevel.DEBUG).toBe(4)
    expect(LogLevel.TRACE).toBe(5)
    expect(LogLevel.FATAL).toBeLessThan(LogLevel.ERROR)
    expect(LogLevel.ERROR).toBeLessThan(LogLevel.WARNING)
    expect(LogLevel.WARNING).toBeLessThan(LogLevel.INFO)
    expect(LogLevel.INFO).toBeLessThan(LogLevel.DEBUG)
    expect(LogLevel.DEBUG).toBeLessThan(LogLevel.TRACE)
  })
})

describe('DefaultLogger', () => {
  it('writes to console when within level', () => {
    const logger = new DefaultLogger()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const msg = new LogMessage('src', new Date(), LogLevel.ERROR, 'error msg')
    logger.write(msg)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not write when below level', () => {
    const logger = new DefaultLogger()
    logger.logLevel = LogLevel.ERROR
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const msg = new LogMessage('src', new Date(), LogLevel.INFO, 'info msg')
    logger.write(msg)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
