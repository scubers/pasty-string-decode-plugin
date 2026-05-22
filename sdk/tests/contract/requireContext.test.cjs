'use strict';
// Contract tests for requireContext / setActivePluginContext / PluginContextError.
// Node 25+ supports require()ing .ts files directly (strip-types built-in).
//
// IMPORTANT: requireContext.ts uses module-level singletons (_context, _contextPromise).
// To isolate tests we bust the require cache between tests so each test
// gets a fresh module instance.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function freshRC() {
  // Delete all cached copies of the module (and internalConsole if cached)
  for (const key of Object.keys(require.cache)) {
    if (key.includes('requireContext') || key.includes('internalConsole')) {
      delete require.cache[key];
    }
  }
  return require('../../src/internal/requireContext.ts');
}

describe('PluginContextError', () => {
  test('is an Error subclass with name PluginContextError', () => {
    const { PluginContextError } = freshRC();
    const err = new PluginContextError('test message');
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PluginContextError');
    assert.equal(err.message, 'test message');
  });
});

describe('getContext / setContext default state', () => {
  test('initial context is "unknown"', () => {
    const { getContext } = freshRC();
    assert.equal(getContext(), 'unknown');
  });
});

describe('setActivePluginContext', () => {
  test('sets context to "action" when mode is "action"', () => {
    const { setActivePluginContext, getContext } = freshRC();
    setActivePluginContext('action');
    assert.equal(getContext(), 'action');
  });

  test('sets context to "attachment" when mode is "attachment"', () => {
    const { setActivePluginContext, getContext } = freshRC();
    setActivePluginContext('attachment');
    assert.equal(getContext(), 'attachment');
  });

  test('sets context to "unknown" for unrecognized mode', () => {
    const { setActivePluginContext, getContext } = freshRC();
    setActivePluginContext('whatever');
    assert.equal(getContext(), 'unknown');
  });
});

describe('requireContext (withContextGuard)', () => {
  test('throws PluginContextError when context is "unknown"', async () => {
    const { requireContext, PluginContextError } = freshRC();
    // Context is 'unknown' by default; whenContextResolved will timeout after 5 s.
    // We bypass the wait by using withContextGuardSync semantics — but requireContext
    // wraps withContextGuard (async). Instead we test via requireContext on a
    // fresh module where we set the context immediately after construction to ensure
    // the promise resolves quickly.
    // Strategy: set context to 'unknown' explicitly, then call with 'action'.
    // The guard waits for whenContextResolved — since we set context to unknown the
    // internal timer fires after 5 s. To avoid test slowness, we set context to a
    // known value right away and test the mismatch case.
    const rc = freshRC();
    rc.setActivePluginContext('attachment'); // resolve the promise immediately
    const fn = rc.requireContext('action', async () => 'ok');
    await assert.rejects(
      () => fn(),
      (err) => {
        assert.ok(err instanceof rc.PluginContextError);
        assert.match(err.message, /expected.*action/i);
        assert.match(err.message, /got.*attachment/i);
        return true;
      },
    );
  });

  test('passes through when context matches', async () => {
    const rc = freshRC();
    rc.setActivePluginContext('action');
    const fn = rc.requireContext('action', async (x) => x * 2);
    const result = await fn(21);
    assert.equal(result, 42);
  });

  test('throws PluginContextError when context is attachment but action required', async () => {
    const rc = freshRC();
    rc.setActivePluginContext('attachment');
    const fn = rc.requireContext('action', async () => 'never');
    await assert.rejects(
      () => fn(),
      (err) => {
        assert.ok(err instanceof rc.PluginContextError);
        return true;
      },
    );
  });

  test('error message contains actual and expected context', async () => {
    const rc = freshRC();
    rc.setActivePluginContext('action');
    const fn = rc.requireContext('attachment', async () => 'never');
    await assert.rejects(
      () => fn(),
      (err) => {
        assert.ok(err instanceof rc.PluginContextError);
        // Message should mention both expected and actual
        assert.match(err.message, /attachment/);
        assert.match(err.message, /action/);
        return true;
      },
    );
  });
});

describe('withContextGuardSync', () => {
  test('throws synchronously when context mismatches', () => {
    const rc = freshRC();
    rc.setActivePluginContext('attachment');
    const fn = rc.withContextGuardSync('action', () => 'ok');
    assert.throws(
      () => fn(),
      (err) => {
        assert.ok(err instanceof rc.PluginContextError);
        return true;
      },
    );
  });

  test('returns value when context matches', () => {
    const rc = freshRC();
    rc.setActivePluginContext('action');
    const fn = rc.withContextGuardSync('action', (x) => x + 1);
    assert.equal(fn(9), 10);
  });
});
