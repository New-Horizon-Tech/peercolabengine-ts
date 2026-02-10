import { describe, it, expect } from 'vitest'
import {
  Metavalues, Metavalue, CharacterMetaValues, Identifier, Attribute
} from '../src/index.js'

describe('Metavalues', () => {
  it('starts empty', () => {
    const m = new Metavalues()
    expect(m.hasMoreValues).toBe(false)
    expect(m.values).toHaveLength(0)
    expect(m.totalValueCount).toBeUndefined()
  })

  it('add single and array', () => {
    const m = new Metavalues()
    const v1 = new Metavalue(); v1.valueId = 'a'
    const v2 = new Metavalue(); v2.valueId = 'b'
    m.add(v1)
    m.add([v2])
    expect(m.values).toHaveLength(2)
  })

  it('hasMetaValue / getMetaValue', () => {
    const m = new Metavalues()
    const v = new Metavalue(); v.valueId = 'x'
    m.add(v)
    expect(m.hasMetaValue('x')).toBe(true)
    expect(m.hasMetaValue('y')).toBe(false)
    expect(m.getMetaValue('x')).toBe(v)
    expect(m.getMetaValue('y')).toBeUndefined()
  })

  it('setHasMoreValues / setTotalValueCount', () => {
    const m = new Metavalues()
    m.setHasMoreValues(true)
    expect(m.hasMoreValues).toBe(true)
    m.setHasMoreValues()
    expect(m.hasMoreValues).toBe(true) // defaults to true
    m.setTotalValueCount(100)
    expect(m.totalValueCount).toBe(100)
  })

  it('setHasMoreValues can set false', () => {
    const m = new Metavalues()
    m.setHasMoreValues(true)
    m.setHasMoreValues(false)
    expect(m.hasMoreValues).toBe(false)
  })

  it('setTotalValueCount undefined clears count', () => {
    const m = new Metavalues()
    m.setTotalValueCount(50)
    m.setTotalValueCount(undefined)
    expect(m.totalValueCount).toBeUndefined()
  })

  it('getAttribute returns undefined for missing', () => {
    const m = new Metavalues()
    expect(m.getAttribute('nonexistent')).toBeUndefined()
  })

  it('fluent chaining', () => {
    const m = new Metavalues()
    const result = m.setHasMoreValues(true).setTotalValueCount(10).withAttribute('k', 'v' as unknown as object)
    expect(result).toBe(m)
    expect(m.hasMoreValues).toBe(true)
    expect(m.totalValueCount).toBe(10)
    expect(m.getAttribute('k')).toBe('v')
  })

  it('attributes: withAttribute, hasAttribute, getAttribute', () => {
    const m = new Metavalues()
    m.withAttribute('key', 'val' as unknown as object)
    expect(m.hasAttribute('key')).toBe(true)
    expect(m.getAttribute('key')).toBe('val')
    // overwrite
    m.withAttribute('key', 'val2' as unknown as object)
    expect(m.getAttribute('key')).toBe('val2')
  })
})

describe('Metavalue', () => {
  it('withInitialCharacters / withCurrentCharacters', () => {
    const mv = new Metavalue()
    const chars = CharacterMetaValues.fromPerformer(new Identifier('p1'))
    mv.withInitialCharacters(chars)
    expect(mv.initialCharacters).toBe(chars)
    const current = CharacterMetaValues.fromSubject(new Identifier('s1'))
    mv.withCurrentCharacters(current)
    expect(mv.currentCharacters).toBe(current)
  })

  it('getAttribute returns undefined for missing', () => {
    const mv = new Metavalue()
    expect(mv.getAttribute('nonexistent')).toBeUndefined()
  })

  it('attributes on metavalue', () => {
    const mv = new Metavalue()
    mv.withAttribute('a', 1 as unknown as object)
    expect(mv.hasAttribute('a')).toBe(true)
    expect(mv.getAttribute('a')).toBe(1)
    // overwrite
    mv.withAttribute('a', 2 as unknown as object)
    expect(mv.getAttribute('a')).toBe(2)
  })

  it('Metavalue.with() static factory', () => {
    const mv = Metavalue.with(
      'v1', 'tenant',
      new Identifier('performer1', 'user'), new Date(),
      new Identifier('performer2', 'admin'), new Date()
    )
    expect(mv.valueId).toBe('v1')
    expect(mv.dataTenant).toBe('tenant')
    expect(mv.initialCharacters).toBeDefined()
    expect(mv.currentCharacters).toBeDefined()
  })

  it('knowsInitialCharacters returns true when undefined (inverted logic)', () => {
    const mv = new Metavalue()
    expect(mv.knowsInitialCharacters()).toBe(true)
    mv.withInitialCharacters(new CharacterMetaValues())
    expect(mv.knowsInitialCharacters()).toBe(false)
  })

  it('knowsCurrentCharacters returns true when undefined (inverted logic)', () => {
    const mv = new Metavalue()
    expect(mv.knowsCurrentCharacters()).toBe(true)
    mv.withCurrentCharacters(new CharacterMetaValues())
    expect(mv.knowsCurrentCharacters()).toBe(false)
  })
})

describe('CharacterMetaValues', () => {
  it('fromSubject', () => {
    const c = CharacterMetaValues.fromSubject(new Identifier('s1', 'type'))
    expect(c.hasSubject()).toBe(true)
    expect(c.subject!.id).toBe('s1')
  })

  it('fromResponsible', () => {
    const c = CharacterMetaValues.fromResponsible(new Identifier('r1'))
    expect(c.hasResponsible()).toBe(true)
  })

  it('fromPerformer', () => {
    const c = CharacterMetaValues.fromPerformer(new Identifier('p1'))
    expect(c.hasPerformer()).toBe(true)
  })

  it('fromTimestamp', () => {
    const d = new Date()
    const c = CharacterMetaValues.fromTimestamp(d)
    expect(c.hasTimestamp()).toBe(true)
    expect(c.timestamp).toBe(d)
  })

  it('has* methods return false when not set', () => {
    const c = new CharacterMetaValues()
    expect(c.hasSubject()).toBe(false)
    expect(c.hasResponsible()).toBe(false)
    expect(c.hasPerformer()).toBe(false)
    expect(c.hasTimestamp()).toBe(false)
  })
})

describe('Identifier', () => {
  it('sets id and optional type', () => {
    const id = new Identifier('abc', 'user')
    expect(id.id).toBe('abc')
    expect(id.type).toBe('user')
  })

  it('type is undefined when not provided', () => {
    const id = new Identifier('abc')
    expect(id.type).toBeUndefined()
  })
})

describe('CharacterMetaValues fluent chaining', () => {
  it('builds complete character set via chaining', () => {
    const now = new Date()
    const cmv = CharacterMetaValues.fromSubject(new Identifier('s1', 'user'))
      .withResponsible(new Identifier('r1', 'admin'))
      .withPerformer(new Identifier('p1', 'system'))
      .withTimestamp(now)

    expect(cmv.hasSubject()).toBe(true)
    expect(cmv.hasResponsible()).toBe(true)
    expect(cmv.hasPerformer()).toBe(true)
    expect(cmv.hasTimestamp()).toBe(true)
    expect(cmv.subject!.type).toBe('user')
    expect(cmv.responsible!.type).toBe('admin')
    expect(cmv.performer!.type).toBe('system')
    expect(cmv.timestamp).toBe(now)
  })

  it('withSubject on instance sets subject', () => {
    const cmv = new CharacterMetaValues()
      .withSubject(new Identifier('x', 'user'))

    expect(cmv.subject!.type).toBe('user')
    expect(cmv.subject!.id).toBe('x')
  })

  it('withResponsible on instance sets responsible', () => {
    const cmv = new CharacterMetaValues()
      .withResponsible(new Identifier('x', 'admin'))

    expect(cmv.responsible!.type).toBe('admin')
  })

  it('withPerformer on instance sets performer', () => {
    const cmv = new CharacterMetaValues()
      .withPerformer(new Identifier('x', 'sys'))

    expect(cmv.performer!.type).toBe('sys')
  })

  it('null/undefined timestamp', () => {
    const cmv = new CharacterMetaValues().withTimestamp(undefined)

    expect(cmv.hasTimestamp()).toBe(false)
    expect(cmv.timestamp).toBeUndefined()
  })
})
