'use strict';

// require('pretty-exceptions/source-native')
require('pretty-error').start();

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');

const launchChrome = () =>
  chromeLauncher.launch({
    chromeFlags: ['--disable-gpu', '--headless'],
    logLevel: 'error'
  });

/* global Common SDK Coverage Protocol */

launchChrome()
  .then(async chrome => {
    const protocol = await CDP({port: chrome.port});
    try {
      const {Page, Profiler} = protocol;

      installAgents(protocol);

      await Profiler.enable();
      await Page.enable();

      const model = new Coverage.CoverageModel(target);
      model.start();

      Page.navigate({url: 'https://paulirish.com/'});
      await Page.loadEventFired();

      const coverage = await model.stop();
      console.log(coverage);
    } catch (err) {
      console.error(err);
    } finally {
      protocol.close();
      chrome.kill();
    }
  })
  .catch(err => console.error(err));

// let's setup devtools env
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

// global.self = global;
global.Multimap = defineMultimap();
require('chrome-devtools-frontend/front_end/sdk/SourceMapManager.js'); // for debuggermodel

require('chrome-devtools-frontend/front_end/sdk/TargetManager.js');

Common.moduleSetting = function(module) {
  return {
    addChangeListener: _ => true,
    get: _ => false
  };
};

function createTarget() {
  // const targetManager = {
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

function installAgents(protocol) {
  target.profilerAgent = _ => protocol.Profiler;
  target.debuggerAgent = _ => protocol.Debugger;
  target.runtimeAgent = _ => protocol.Runtime;

  target.registerProfilerDispatcher = _ => console.log('registering Profiler dispatcher');
  target.registerDebuggerDispatcher = _ => console.log('registering Debugger dispatcher');
  target.registerRuntimeDispatcher = _ => console.log('registering Runtime dispatcher');
}

const target = createTarget();


// from utilities
function defineMultimap() {

  /**
   * @constructor
   * @template K, V
   */
  var Multimap = function() {
    /** @type {!Map.<K, !Set.<!V>>} */
    this._map = new Map();
  };

  Multimap.prototype = {
    /**
     * @param {K} key
     * @param {V} value
     */
    set: function(key, value) {
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
    get: function(key) {
      var result = this._map.get(key);
      if (!result)
        result = new Set();
      return result;
    },

    /**
     * @param {K} key
     * @return {boolean}
     */
    has: function(key) {
      return this._map.has(key);
    },

    /**
     * @param {K} key
     * @param {V} value
     * @return {boolean}
     */
    hasValue: function(key, value) {
      var set = this._map.get(key);
      if (!set)
        return false;
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
    delete: function(key, value) {
      var values = this.get(key);
      var result = values.delete(value);
      if (!values.size)
        this._map.delete(key);
      return result;
    },

    /**
     * @param {K} key
     */
    deleteAll: function(key) {
      this._map.delete(key);
    },

    /**
     * @return {!Array.<K>}
     */
    keysArray: function() {
      return this._map.keysArray();
    },

    /**
     * @return {!Array.<!V>}
     */
    valuesArray: function() {
      var result = [];
      var keys = this.keysArray();
      for (var i = 0; i < keys.length; ++i)
        result.pushAll(this.get(keys[i]).valuesArray());
      return result;
    },

    clear: function() {
      this._map.clear();
    }
  };
  return Multimap;
}