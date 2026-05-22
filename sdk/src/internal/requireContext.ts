// Context guard helpers exposed to generated code.
// Full implementation previously in ui/internal/context.ts; moved here so
// generated code can import from a stable location without going through ui/.

export type PluginContext = 'attachmentRenderer' | 'action' | 'unknown';

export class PluginContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginContextError';
  }
}

let _context: PluginContext = 'unknown';

// One-shot promise that resolves when setContext is called with a real value.
// Resolves automatically after 5 s so non-plugin environments don't hang.
let _contextResolve: (() => void) | null = null;
const _contextPromise = new Promise<void>((resolve) => {
  _contextResolve = resolve;
  if (typeof setTimeout !== 'undefined') {
    const handle = setTimeout(resolve, 5000);
    if (handle && typeof (handle as unknown as { unref?: () => void }).unref === 'function') {
      (handle as unknown as { unref: () => void }).unref();
    }
  }
});

export function getContext(): PluginContext { return _context; }

export function setContext(ctx: PluginContext): void {
  _context = ctx;
  if (ctx !== 'unknown') {
    _contextResolve?.();
  }
}

export function whenContextResolved(): Promise<void> {
  if (_context !== 'unknown') return Promise.resolve();
  return _contextPromise;
}

export function detectContext(): PluginContext {
  if (typeof window === 'undefined') return 'unknown';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (window as any).__PASTY_PLUGIN_CONTEXT__;
  if (ctx?.mode === 'attachmentRenderer') return 'attachmentRenderer';
  if (ctx?.mode === 'action') return 'action';
  return 'unknown';
}

export function withContextGuard<A extends unknown[], R>(
  requiredContext: PluginContext,
  verb: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    await whenContextResolved();
    if (_context !== requiredContext) {
      throw new PluginContextError(
        `This verb is not available in the current plugin context (expected: ${requiredContext}, got: ${_context})`
      );
    }
    return verb(...args);
  };
}

export function withContextGuardSync<A extends unknown[], R>(
  requiredContext: PluginContext,
  verb: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    if (_context !== requiredContext) {
      throw new PluginContextError(
        `This verb is not available in the current plugin context (expected: ${requiredContext}, got: ${_context})`
      );
    }
    return verb(...args);
  };
}

/**
 * Set the active plugin context mode.
 * Called by the generated bootstrap code when the host broadcasts the context.
 */
export function setActivePluginContext(mode: string): void {
  const ctx: PluginContext =
    mode === 'action' ? 'action' :
    mode === 'attachmentRenderer' ? 'attachmentRenderer' :
    'unknown';
  setContext(ctx);
}

/**
 * Wrap a verb function so it only executes when the plugin is in the required
 * context. Throws PluginContextError otherwise.
 */
export function requireContext<A extends unknown[], R>(
  context: PluginContext,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return withContextGuard(context, fn);
}
