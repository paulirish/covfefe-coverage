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

// `calculateCoverage` is roughly stolen from https://github.com/joelgriffith/navalia/blob/master/src/Chrome.ts
// Haven't looked closely but handling these offsets is hard, so I'm dubious the below is correct

// Here is the DevTools' equivalent: https://github.com/ChromeDevTools/devtools-frontend/blob/master/front_end/coverage/CoverageModel.js
// see _processJSCoverage()
function calculateCoverage(res) {
  const src = 'https://www.youtube.com/yts/jsbin/www-embed-player-vflOvovMJ/www-embed-player.js';
  const scriptCoverage = res.result.find(script => script.url === src);

  if (!scriptCoverage) {
    console.log(`:coverage() > ${src} not found on the page.`);
    return new Error(`Couldn't locat script ${src} on the page.`);
  }

  if (scriptCoverage && scriptCoverage.functions && scriptCoverage.functions.length) {
    const coverageData = scriptCoverage.functions.reduce(
      (fnAccum, coverageStats) => {
        const functionStats = coverageStats.ranges.reduce(
          (rangeAccum, range) => {
            return {
              total: range.endOffset > rangeAccum.total ? range.endOffset : rangeAccum.total,
              unused:
                rangeAccum.unused + (range.count === 0 ? range.endOffset - range.startOffset : 0)
            };
          },
          {
            total: 0,
            unused: 0
          }
        );

        return {
          total: functionStats.total > fnAccum.total ? functionStats.total : fnAccum.total,
          unused: fnAccum.unused + functionStats.unused
        };
      },
      {
        total: 0,
        unused: 0
      }
    );

    return Object.assign(coverageData, {
      percentUnused: coverageData.unused / coverageData.total
    });
  }
  return Error('unexpected');
}
