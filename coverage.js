'use strict';

const chromeLauncher = require('chrome-launcher');
const CDP = require('chrome-remote-interface');

const launchChrome = () =>
  chromeLauncher.launch({
    chromeFlags: ['--disable-gpu', '--headless']
  });

launchChrome()
  .then(async chrome => {
    const protocol = await CDP({port: chrome.port});
    try {
      const {Page, Profiler} = protocol;
      await Profiler.enable();
      await Page.enable();

      await Profiler.startPreciseCoverage();

      Page.navigate({url: 'https://paulirish.com/'});
      await Page.loadEventFired();

      const res = await Profiler.takePreciseCoverage();
      await Profiler.stopPreciseCoverage();

      const coverage = calculateCoverage(res);
      console.log(coverage);
    } catch (err) {
      console.error(err);
    } finally {
      protocol.close();
      chrome.kill();
    }
  })
  .catch(err => console.error(err));

// verbatim from https://github.com/ChromeDevTools/devtools-frontend/blob/master/front_end/coverage/CoverageModel.js
Coverage.CoverageModel = class extends SDK.SDKModel {
  /**
   * @param {!SDK.Target} target
   */
  constructor(target) {
    super(target);
    this._cpuProfilerModel = target.model(SDK.CPUProfilerModel);
    this._cssModel = target.model(SDK.CSSModel);
    this._debuggerModel = target.model(SDK.DebuggerModel);

    /** @type {!Map<string, !Coverage.URLCoverageInfo>} */
    this._coverageByURL = new Map();
    /** @type {!Map<!Common.ContentProvider, !Coverage.CoverageInfo>} */
    this._coverageByContentProvider = new Map();
  }

  /**
   * @return {boolean}
   */
  start() {
    if (this._cssModel) {
      // Note there's no JS coverage since JS won't ever return
      // coverage twice, even after it's restarted.
      this._clearCSS();
      this._cssModel.startCoverage();
    }
    if (this._cpuProfilerModel)
      this._cpuProfilerModel.startPreciseCoverage();
    return !!(this._cssModel || this._cpuProfilerModel);
  }

  /**
   * @return {!Promise<!Array<!Coverage.CoverageInfo>>}
   */
  stop() {
    var pollPromise = this.poll();
    if (this._cpuProfilerModel)
      this._cpuProfilerModel.stopPreciseCoverage();
    if (this._cssModel)
      this._cssModel.stopCoverage();
    return pollPromise;
  }

  /**
   * @return {!Promise<!Array<!Coverage.CoverageInfo>>}
   */
  async poll() {
    var updates = await Promise.all([this._takeCSSCoverage(), this._takeJSCoverage()]);
    return updates[0].concat(updates[1]);
  }

  /**
   * @return {!Array<!Coverage.URLCoverageInfo>}
   */
  entries() {
    return Array.from(this._coverageByURL.values());
  }

  /**
   * @param {!Common.ContentProvider} contentProvider
   * @param {number} startOffset
   * @param {number} endOffset
   * @return {boolean|undefined}
   */
  usageForRange(contentProvider, startOffset, endOffset) {
    var coverageInfo = this._coverageByContentProvider.get(contentProvider);
    return coverageInfo && coverageInfo.usageForRange(startOffset, endOffset);
  }

  _clearCSS() {
    for (var entry of this._coverageByContentProvider.values()) {
      if (entry.type() !== Coverage.CoverageType.CSS)
        continue;
      var contentProvider = /** @type {!SDK.CSSStyleSheetHeader} */ (entry.contentProvider());
      this._coverageByContentProvider.delete(contentProvider);
      var key = `${contentProvider.startLine}:${contentProvider.startColumn}`;
      var urlEntry = this._coverageByURL.get(entry.url());
      if (!urlEntry || !urlEntry._coverageInfoByLocation.delete(key))
        continue;
      urlEntry._size -= entry._size;
      urlEntry._usedSize -= entry._usedSize;
      if (!urlEntry._coverageInfoByLocation.size)
        this._coverageByURL.delete(entry.url());
    }
  }

  /**
   * @return {!Promise<!Array<!Coverage.CoverageInfo>>}
   */
  async _takeJSCoverage() {
    if (!this._cpuProfilerModel)
      return [];
    var rawCoverageData = await this._cpuProfilerModel.takePreciseCoverage();
    return this._processJSCoverage(rawCoverageData);
  }

  /**
   * @param {!Array<!Protocol.Profiler.ScriptCoverage>} scriptsCoverage
   * @return {!Array<!Coverage.CoverageInfo>}
   */
  _processJSCoverage(scriptsCoverage) {
    var updatedEntries = [];
    for (var entry of scriptsCoverage) {
      var script = this._debuggerModel.scriptForId(entry.scriptId);
      if (!script)
        continue;
      var ranges = [];
      for (var func of entry.functions) {
        for (var range of func.ranges)
          ranges.push(range);
      }
      var entry = this._addCoverage(script, script.contentLength, script.lineOffset, script.columnOffset, ranges);
      if (entry)
        updatedEntries.push(entry);
    }
    return updatedEntries;
  }

  /**
   * @return {!Promise<!Array<!Coverage.CoverageInfo>>}
   */
  async _takeCSSCoverage() {
    if (!this._cssModel)
      return [];
    var rawCoverageData = await this._cssModel.takeCoverageDelta();
    return this._processCSSCoverage(rawCoverageData);
  }

  /**
   * @param {!Array<!Protocol.CSS.RuleUsage>} ruleUsageList
   * @return {!Array<!Coverage.CoverageInfo>}
   */
  _processCSSCoverage(ruleUsageList) {
    var updatedEntries = [];
    /** @type {!Map<!SDK.CSSStyleSheetHeader, !Array<!Coverage.RangeUseCount>>} */
    var rulesByStyleSheet = new Map();
    for (var rule of ruleUsageList) {
      var styleSheetHeader = this._cssModel.styleSheetHeaderForId(rule.styleSheetId);
      if (!styleSheetHeader)
        continue;
      var ranges = rulesByStyleSheet.get(styleSheetHeader);
      if (!ranges) {
        ranges = [];
        rulesByStyleSheet.set(styleSheetHeader, ranges);
      }
      ranges.push({startOffset: rule.startOffset, endOffset: rule.endOffset, count: Number(rule.used)});
    }
    for (var entry of rulesByStyleSheet) {
      var styleSheetHeader = /** @type {!SDK.CSSStyleSheetHeader} */ (entry[0]);
      var ranges = /** @type {!Array<!Coverage.RangeUseCount>} */ (entry[1]);
      var entry = this._addCoverage(
          styleSheetHeader, styleSheetHeader.contentLength, styleSheetHeader.startLine, styleSheetHeader.startColumn,
          ranges);
      if (entry)
        updatedEntries.push(entry);
    }
    return updatedEntries;
  }

  /**
   * @param {!Array<!Coverage.RangeUseCount>} ranges
   * @return {!Array<!Coverage.CoverageSegment>}
   */
  static _convertToDisjointSegments(ranges) {
    ranges.sort((a, b) => a.startOffset - b.startOffset);

    var result = [];
    var stack = [];
    for (var entry of ranges) {
      var top = stack.peekLast();
      while (top && top.endOffset <= entry.startOffset) {
        append(top.endOffset, top.count);
        stack.pop();
        top = stack.peekLast();
      }
      append(entry.startOffset, top ? top.count : undefined);
      stack.push(entry);
    }

    while (stack.length) {
      var top = stack.pop();
      append(top.endOffset, top.count);
    }

    /**
     * @param {number} end
     * @param {number} count
     */
    function append(end, count) {
      var last = result.peekLast();
      if (last) {
        if (last.end === end)
          return;
        if (last.count === count) {
          last.end = end;
          return;
        }
      }
      result.push({end: end, count: count});
    }

    return result;
  }

  /**
   * @param {!Common.ContentProvider} contentProvider
   * @param {number} contentLength
   * @param {number} startLine
   * @param {number} startColumn
   * @param {!Array<!Coverage.RangeUseCount>} ranges
   * @return {?Coverage.CoverageInfo}
   */
  _addCoverage(contentProvider, contentLength, startLine, startColumn, ranges) {
    var url = contentProvider.contentURL();
    if (!url)
      return null;
    var urlCoverage = this._coverageByURL.get(url);
    if (!urlCoverage) {
      urlCoverage = new Coverage.URLCoverageInfo(url);
      this._coverageByURL.set(url, urlCoverage);
    }
    var coverageInfo = urlCoverage._ensureEntry(contentProvider, contentLength, startLine, startColumn);
    this._coverageByContentProvider.set(contentProvider, coverageInfo);
    var segments = Coverage.CoverageModel._convertToDisjointSegments(ranges);
    if (segments.length && segments.peekLast().end < contentLength)
      segments.push({end: contentLength});
    var oldUsedSize = coverageInfo._usedSize;
    coverageInfo.mergeCoverage(segments);
    if (coverageInfo._usedSize === oldUsedSize)
      return null;
    urlCoverage._usedSize += coverageInfo._usedSize - oldUsedSize;
    return coverageInfo;
  }
};