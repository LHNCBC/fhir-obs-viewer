/*
 * Vitest setup for Angular unit tests, including the compatibility shims that
 * let the existing Jasmine-style specs run under the Vitest runner.
 */
import {
  expect,
  vi
} from 'vitest';

type LifecyclePhase = 'beforeAll' | 'perSpec';
type SpyImplementation = (this: unknown, ...args: unknown[]) => unknown;
type JasmineCompatibleSpy = ReturnType<typeof vi.fn> & {
  __jasmineOriginal?: SpyImplementation;
  __jasmineSpy?: boolean;
  and: JasmineSpyStrategy;
  calls: JasmineSpyCalls;
  withArgs: (...expectedArgs: unknown[]) => { and: JasmineSpyStrategy };
};
type MatcherContext = {
  equals?: (actual: unknown, expected: unknown) => boolean;
};
type VitestFunction = Function & {
  each?: Function;
  failing?: Function;
  only?: Function;
  skip?: Function;
  todo?: Function;
};

interface ArgumentStrategy {
  expectedArgs: unknown[];
  implementation: SpyImplementation;
}

interface JasmineSpyCalls {
  allArgs: () => unknown[][];
  argsFor: (index: number) => unknown[];
  count: () => number;
  reset: () => void;
}

interface JasmineSpyStrategy {
  callFake: (implementation: SpyImplementation) => JasmineCompatibleSpy;
  callThrough: () => JasmineCompatibleSpy;
  rejectWith: (value?: unknown) => JasmineCompatibleSpy;
  resolveTo: (value?: unknown) => JasmineCompatibleSpy;
  returnValue: (value: unknown) => JasmineCompatibleSpy;
  stub: () => JasmineCompatibleSpy;
}

const globalScope = globalThis as any;
const perSpecSpies = new Set<JasmineCompatibleSpy>();
let lifecyclePhase: LifecyclePhase = 'perSpec';


/**
 * Runs a lifecycle callback while tracking where spies are created.
 * @param phase - lifecycle phase used for spy restoration decisions.
 * @param callback - callback passed to Vitest.
 * @returns wrapped lifecycle callback.
 */
function wrapLifecycleCallback(
  phase: LifecyclePhase,
  callback: Function
): Function {
  return function(this: unknown) {
    const previousPhase = lifecyclePhase;
    lifecyclePhase = phase;
    try {
      const result = callback.apply(this, arguments as any);
      if (result && typeof result.finally === 'function') {
        return result.finally(() => {
          lifecyclePhase = previousPhase;
        });
      }
      lifecyclePhase = previousPhase;
      return result;
    } catch (error) {
      lifecyclePhase = previousPhase;
      throw error;
    }
  };
}


/**
 * Copies commonly used Vitest function helpers to a patched wrapper.
 * @param source - original Vitest DSL function.
 * @param target - patched Vitest DSL function.
 * @param callbackWrapper - wrapper to apply to callback arguments.
 */
function copyVitestFunctionHelpers(
  source: VitestFunction,
  target: VitestFunction,
  callbackWrapper: (callback: unknown) => unknown
): void {
  ['only', 'skip'].forEach((helperName) => {
    const helper = source[helperName];
    if (typeof helper === 'function') {
      target[helperName] = createPatchedVitestFunction(
        helper as VitestFunction,
        callbackWrapper,
        false
      );
    }
  });

  ['failing', 'todo'].forEach((helperName) => {
    if (helperName in source) {
      target[helperName] = source[helperName];
    }
  });

  if (typeof source.each === 'function') {
    target.each = function(...tableArgs: unknown[]) {
      return createPatchedVitestFunction(
        source.each.apply(this, tableArgs),
        callbackWrapper
      );
    };
  }
}


/**
 * Preserves callback arity so Vitest can detect done-callback specs.
 * @param wrapper - callback wrapper.
 * @param callback - original callback.
 */
function preserveFunctionLength(wrapper: Function, callback: Function): void {
  try {
    Object.defineProperty(wrapper, 'length', {
      configurable: true,
      value: callback.length
    });
  } catch {
    // Function length preservation is best-effort.
  }
}


/**
 * Creates a patched Vitest DSL function.
 * @param originalFunction - original global function such as it or beforeEach.
 * @param callbackWrapper - wrapper to apply to callback arguments.
 * @param copyHelpers - true when helper functions should also be patched.
 * @returns patched function.
 */
function createPatchedVitestFunction(
  originalFunction: VitestFunction,
  callbackWrapper: (callback: unknown) => unknown,
  copyHelpers = true
): VitestFunction {
  const patchedFunction = function(...args: unknown[]) {
    const callbackIndex = typeof args[0] === 'function' ? 0 : 1;
    args[callbackIndex] = callbackWrapper(args[callbackIndex]);
    return originalFunction.apply(this, args);
  } as VitestFunction;

  if (copyHelpers) {
    copyVitestFunctionHelpers(
      originalFunction,
      patchedFunction,
      callbackWrapper
    );
  }
  return patchedFunction;
}


/**
 * Creates a callback wrapper that runs inside the supplied zone.
 * @param zone - Zone instance used to run the callback.
 * @param callbackWrapper - additional callback wrapper to apply first.
 * @returns callback wrapper.
 */
function createZoneCallbackWrapper(
  zone: any,
  callbackWrapper: (callback: Function) => Function
): (callback: unknown) => unknown {
  return (callback: unknown) => {
    if (typeof callback !== 'function') {
      return callback;
    }

    const wrappedCallback = callbackWrapper(callback);
    if (callback.length > 0) {
      return function(this: unknown) {
        return new Promise<void>((resolve, reject) => {
          /**
           * Resolves or rejects a promise for Jasmine-style done callbacks.
           * @param error - optional error passed to done.
           */
          function done(error?: unknown): void {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          }

          try {
            const result = zone.run(wrappedCallback, this, [done]);
            if (result && typeof result.catch === 'function') {
              result.catch(reject);
            }
          } catch (error) {
            reject(error);
          }
        });
      };
    }

    const zoneCallback = function(this: unknown) {
      return zone.run(wrappedCallback, this, arguments as any);
    };
    preserveFunctionLength(zoneCallback, callback);
    return zoneCallback;
  };
}


/**
 * Installs lifecycle and test wrappers before spec files register callbacks.
 */
function installLifecycleWrappers(): void {
  const ZoneCtor = globalScope.Zone;
  const ProxyZoneSpec = ZoneCtor?.ProxyZoneSpec;
  const SyncTestZoneSpec = ZoneCtor?.SyncTestZoneSpec;
  const proxyZone = ProxyZoneSpec ?
    ZoneCtor.current.fork(new ProxyZoneSpec()) :
    null;
  const syncZone = SyncTestZoneSpec ?
    ZoneCtor.current.fork(new SyncTestZoneSpec('vitest.describe')) :
    null;
  const fallbackZone = {
    run(callback: Function, applyThis: unknown, applyArgs: IArguments) {
      return callback.apply(applyThis, applyArgs as any);
    }
  };
  const perSpecWrapper = createZoneCallbackWrapper(
    proxyZone || ZoneCtor?.current || fallbackZone,
    (callback) => wrapLifecycleCallback('perSpec', callback) as Function
  );
  const beforeAllWrapper = createZoneCallbackWrapper(
    proxyZone || ZoneCtor?.current || fallbackZone,
    (callback) => wrapLifecycleCallback('beforeAll', callback) as Function
  );
  const describeWrapper = syncZone ?
    createZoneCallbackWrapper(syncZone, (callback) => callback) :
    (callback: unknown) => callback;

  globalScope.beforeAll = createPatchedVitestFunction(
    globalScope.beforeAll,
    beforeAllWrapper
  );
  globalScope.beforeEach = createPatchedVitestFunction(
    globalScope.beforeEach,
    perSpecWrapper
  );
  globalScope.afterAll = createPatchedVitestFunction(
    globalScope.afterAll,
    perSpecWrapper
  );
  globalScope.afterEach = createPatchedVitestFunction(
    globalScope.afterEach,
    perSpecWrapper
  );
  globalScope.it = createPatchedVitestFunction(
    globalScope.it,
    perSpecWrapper
  );
  globalScope.test = createPatchedVitestFunction(
    globalScope.test,
    perSpecWrapper
  );
  globalScope.describe = createPatchedVitestFunction(
    globalScope.describe,
    describeWrapper
  );
}


/**
 * Checks whether a value is an asymmetric matcher.
 * @param value - candidate matcher.
 * @returns true when the value can match actual values itself.
 */
function isAsymmetricMatcher(
  value: unknown
): value is { asymmetricMatch: (actual: unknown) => boolean } {
  return !!value &&
    typeof value === 'object' &&
    'asymmetricMatch' in value &&
    typeof (value as any).asymmetricMatch === 'function';
}


/**
 * Compares values using Vitest equality plus Jasmine-style asymmetric matchers.
 * @param expected - expected value or asymmetric matcher.
 * @param actual - actual value received by the spy.
 * @param equals - optional matcher equality function from Vitest.
 * @returns true when the values match.
 */
function valueMatches(
  expected: unknown,
  actual: unknown,
  equals?: MatcherContext['equals']
): boolean {
  if (isAsymmetricMatcher(expected)) {
    return expected.asymmetricMatch(actual);
  }
  if (equals) {
    return equals(actual, expected);
  }
  try {
    expect(actual).toEqual(expected);
    return true;
  } catch {
    return false;
  }
}


/**
 * Compares a complete spy argument list.
 * @param expectedArgs - expected values or asymmetric matchers.
 * @param actualArgs - actual spy call arguments.
 * @param equals - optional matcher equality function from Vitest.
 * @returns true when the argument lists match.
 */
function argsMatch(
  expectedArgs: unknown[],
  actualArgs: unknown[],
  equals?: MatcherContext['equals']
): boolean {
  return expectedArgs.length === actualArgs.length &&
    expectedArgs.every((expectedArg, index) =>
      valueMatches(expectedArg, actualArgs[index], equals)
    );
}


/**
 * Returns a function that does nothing and returns undefined.
 * @returns no-op spy implementation.
 */
function stubImplementation(): undefined {
  return undefined;
}


/**
 * Decorates a Vitest mock with the Jasmine spy strategy API used in tests.
 * @param spy - Vitest mock or spy to decorate.
 * @param originalImplementation - original implementation for callThrough.
 * @returns Jasmine-compatible spy.
 */
function decorateSpy(
  spy: ReturnType<typeof vi.fn>,
  originalImplementation?: SpyImplementation
): JasmineCompatibleSpy {
  const jasmineSpy = spy as JasmineCompatibleSpy;
  let defaultImplementation: SpyImplementation = stubImplementation;
  const argumentStrategies: ArgumentStrategy[] = [];

  /**
   * Routes spy calls to withArgs strategies or the default implementation.
   * @param args - arguments received by the spy.
   * @returns implementation result.
   */
  function dispatch(this: unknown, ...args: unknown[]): unknown {
    const strategy = argumentStrategies.find((candidate) =>
      argsMatch(candidate.expectedArgs, args)
    );
    return (strategy?.implementation || defaultImplementation).apply(
      this,
      args
    );
  }

  /**
   * Creates a Jasmine-style strategy around a mutable implementation setter.
   * @param setImplementation - updates the implementation for this strategy.
   * @returns Jasmine-compatible spy strategy.
   */
  function createStrategy(
    setImplementation: (implementation: SpyImplementation) => void
  ): JasmineSpyStrategy {
    return {
      callFake(implementation: SpyImplementation): JasmineCompatibleSpy {
        setImplementation(implementation);
        return jasmineSpy;
      },
      callThrough(): JasmineCompatibleSpy {
        setImplementation(function(this: unknown, ...args: unknown[]) {
          return originalImplementation?.apply(this, args);
        });
        return jasmineSpy;
      },
      rejectWith(value?: unknown): JasmineCompatibleSpy {
        setImplementation(() => Promise.reject(value));
        return jasmineSpy;
      },
      resolveTo(value?: unknown): JasmineCompatibleSpy {
        setImplementation(() => Promise.resolve(value));
        return jasmineSpy;
      },
      returnValue(value: unknown): JasmineCompatibleSpy {
        setImplementation(() => value);
        return jasmineSpy;
      },
      stub(): JasmineCompatibleSpy {
        setImplementation(stubImplementation);
        return jasmineSpy;
      }
    };
  }

  jasmineSpy.__jasmineSpy = true;
  jasmineSpy.__jasmineOriginal = originalImplementation;
  jasmineSpy.and = createStrategy((implementation) => {
    defaultImplementation = implementation;
  });
  jasmineSpy.calls = {
    allArgs(): unknown[][] {
      return jasmineSpy.mock.calls;
    },
    argsFor(index: number): unknown[] {
      return jasmineSpy.mock.calls[index];
    },
    count(): number {
      return jasmineSpy.mock.calls.length;
    },
    reset(): void {
      jasmineSpy.mockClear();
    }
  };
  jasmineSpy.withArgs = (...expectedArgs: unknown[]) => {
    const strategy: ArgumentStrategy = {
      expectedArgs,
      implementation: stubImplementation
    };
    argumentStrategies.push(strategy);
    return {
      and: createStrategy((implementation) => {
        strategy.implementation = implementation;
      })
    };
  };

  jasmineSpy.mockImplementation(dispatch);
  return jasmineSpy;
}


/**
 * Checks whether a function was already decorated as a Jasmine-compatible spy.
 * @param value - candidate function.
 * @returns true when the value is already a compatible spy.
 */
function isJasmineCompatibleSpy(
  value: unknown
): value is JasmineCompatibleSpy {
  return typeof value === 'function' && !!(value as any).__jasmineSpy;
}


/**
 * Finds a property descriptor on an object or its prototypes.
 * @param target - object to inspect.
 * @param propertyName - property name to find.
 * @returns matching property descriptor when one exists.
 */
function findPropertyDescriptor(
  target: any,
  propertyName: PropertyKey
): PropertyDescriptor | undefined {
  let current = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, propertyName);
    if (descriptor) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}


/**
 * Registers a spy for restoration after the current spec when needed.
 * @param spy - compatible spy to track.
 * @returns the same spy.
 */
function registerSpy(spy: JasmineCompatibleSpy): JasmineCompatibleSpy {
  if (lifecyclePhase !== 'beforeAll') {
    perSpecSpies.add(spy);
  }
  return spy;
}


/**
 * Creates a Jasmine-compatible function spy.
 * @param name - optional spy name.
 * @returns compatible spy.
 */
function createSpy(name?: string): JasmineCompatibleSpy {
  const spy = decorateSpy(vi.fn(), undefined);
  if (name) {
    spy.mockName(name);
  }
  return spy;
}


/**
 * Creates an object whose methods are Jasmine-compatible spies.
 * @param baseName - object name, retained for Jasmine API compatibility.
 * @param methodNames - method names to create as spies.
 * @param properties - optional properties to copy onto the object.
 * @returns spy object.
 */
function createSpyObj(
  baseName: string,
  methodNames: string[],
  properties?: Record<string, unknown>
): Record<string, unknown> {
  const spyObject: Record<string, unknown> = { ...(properties || {}) };
  methodNames.forEach((methodName) => {
    spyObject[methodName] = createSpy(`${baseName}.${methodName}`);
  });
  return spyObject;
}


/**
 * Replaces an object method with a Jasmine-compatible spy.
 * @param target - object that owns the method.
 * @param methodName - method to replace.
 * @returns compatible spy.
 */
function spyOnCompat(
  target: any,
  methodName: string
): JasmineCompatibleSpy {
  if (isJasmineCompatibleSpy(target[methodName])) {
    return registerSpy(target[methodName]);
  }

  const originalImplementation = target[methodName] as SpyImplementation;
  const spy = decorateSpy(
    vi.spyOn(target, methodName) as unknown as ReturnType<typeof vi.fn>,
    originalImplementation
  );
  return registerSpy(spy);
}


/**
 * Replaces an object property accessor with a Jasmine-compatible spy.
 * @param target - object that owns the property.
 * @param propertyName - property to replace.
 * @param accessType - accessor type to replace.
 * @returns compatible accessor spy.
 */
function spyOnPropertyCompat(
  target: any,
  propertyName: string,
  accessType: 'get' | 'set' = 'get'
): JasmineCompatibleSpy {
  const descriptor = findPropertyDescriptor(target, propertyName);
  const originalImplementation = descriptor?.[accessType] as
    SpyImplementation | undefined;
  const typedSpyOn = vi.spyOn as any;
  const spy = decorateSpy(
    typedSpyOn(target, propertyName, accessType) as
      unknown as ReturnType<typeof vi.fn>,
    originalImplementation
  );
  return registerSpy(spy);
}


/**
 * Fails the current test immediately.
 * @param message - optional failure message.
 */
function failCompat(message?: string): never {
  throw new Error(message || 'Failed');
}


/**
 * Formats a value for custom matcher failure messages.
 * @param value - value to format.
 * @returns readable value representation.
 */
function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}


/**
 * Installs Jasmine-style globals used by the existing specs.
 */
function installJasmineGlobals(): void {
  globalScope.spyOn = spyOnCompat;
  globalScope.spyOnProperty = spyOnPropertyCompat;
  globalScope.fail = failCompat;
  globalScope.jasmine = {
    any: (expectedType: unknown) => expect.any(expectedType as any),
    arrayContaining: (sample: unknown[]) => expect.arrayContaining(sample),
    createSpy,
    createSpyObj,
    objectContaining: (sample: object) => expect.objectContaining(sample),
    stringMatching: (sample: string | RegExp) => expect.stringMatching(sample)
  };
}


/**
 * Installs Jasmine matchers that are not available as Vitest matchers.
 */
function installJasmineMatchers(): void {
  expect.extend({
    toBeFalse(received: unknown) {
      const pass = received === false;
      return {
        pass,
        message: () => `expected ${formatValue(received)} to be false`
      };
    },
    toBeTrue(received: unknown) {
      const pass = received === true;
      return {
        pass,
        message: () => `expected ${formatValue(received)} to be true`
      };
    },
    toContain(
      this: MatcherContext,
      received: string | unknown[] | { includes?: Function },
      expected: unknown
    ) {
      let pass = false;
      if (typeof received === 'string' && typeof expected === 'string') {
        pass = received.includes(expected);
      } else if (Array.isArray(received)) {
        pass = received.some((item) =>
          valueMatches(expected, item, this.equals)
        );
      } else if (received?.includes) {
        pass = (received as any).includes(expected);
      }
      return {
        pass,
        message: () =>
          `expected ${formatValue(received)} to contain ` +
          `${formatValue(expected)}`
      };
    },
    toHaveBeenCalledOnceWith(
      this: MatcherContext,
      received: { mock?: { calls: unknown[][] } },
      ...expectedArgs: unknown[]
    ) {
      const calls = received?.mock?.calls || [];
      const pass = calls.length === 1 &&
        argsMatch(expectedArgs, calls[0], this.equals);
      return {
        pass,
        message: () =>
          `expected spy to be called once with ${formatValue(expectedArgs)}` +
          ` but received ${calls.length} call(s)`
      };
    }
  });
}


/**
 * Gets a Node built-in module without asking the browser build to bundle it.
 * @param moduleName - built-in module name.
 * @returns Node built-in module.
 */
function getNodeBuiltinModule(moduleName: string): any {
  const getBuiltinModule = globalScope.process?.getBuiltinModule;
  if (!getBuiltinModule) {
    throw new Error('Node built-in module access is not available.');
  }
  return getBuiltinModule(moduleName);
}


/**
 * Extracts a relative app asset path from a fetch input.
 * @param input - fetch input to normalize.
 * @returns relative asset path, if the input points at one.
 */
function getRelativeAssetPath(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') {
    if (/^[a-z][a-z\d+\-.]*:/i.test(input)) {
      const url = new URL(input);
      return url.pathname.replace(/^\//, '');
    }
    return input.replace(/^\//, '');
  }
  if (input instanceof URL) {
    return input.pathname.replace(/^\//, '');
  }
  return null;
}


/**
 * Checks whether a relative path is served from source test assets.
 * @param relativePath - normalized relative path.
 * @returns true when the path can be served from the workspace.
 */
function isSourceTestAsset(relativePath: string): boolean {
  return relativePath === 'conf/settings.json5' ||
    relativePath.startsWith('conf/csv/');
}


/**
 * Reads a source test asset from the workspace.
 * @param relativePath - normalized relative path.
 * @returns file contents.
 */
async function readSourceTestAsset(relativePath: string): Promise<string> {
  const fs = getNodeBuiltinModule('fs');
  const path = getNodeBuiltinModule('path');
  const workspaceRoot = globalScope.process?.cwd?.() || '.';
  return fs.promises.readFile(
    path.resolve(workspaceRoot, 'src', relativePath),
    'utf8'
  );
}


/**
 * Creates a fetch Response for a text asset.
 * @param text - response body.
 * @param relativePath - source asset path.
 * @returns fetch response.
 */
function createTextResponse(text: string, relativePath: string): Response {
  const contentType = relativePath.endsWith('.csv') ?
    'text/csv' :
    'application/json5';
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': `${contentType}; charset=utf-8`
    }
  });
}


/**
 * Normalizes relative fetch URLs for the jsdom-based Vitest environment.
 */
function installFetchWrapper(): void {
  const nativeFetch = globalScope.fetch?.bind(globalScope);
  if (!nativeFetch) {
    return;
  }

  globalScope.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
    const relativePath = getRelativeAssetPath(input);
    if (relativePath && isSourceTestAsset(relativePath)) {
      return readSourceTestAsset(relativePath)
        .then((text) => createTextResponse(text, relativePath));
    }
    if (typeof input === 'string' && !/^[a-z][a-z\d+\-.]*:/i.test(input)) {
      const baseUrl = globalScope.location?.href || 'http://localhost/';
      return nativeFetch(new URL(input, baseUrl).href, init);
    }
    return nativeFetch(input, init);
  };
}


/**
 * Installs DOM API shims missing from jsdom.
 */
function installDomApiShims(): void {
  const htmlElementPrototype = globalScope.HTMLElement?.prototype;
  if (htmlElementPrototype && !htmlElementPrototype.scrollTo) {
    htmlElementPrototype.scrollTo = function(): void {};
  }
}


/**
 * Clears call history and restores per-spec spies after each test.
 */
function installSpyCleanup(): void {
  globalScope.afterEach(() => {
    vi.clearAllMocks();
    perSpecSpies.forEach((spy) => spy.mockRestore?.());
    perSpecSpies.clear();
  });
}

installLifecycleWrappers();
installJasmineGlobals();
installJasmineMatchers();
installFetchWrapper();
installDomApiShims();
installSpyCleanup();
