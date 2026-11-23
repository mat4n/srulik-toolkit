// Shared helpers for the graph flow contract checks.
'use strict';
const { assert, writeFileSync, readFileSync, existsSync, join, spawnSync, http, temp, mod, CLI, log, PLUGIN } = require('./graph-fixtures.js');
const { copyFileSync } = require('node:fs');
const vm = require('node:vm');

const ids = tasks => tasks.map(t => `${t.node}#${t.index}`);
const events = (dir, type) => log(dir).filter(e => e.type === type);
const TASK_YAML = join(PLUGIN, 'skills', 'agent-swarm', 'graphs', 'task.yaml');

// Answer every ready task with answer(task) until nothing is left. Resumed parent tasks come back until answered.
function drive(spec, dir, answer, inputs = {}) {
  const { next, done } = mod('run.js');
  for (let guard = 0; guard < 300; guard++) {
    const tasks = next(spec, dir, inputs);
    if (!tasks.length) return;
    for (const t of tasks) {
      const output = answer(t);
      done(spec, dir, { node: t.node, index: t.index, round: t.round, attempt: t.attempt, ...(output && output.failed ? output : { output, model: 'fake' }) });
    }
  }
  throw new Error('walk did not finish');
}

const get = (port, path) => new Promise((ok, bad) => http.get({ host: '127.0.0.1', port, path, timeout: 2000 },
  res => { let body = ''; res.on('data', c => { body += c; }); res.on('end', () => ok({ status: res.statusCode, body })); })
  .on('timeout', function () { this.destroy(new Error('no response within 2 s')); }).on('error', bad));


module.exports = { ids, events, TASK_YAML, drive, get, copyFileSync, vm };
