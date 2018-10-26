import { resolve, dirname, relative } from 'path';
import { writeFileSync } from 'fs';
import { inspect } from 'util';

import mkdirp from 'mkdirp';
import xmlBuilder from 'xmlbuilder';

export function setupJunitReportGeneration(runner, options = {}) {
  const {
    reportName = 'Unnamed Mocha Tests',
    rootDirectory = dirname(require.resolve('../../../package.json')),
  } = options;

  const stats = {};
  const results = [];

  const getDuration = (node) => (
    node.startTime && node.endTime
      ? ((node.endTime - node.startTime) / 1000).toFixed(3)
      : null
  );

  const findAllTests = (suite) => (
    suite.suites.reduce((acc, suite) => acc.concat(findAllTests(suite)), suite.tests)
  );

  const setStartTime = (node) => {
    node.startTime = Date.now();
  };

  const setEndTime = node => {
    node.endTime = Date.now();
  };

  const getFullTitle = node => {
    const parentTitle = node.parent && getFullTitle(node.parent);
    return parentTitle ? `${parentTitle} ${node.title}` : node.title;
  };

  const getPath = node => {
    if (node.file) {
      return relative(rootDirectory, node.file);
    }

    if (node.parent) {
      return getPath(node.parent);
    }

    return 'unknown';
  };

  runner.on('start', () => setStartTime(stats));
  runner.on('suite', setStartTime);
  runner.on('hook', setStartTime);
  runner.on('hook end', setEndTime);
  runner.on('test', setStartTime);
  runner.on('pass', (node) => results.push({ node }));
  runner.on('pass', setEndTime);
  runner.on('fail', (node, error) => results.push({ failed: true, error, node }));
  runner.on('fail', setEndTime);
  runner.on('suite end', () => setEndTime(stats));

  runner.on('end', () => {
    // crawl the test graph to collect all defined tests
    const allTests = findAllTests(runner.suite);

    // filter out just the failures
    const failures = results.filter(result => result.failed);

    // any failure that isn't for a test is for a hook
    const failedHooks = failures.filter(result => !allTests.includes(result.node));

    // mocha doesn't emit 'pass' or 'fail' when it skips a test
    // or a test is pending, so we find them ourselves
    const skippedResults = allTests
      .filter(node => node.pending || !results.find(result => result.node === node))
      .map(node => ({ skipped: true, node }));

    const builder = xmlBuilder.create(
      'testsuites',
      { encoding: 'utf-8' },
      {},
      { skipNullAttributes: true }
    );

    const testsuitesEl = builder.ele('testsuite', {
      timestamp: new Date(stats.startTime).toISOString().slice(0, -5),
      time: getDuration(stats),
      tests: allTests.length + failedHooks.length,
      failures: failures.length,
      skipped: skippedResults.length,
    });

    function addTestcaseEl(node) {
      return testsuitesEl.ele('testcase', {
        name: getFullTitle(node),
        classname: `${reportName}.${getPath(node).replace(/\./g, '·')}`,
        time: getDuration(node),
      });
    }

    [...results, ...skippedResults].forEach(result => {
      const el = addTestcaseEl(result.node);

      if (result.failed) {
        el.ele('failure').dat(inspect(result.error));
        return;
      }

      if (result.skipped) {
        el.ele('skipped');
      }
    });

    const reportPath = resolve(rootDirectory, `target/junit/TEST-${reportName}.xml`);
    const reportXML = builder.end({
      pretty: true,
      indent: '  ',
      newline: '\n',
      spacebeforeslash: ''
    });

    mkdirp.sync(dirname(reportPath));
    writeFileSync(reportPath, reportXML, 'utf8');
  });
}
