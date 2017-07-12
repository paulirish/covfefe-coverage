'use strict';

// Require('pretty-exceptions/source-native')
require('pretty-error').start();

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');
const js_protocol = require('devtools-protocol/json/js_protocol.json');

const launchChrome = () =>
  chromeLauncher.launch({
    chromeFlags: ['--disable-gpu', '--headless'],
    logLevel: 'error'
  });

/* global Common SDK Coverage Protocol */

launchChrome()
  .then(async chrome => {
    const cdp = await CDP({port: chrome.port});
    try {
      const {Page, Profiler} = cdp;

      installAgents(cdp);

      await Profiler.enable();
      await Page.enable();

      const model = new Coverage.CoverageModel(target);
      model.start();

      Page.navigate({url: 'https://paulirish.com/'});
      await Page.loadEventFired();

      await model.stop();
      const coverage = model.entries();

      console.log(coverage);
    } catch (err) {
      console.error(err);
    } finally {
      cdp.close();
      chrome.kill();
    }
  })
  .catch(err => console.error(err));

// Let's setup devtools env
global.Common = {};
global.SDK = {};
global.Coverage = {};
global.Protocol = {};

// Dependencies
require('chrome-devtools-frontend/front_end/common/Object.js');

require('chrome-devtools-frontend/front_end/protocol/InspectorBackend.js');
require('chrome-devtools-frontend/front_end/sdk/Target.js');
require('chrome-devtools-frontend/front_end/sdk/DebuggerModel.js');
require('chrome-devtools-frontend/front_end/coverage/CoverageModel.js');

require('chrome-devtools-frontend/front_end/sdk/CPUProfilerModel.js');
require('chrome-devtools-frontend/front_end/sdk/RuntimeModel.js');
require('chrome-devtools-frontend/front_end/sdk/CSSModel.js');

// Global.self = global;
global.Multimap = defineMultimap();
require('chrome-devtools-frontend/front_end/sdk/SourceMapManager.js'); // For debuggermodel

require('chrome-devtools-frontend/front_end/sdk/TargetManager.js');

Common.moduleSetting = function(module) {
  return {
    addChangeListener: _ => true,
    get: _ => false
  };
};

function createTarget() {
  // Const targetManager = {
  //   modelAdded: _ => true,
  //   addEventListener: _ => true
  // };
  const targetManager = SDK.targetManager;

  const id = 'main';
  const name = 'Main';
  const capabilitiesMask = SDK.Target.Capability.JS;
  const connectionFactory = function() {
    console.log('connected via CRI, folks');
  };
  const parentTarget = null;

  const target = new SDK.Target(
    targetManager,
    id,
    name,
    capabilitiesMask,
    connectionFactory,
    parentTarget
  );
  return target;
}

function installAgents(cdp) {
  const profilerAgent = installProxies(cdp.Profiler, 'Profiler');
  const debuggerAgent = installProxies(cdp.Debugger, 'Debugger');
  const runtimeAgent = installProxies(cdp.Runtime, 'Runtime');

  target.profilerAgent = _ => profilerAgent;
  target.debuggerAgent = _ => debuggerAgent;
  target.runtimeAgent = _ => runtimeAgent;

  target.registerProfilerDispatcher = _ => console.log('registering Profiler dispatcher');
  target.registerDebuggerDispatcher = _ => console.log('registering Debugger dispatcher');
  target.registerRuntimeDispatcher = _ => console.log('registering Runtime dispatcher');

  // Install a proxy over every CDP method in each domain passed in
  function installProxies(cdpDomain, domainStr) {
    for (const fnName of Object.keys(cdpDomain)) {
      const method = `${domainStr}.${fnName}`;
      if (typeof cdpDomain[fnName] !== 'function') continue;

      // Install a proxy over the original method
      const proxyHandler = {
        apply(target, thisArg, args) {
          // Note: `method` from parent scope is trapped.
          const opts = args.length ? unspreadArguments(method, args) : {};

          return target.call(thisArg, opts).then(res => {
            // DevTools expects both error handling and unwrapping the {result}
            if (res.error) {
              console.error('Protocol error', res.error);
              return Promise.reject(new Error(res.error));
            }
            return res.result;
          });
        }
      };
      cdpDomain[fnName] = new Proxy(cdpDomain[fnName], proxyHandler);
    }
    return cdpDomain;
  }
  // DevTools agents speak a language of ordered arguments, but CRI takes an object of named properties
  // Here we convert from the former to the latter
  function unspreadArguments(method, args) {
    const domainStr = method.split('.')[0];
    const commandStr = method.split('.')[1];

    const domain = js_protocol.domains.find(d => d.domain === domainStr);
    const command = domain.commands.find(c => c.name === commandStr);
    const opts = {};
    args.forEach((arg, i) => {
      opts[command.parameters[i].name] = arg;
    });
    return opts;
  }
}

const target = createTarget();

// From utilities
function defineMultimap() {
  /**
   * @constructor
   * @template K, V
   */
  let Multimap = function() {
    /** @type {!Map.<K, !Set.<!V>>} */
    this._map = new Map();
  };

  Multimap.prototype = {
    /**
     * @param {K} key
     * @param {V} value
     */
    set(key, value) {
      var set = this._map.get(key);
      if (!set) {
        set = new Set();
        this._map.set(key, set);
      }
      set.add(value);
    },

    /**
     * @param {K} key
     * @return {!Set.<!V>}
     */
    get(key) {
      var result = this._map.get(key);
      if (!result) result = new Set();
      return result;
    },

    /**
     * @param {K} key
     * @return {boolean}
     */
    has(key) {
      return this._map.has(key);
    },

    /**
     * @param {K} key
     * @param {V} value
     * @return {boolean}
     */
    hasValue(key, value) {
      var set = this._map.get(key);
      if (!set) return false;
      return set.has(value);
    },

    /**
     * @return {number}
     */
    get size() {
      return this._map.size;
    },

    /**
     * @param {K} key
     * @param {V} value
     * @return {boolean}
     */
    delete(key, value) {
      var values = this.get(key);
      var result = values.delete(value);
      if (!values.size) this._map.delete(key);
      return result;
    },

    /**
     * @param {K} key
     */
    deleteAll(key) {
      this._map.delete(key);
    },

    /**
     * @return {!Array.<K>}
     */
    keysArray() {
      return this._map.keysArray();
    },

    /**
     * @return {!Array.<!V>}
     */
    valuesArray() {
      var result = [];
      var keys = this.keysArray();
      for (var i = 0; i < keys.length; ++i) result.pushAll(this.get(keys[i]).valuesArray());
      return result;
    },

    clear() {
      this._map.clear();
    }
  };
  return Multimap;
}
