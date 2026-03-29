import { describe, it, expect } from 'vitest'
import {
  ProcessChatInstruction, ProcessChatInstructionInput, ProcessChatInstructionOutput,
  ChatInstruction, PeerColabAI, RequestOperationRequest, RequestOperationHandler,
  Result, OutOfContextOperation,
} from '../src/index.js'

describe('ProcessChatInstruction', () => {
  it('has correct operation id', () => {
    const op = new ProcessChatInstruction()
    expect(op.id).toBe('PeerColab.Instructions.ProcessChatInstruction')
  })

  it('has correct verb', () => {
    const op = new ProcessChatInstruction()
    expect(op.verb).toBe('PROCESS')
  })

  it('is a request type', () => {
    const op = new ProcessChatInstruction()
    expect(op.type).toBe('request')
  })

  it('requires tenant', () => {
    const op = new ProcessChatInstruction()
    expect(op.settings!.requiresTenant).toBe(true)
  })

  it('has empty path parameters', () => {
    const op = new ProcessChatInstruction()
    expect(op.pathParameters).toEqual([])
  })

  it('creates a handler via handle()', () => {
    const op = new ProcessChatInstruction()
    const handler = op.handle(async (input, ctx) => {
      return Result.ok<ProcessChatInstructionOutput>({
        message: 'test',
        operations: []
      })
    })
    expect(handler).toBeInstanceOf(RequestOperationHandler)
    expect(handler.operation).toBe(op)
  })
})

describe('PeerColabAI', () => {
  it('processChatInstructions creates a RequestOperationRequest', () => {
    const input: ProcessChatInstructionInput = {
      usageInstructions: 'Available operations: ...',
      currentStateSnapshot: '{}',
      items: [
        { type: 'message', role: 'user', content: 'Hello' }
      ]
    }
    const request = PeerColabAI.processChatInstructions(input)
    expect(request).toBeInstanceOf(RequestOperationRequest)
    expect(request.usageId).toBe('PeerColab.Instructions')
    expect(request.operation.id).toBe('PeerColab.Instructions.ProcessChatInstruction')
    expect(request.operation.verb).toBe('PROCESS')
    expect(request.input).toBe(input)
  })

  it('preserves all input fields', () => {
    const items: ChatInstruction[] = [
      { type: 'message', role: 'system', content: 'You are a helpful assistant' },
      { type: 'message', role: 'user', content: 'Create a resource called User' },
    ]
    const input: ProcessChatInstructionInput = {
      usageInstructions: 'Operation: CreateResource\nVerb: CREATE',
      currentStateSnapshot: '{"resources": []}',
      items,
    }
    const request = PeerColabAI.processChatInstructions(input)
    expect(request.input.usageInstructions).toBe(input.usageInstructions)
    expect(request.input.currentStateSnapshot).toBe(input.currentStateSnapshot)
    expect(request.input.items).toHaveLength(2)
    expect(request.input.items[0]!.role).toBe('system')
    expect(request.input.items[1]!.content).toBe('Create a resource called User')
  })
})

describe('ChatInstruction type', () => {
  it('supports all standard roles', () => {
    const roles = ['user', 'assistant', 'system', 'developer']
    for (const role of roles) {
      const msg: ChatInstruction = { type: 'message', role, content: 'test' }
      expect(msg.role).toBe(role)
      expect(msg.type).toBe('message')
    }
  })
})

describe('ProcessChatInstructionOutput type', () => {
  it('message is optional', () => {
    const output: ProcessChatInstructionOutput = {
      operations: []
    }
    expect(output.message).toBeUndefined()
    expect(output.operations).toEqual([])
  })

  it('supports operations with path parameters', () => {
    const output: ProcessChatInstructionOutput = {
      message: 'Created the resource',
      operations: [
        {
          usageId: 'TestUsage',
          operationId: 'TestApp.CreateResource',
          operationVerb: 'CREATE',
          operationType: 'request',
          requestJson: { name: 'User' },
          pathParameters: [{ name: 'SystemId', value: '123' }],
        }
      ]
    }
    expect(output.operations).toHaveLength(1)
    expect(output.operations[0]!.operationId).toBe('TestApp.CreateResource')
    expect(output.operations[0]!.pathParameters).toHaveLength(1)
  })
})
