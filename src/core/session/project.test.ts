import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findProjectConfig,
  PROJECT_CONFIG,
  readProjectExtensionId,
  writeProjectExtensionId,
} from './project'

const ID = 'abcdefghijklmnopabcdefghijklmnop'
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tabbrew-project-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('project config', () => {
  test('reads the id from .tabbrew.json in a parent directory', () => {
    writeFileSync(join(dir, PROJECT_CONFIG), JSON.stringify({ extensionId: ID }))
    const nested = join(dir, 'a', 'b')
    mkdirSync(nested, { recursive: true })
    expect(findProjectConfig(nested)).toBe(join(dir, PROJECT_CONFIG))
    expect(readProjectExtensionId(nested)).toBe(ID)
  })

  test('no file reads as null', () => {
    expect(readProjectExtensionId(dir)).toBeNull()
  })

  test('malformed JSON or a bad id reads as null', () => {
    writeFileSync(join(dir, PROJECT_CONFIG), '{not json')
    expect(readProjectExtensionId(dir)).toBeNull()
    writeFileSync(join(dir, PROJECT_CONFIG), JSON.stringify({ extensionId: 'nope' }))
    expect(readProjectExtensionId(dir)).toBeNull()
  })

  test('write keeps unknown keys and clear removes only the id', () => {
    writeFileSync(join(dir, PROJECT_CONFIG), JSON.stringify({ other: 1 }))
    writeProjectExtensionId(dir, ID)
    expect(JSON.parse(readFileSync(join(dir, PROJECT_CONFIG), 'utf8'))).toEqual({
      other: 1,
      extensionId: ID,
    })
    writeProjectExtensionId(dir, null)
    expect(JSON.parse(readFileSync(join(dir, PROJECT_CONFIG), 'utf8'))).toEqual({ other: 1 })
  })

  test('clearing the only key removes the file', () => {
    writeProjectExtensionId(dir, ID)
    writeProjectExtensionId(dir, null)
    expect(existsSync(join(dir, PROJECT_CONFIG))).toBe(false)
  })
})
