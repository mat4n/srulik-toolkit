// Graph contract: after, when, and logs from older releases. Local fakes only.
'use strict';
const { assert, writeFileSync, readFileSync, existsSync, join, spawnSync, http, temp, mod, CLI, log, PLUGIN } = require('./graph-fixtures.js');
const { ids, events, TASK_YAML, drive, get, copyFileSync, vm } = require('./graph-flow-helpers.js');

module.exports = {
  // after: items wait for the items they name, get their files, and fail when one of them fails
  C44() {
    const { check } = mod('spec.js'); const { next, done } = mod('run.js');
    const spec = check({ name: 'a', limits: { max_agents: 8 }, nodes: {
      plan: { agent: 'p', out: ['tasks'] }, impl: { agent: 'do {item}', for_each: '${plan.tasks}', after: 'id', out: ['branch'] } } });
    const start = tasks => { const dir = temp('graph-'); next(spec, dir); done(spec, dir, { node: 'plan', output: { tasks }, model: 'm' }); return dir; };
    const dir = start([{ id: 'a' }, { id: 'b', after: ['a'] }, { id: 'c' }]);
    assert.deepEqual(ids(next(spec, dir)), ['impl#0', 'impl#2'], 'b waits for a');
    done(spec, dir, { node: 'impl', index: 0, output: { branch: 'ba' }, model: 'm' });
    const [b] = next(spec, dir);
    assert.equal(b.index, 1);
    assert.deepEqual(b.input.after, [{ id: 'a', file: join(dir, 'nodes', 'impl-0.md'), summary: 'branch: ba' }]);
    const d2 = start([{ id: 'a' }, { id: 'b', after: ['a'] }, { id: 'c' }]);
    next(spec, d2);
    done(spec, d2, { node: 'impl', index: 0, attempt: 1, failed: 'broke', final: true });
    const failed = events(d2, 'failed').find(e => e.index === 1);
    assert.equal(failed?.reason, 'blocked by a'); assert.equal(failed.final, true);
    done(spec, d2, { node: 'impl', index: 2, output: { branch: 'bc' }, model: 'm' });
    assert.deepEqual(next(spec, d2), [], 'independent items finish; nothing is left');
    for (const [tasks, re] of [[[{ id: 'a', after: ['b'] }, { id: 'b', after: ['a'] }], /cycle/], [[{ id: 'a', after: ['zz'] }], /unknown id "zz"/],
      [[{ id: 'a' }, { id: 'a' }], /duplicate id "a"/], [['plain'], /must be an object with "id"/]]) {
      const d = start(tasks);
      assert.deepEqual(next(spec, d), [], 'nothing is dispatched from a bad list');
      const fails = events(d, 'failed');
      assert.equal(fails.length, tasks.length); assert.ok(fails.every(e => e.final && re.test(e.reason)), String(re));
    }
    assert.throws(() => check({ name: 'x', limits: { max_agents: 2 }, nodes: { a: { agent: 'a', after: 'id' } } }), /a: after is only allowed with for_each/);
    // a cap trim fails only the items that wait for a trimmed one; independent items still run
    const capped = check({ name: 'c', limits: { max_agents: 3 }, nodes: {
      plan: { agent: 'p', out: ['tasks'] }, impl: { agent: 'do {item}', for_each: '${plan.tasks}', after: 'id' } } });
    const d3 = temp('graph-'); next(capped, d3);
    done(capped, d3, { node: 'plan', output: { tasks: [{ id: 'a', after: ['c'] }, { id: 'b' }, { id: 'c' }] }, model: 'm' });
    assert.deepEqual(ids(next(capped, d3)), ['impl#1'], 'b runs although c was cap-skipped');
    assert.equal(events(d3, 'failed').find(e => e.index === 0)?.reason, 'blocked by c (cap-skipped)');
  },

  // when: a false condition skips only its node; a missing survivor is false; re-checked each round
  C45() {
    const { check } = mod('spec.js'); const { next, done, status } = mod('run.js');
    const spec = check({ name: 'w', limits: { max_agents: 4 }, nodes: {
      cfg: { agent: 'c', out: ['hosted', 'ok'], gate: 'ok == true' }, pub: { parent: 'publish', when: 'cfg.hosted == true', out: ['url'] },
      fin: { agent: 'f', in: '${pub.url}' } } });
    const run = output => { const dir = temp('graph-'); next(spec, dir); done(spec, dir, { node: 'cfg', output, model: 'm' }); return dir; };
    const off = run({ hosted: false, ok: true });
    const [fin] = next(spec, off);
    assert.equal(fin.node, 'fin', 'a skipped node does not block its consumers');
    assert.deepEqual(fin.input.pub, { url: null });
    assert.deepEqual(events(off, 'skipped').map(e => e.node), ['pub']);
    done(spec, off, { node: 'fin', output: {}, model: 'm' });
    const st = status(spec, off);
    assert.equal(st.state, 'done'); assert.deepEqual(st.skipped, ['pub']);
    assert.deepEqual(ids(next(spec, run({ hosted: true, ok: true }))), ['pub#0']);
    next(spec, run({ hosted: true, ok: false }));
    const dropped = run({ hosted: true, ok: false }); next(spec, dropped);
    assert.deepEqual(events(dropped, 'skipped').map(e => e.node), ['pub'], 'a reference with no survivor is false');
    // inside a loop the condition is checked again each round
    const d3 = temp('graph-');
    const loop = check({ name: 'r', limits: { max_agents: 2 }, loops: { lp: { nodes: ['g', 'h'], until: 'g.stop == true', max_rounds: 2 } },
      nodes: { g: { agent: 'g', out: ['on', 'stop'] }, h: { parent: 'h', needs: ['g'], when: 'g.on == true' } } });
    next(loop, d3); done(loop, d3, { node: 'g', output: { on: false, stop: false }, model: 'm' });
    next(loop, d3); done(loop, d3, { node: 'g', round: 2, output: { on: true, stop: true }, model: 'm' });
    assert.deepEqual(ids(next(loop, d3)), ['h#0'], 'round 2 runs h');
    const base = { name: 'x', limits: { max_agents: 4 } };
    assert.throws(() => check({ ...base, nodes: { f: { agent: 'f', for_each: ['a'], out: ['on'] }, h: { parent: 'h', when: 'f.on == true' } } }), /h: when must refer to a single-instance node/);
    assert.throws(() => check({ ...base, nodes: { f: { agent: 'f' }, h: { parent: 'h', when: 'f.on == true' } } }), /h: when field "on" must be listed in f's out/);
    assert.throws(() => check({ ...base, nodes: { h: { parent: 'h', out: ['on'], when: 'h.on == true' } } }), /h: when must refer to another node/);
    assert.throws(() => check({ ...base, nodes: { h: { parent: 'h', when: 'on == true' } } }), /h: when must be node\.field == literal/);
  },

  // logs written by 1.22.0 fold to the same status; pr-review still checks; new runs record the engine
  C46() {
    const { check } = mod('spec.js'); const { next, status } = mod('run.js');
    const dir = temp('graph-');
    copyFileSync(join(__dirname, 'fixtures', 'graph-1.22-run.jsonl'), join(dir, 'run.jsonl'));
    const spec = check({ name: 'old', limits: { max_agents: 6 }, nodes: {
      review: { agent: 'r {item}', for_each: ['bugs', 'perf'], out: ['findings'] },
      verify: { agent: 'v {item}', for_each: '${review.findings}', out: ['confirmed'], gate: 'confirmed == true' },
      report: { agent: 'p', needs: ['verify'], out: ['body'] } } });
    const st = status(spec, dir);
    assert.equal(st.state, 'partial');
    assert.deepEqual(st.failed, ['review#1']); assert.deepEqual(st.dropped, ['verify#1']);
    assert.deepEqual(st.completed, ['review', 'verify', 'report']);
    const r = spawnSync(process.execPath, [CLI, 'check', join(PLUGIN, 'skills', 'agent-swarm', 'graphs', 'pr-review.yaml')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const fresh = temp('graph-'); next(spec, fresh);
    assert.equal(events(fresh, 'spec')[0].engine, 2);
  },
};
