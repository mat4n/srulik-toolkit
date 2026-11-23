// Graph contract: parent tasks, loops, prev values and loop limits. Local fakes only.
'use strict';
const { assert, writeFileSync, readFileSync, existsSync, join, spawnSync, http, temp, mod, CLI, log, PLUGIN } = require('./graph-fixtures.js');
const { ids, events, TASK_YAML, drive, get, copyFileSync, vm } = require('./graph-flow-helpers.js');

module.exports = {
  // parent tasks: done by the orchestrator, never charged to max_agents, offered again until settled; a rejection blocks
  C40() {
    const { check } = mod('spec.js'); const { next, done, status } = mod('run.js');
    const dir = temp('graph-');
    const spec = check({ name: 'p', limits: { max_agents: 2 }, nodes: {
      a: { agent: 'a', out: ['plan'] },
      ask: { parent: 'Ask the owner about ${a.plan}', out: ['ok'], gate: 'ok == true' },
      b: { agent: 'b', needs: ['ask'] } } });
    assert.deepEqual(ids(next(spec, dir)), ['a#0'], 'parent text refs add an edge, so ask waits for a');
    done(spec, dir, { node: 'a', output: { plan: 'P1' }, model: 'm' });
    const [ask] = next(spec, dir);
    assert.equal(ask.taskType, 'parent');
    assert.equal(ask.prompt, 'Ask the owner about P1', 'parent text is substituted like an agent prompt');
    assert.equal(ask.round, 1);
    assert.equal(ask.pick, undefined, 'a parent task is not picked'); assert.equal(ask.model, undefined);
    const [again] = next(spec, dir);
    assert.ok(again, 'an open parent task comes back from every next');
    assert.equal(again.node, 'ask'); assert.equal(again.resumed, true, 'an open parent task comes back from every next');
    assert.equal(events(dir, 'dispatch').filter(e => e.node === 'ask').length, 1, 'resuming does not dispatch again');
    done(spec, dir, { node: 'ask', output: { ok: true } });
    assert.deepEqual(ids(next(spec, dir)), ['b#0']);
    done(spec, dir, { node: 'b', output: {}, model: 'm' });
    assert.equal(status(spec, dir).state, 'done');
    const base = { name: 'x', limits: { max_agents: 2 } };
    assert.throws(() => check({ ...base, nodes: { p: { parent: 'x', for_each: ['a'] } } }), /p: for_each is only allowed on agent nodes/);
    assert.throws(() => check({ ...base, nodes: { p: { parent: 'x', pick: { tier: 'cheap' } } } }), /p: pick is only allowed on agent nodes/);
    assert.throws(() => check({ ...base, nodes: { p: { parent: 'x', agent: 'y' } } }), /p: needs exactly one of run, agent or parent/);
    assert.throws(() => check({ ...base, nodes: { p: { parent: 'x ${zz.f}' } } }), /p: unknown node "zz"/, 'parent text refs are checked and add edges');

    // a rejected approval blocks everything after it and ends the run, with no next in between
    const d2 = temp('graph-');
    const file = join(d2, 'rej.yaml');
    writeFileSync(file, ['name: rej', 'limits:', '  max_agents: 4', 'loops:', '  rounds:', '    nodes: [r, fix]', '    until: fix.clean == true',
      '    max_rounds: 2', 'nodes:', '  ask:', '    parent: Approve?', '    out: [merge]', '  r:', '    agent: review', '    needs: [ask]',
      '  fix:', '    parent: fix it', '    needs: [r]', '    out: [clean]', '  wrap:', '    parent: wrap up', '    needs: [fix]', ''].join('\n'));
    const rej = check(mod('yaml.js').parse(readFileSync(file, 'utf8')));
    const run = join(d2, 'run');
    next(rej, run);
    done(rej, run, { node: 'ask', attempt: 1, failed: 'owner said no', final: true });
    assert.deepEqual(events(run, 'loop-exit').map(e => [e.loop, e.reason]), [['rounds', 'failed']], 'the loop exits as failed once all its nodes are blocked');
    assert.equal(status(rej, run).state, 'blocked');
    const cli = spawnSync(process.execPath, [CLI, 'status', file, run], { encoding: 'utf8', env: process.env });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(events(run, 'end').at(-1)?.state, 'blocked', 'graph.js status writes the end event');
  },

  // loops: rounds, isolation, stale reports, outside nodes wait for the exit, siblings delay the decision
  C41() {
    const { check } = mod('spec.js'); const { next, done, status } = mod('run.js');
    const dir = temp('graph-');
    const spec = check({ name: 'l', limits: { max_agents: 8 },
      loops: { lp: { nodes: ['rev', 'side', 'fix'], until: 'fix.clean == true', max_rounds: 3 } },
      nodes: {
        start: { agent: 's', out: ['x'] },
        rev: { agent: 'r {item}', for_each: ['a', 'b'], needs: ['start'], out: ['n'] },
        side: { parent: 'side', needs: ['rev'], out: ['k'] },
        fix: { parent: 'fix', needs: ['rev'], out: ['clean'] },
        outside: { agent: 'o', in: '${fix.clean}' } } });
    next(spec, dir); done(spec, dir, { node: 'start', output: { x: 1 }, model: 'm' });
    const r1 = next(spec, dir);
    assert.deepEqual(ids(r1), ['rev#0', 'rev#1']); assert.equal(r1[0].round, 1);
    done(spec, dir, { node: 'rev', index: 0, round: 1, output: { n: 1 }, model: 'm' });
    done(spec, dir, { node: 'rev', index: 1, round: 1, attempt: 1, failed: 'crashed', final: true });
    assert.deepEqual(ids(next(spec, dir)).sort(), ['fix#0', 'side#0']);
    done(spec, dir, { node: 'fix', round: 1, output: { clean: false } });
    assert.equal(events(dir, 'round').length, 0, 'a sibling still running delays the round');
    assert.equal(status(spec, dir).state, 'running');
    assert.deepEqual(ids(next(spec, dir)), ['side#0'], 'only the open sibling comes back; outside waits');
    done(spec, dir, { node: 'side', round: 1, output: { k: 1 } });
    assert.deepEqual(events(dir, 'round').map(e => [e.loop, e.round]), [['lp', 2]], 'the last settle in the round starts the next one');
    assert.equal(status(spec, dir).state, 'running', 'between rounds the run is still running');
    const r2 = next(spec, dir);
    assert.equal(done(spec, dir, { node: 'rev', index: 1, round: 1, output: { n: 9 }, model: 'late' }).duplicate, true, 'a late round-1 report is ignored');
    assert.throws(() => done(spec, dir, { node: 'rev', index: 1, attempt: 1, output: { n: 9 }, model: 'late' }), /rev#1: a loop node's report must carry its round/,
      'a report without round can\'t be told from a late one, so it is refused');
    assert.deepEqual(ids(r2), ['rev#0', 'rev#1']); assert.equal(r2[0].round, 2);
    done(spec, dir, { node: 'rev', index: 0, round: 2, output: { n: 2 }, model: 'm' });
    done(spec, dir, { node: 'rev', index: 1, round: 2, output: { n: 3 }, model: 'm' });
    assert.ok(existsSync(join(dir, 'nodes', 'rev-0.r2.md')), 'a later round writes .r<n> files');
    assert.ok(existsSync(join(dir, 'nodes', 'rev-0.md')), 'round 1 files are kept');
    next(spec, dir);
    done(spec, dir, { node: 'side', round: 2, output: { k: 2 } });
    done(spec, dir, { node: 'fix', round: 2, output: { clean: true } });
    assert.deepEqual(events(dir, 'loop-exit').map(e => [e.loop, e.round, e.reason]), [['lp', 2, 'until']]);
    const [out] = next(spec, dir);
    assert.equal(out.node, 'outside'); assert.deepEqual(out.input.fix, { clean: true }, 'outside sees the final round');
    const lines = log(dir);
    assert.ok(lines.findIndex(e => e.type === 'dispatch' && e.node === 'outside') > lines.findIndex(e => e.type === 'loop-exit'), 'outside starts only after the exit');
    done(spec, dir, { node: 'outside', output: {}, model: 'm' });
    const st = status(spec, dir);
    assert.equal(st.state, 'done', 'a round-1 failure does not make a clean later round partial');
    assert.deepEqual(st.loops, { lp: { round: 2, exit: 'until' } });

    // an exit node that fails finally ends the loop as failed and blocks its consumers
    const d2 = temp('graph-');
    next(spec, d2); done(spec, d2, { node: 'start', output: { x: 1 }, model: 'm' });
    next(spec, d2);
    done(spec, d2, { node: 'rev', index: 0, output: { n: 1 }, model: 'm' }); done(spec, d2, { node: 'rev', index: 1, output: { n: 1 }, model: 'm' });
    next(spec, d2);
    done(spec, d2, { node: 'side', output: { k: 1 } });
    done(spec, d2, { node: 'fix', attempt: 1, failed: 'cannot fix', final: true });
    assert.deepEqual(events(d2, 'loop-exit').map(e => e.reason), ['failed']);
    assert.ok(events(d2, 'blocked').some(e => e.node === 'outside'), 'consumers of a failed exit are blocked');
    assert.equal(status(spec, d2).state, 'blocked');

    // a run node inside a loop records its round through exec, in every round
    const { exec } = mod('run.js');
    const d3 = temp('graph-');
    const withRun = check({ name: 'x', limits: { max_agents: 2 }, loops: { lp: { nodes: ['t', 'j'], until: 'j.ok == true', max_rounds: 2 } },
      nodes: { t: { run: [process.execPath, '-e', 'process.stdout.write("hi")'] }, j: { agent: 'j', needs: ['t'], out: ['ok'] } } });
    next(withRun, d3); exec(withRun, d3, 't');
    next(withRun, d3); done(withRun, d3, { node: 'j', round: 1, output: { ok: false }, model: 'm' });
    assert.deepEqual(ids(next(withRun, d3)), ['t#0']);
    assert.equal(exec(withRun, d3, 't').output.text, 'hi', 'exec records a round-2 run node');
    assert.ok(existsSync(join(d3, 'nodes', 't-0.r2.md')));
  },

  // ${prev.node.field}: the previous round's value, null in round 1, no edge, same loop only
  C42() {
    const { check } = mod('spec.js'); const { next, done } = mod('run.js');
    const dir = temp('graph-');
    const loops = { lp: { nodes: ['a', 'b'], until: 'b.stop == true', max_rounds: 2 } };
    const spec = check({ name: 'v', limits: { max_agents: 4 }, loops, nodes: {
      a: { agent: 'seen ${prev.b.v}', out: ['x'] }, b: { agent: 'b', needs: ['a'], out: ['v', 'stop'] } } });
    assert.equal(next(spec, dir)[0].prompt, 'seen null');
    done(spec, dir, { node: 'a', output: { x: 1 }, model: 'm' }); next(spec, dir);
    done(spec, dir, { node: 'b', output: { v: 'one', stop: false }, model: 'm' });
    assert.equal(next(spec, dir)[0].prompt, 'seen one');
    const base = { name: 'v', limits: { max_agents: 6 } };
    assert.throws(() => check({ ...base, loops, nodes: { a: { agent: 'a', out: ['x'] }, b: { agent: 'b', needs: ['a'], out: ['v', 'stop'] }, c: { agent: '${prev.b.v}', needs: ['b'] } } }),
      /c: \$\{prev\.b\.v\} is only allowed inside the same loop/);
    assert.throws(() => check({ ...base, loops: { ...loops, mp: { nodes: ['c'], until: 'c.stop == true', max_rounds: 1 } },
      nodes: { a: { agent: 'a', out: ['x'] }, b: { agent: 'b', needs: ['a'], out: ['v', 'stop'] }, c: { agent: '${prev.b.v}', needs: ['b'], out: ['stop'] } } }),
      /c: \$\{prev\.b\.v\} is only allowed inside the same loop/);
    assert.throws(() => check({ ...base, nodes: { prev: { agent: 'x' } } }), /prev: the name "prev" is reserved/);
    assert.throws(() => check({ ...base, loops, nodes: { a: { agent: 'a ${prev.foo}', out: ['x'] }, b: { agent: 'b', needs: ['a'], out: ['v', 'stop'] } } }),
      /a: \$\{prev\.foo\} must be \$\{prev\.<node>\.<field>\}/);
    assert.throws(() => check({ ...base, loops, nodes: { a: { agent: 'a', in: '${prev.foo}', out: ['x'] }, b: { agent: 'b', needs: ['a'], out: ['v', 'stop'] } } }),
      /a: \$\{prev\.foo\} must be \$\{prev\.<node>\.<field>\}/);
  },

  // loop limits: max_rounds, the total cap across rounds, and contiguity
  C43() {
    const { check } = mod('spec.js'); const { next, done, status } = mod('run.js');
    const dir = temp('graph-');
    const spec = check({ name: 'm', limits: { max_agents: 2 }, loops: { lp: { nodes: ['a'], until: 'a.stop == true', max_rounds: 2 } },
      nodes: { a: { agent: 'a', out: ['stop'] } } });
    for (let i = 0; i < 2; i++) { const [t] = next(spec, dir); done(spec, dir, { node: 'a', round: t.round, output: { stop: false }, model: 'm' }); }
    assert.deepEqual(events(dir, 'loop-exit').map(e => e.reason), ['max_rounds']);
    assert.equal(status(spec, dir).state, 'partial', 'running out of rounds is partial');

    // a fan-out before a loop is trimmed so every round of the loop still fits
    const d2 = temp('graph-');
    const wide = check({ name: 'w', limits: { max_agents: 6 }, loops: { lp: { nodes: ['r'], until: 'r.stop == true', max_rounds: 3 } }, nodes: {
      fan: { agent: 'f', out: ['items'] }, many: { agent: 'm {item}', for_each: '${fan.items}' }, r: { agent: 'r', needs: ['many'], out: ['stop'] } } });
    next(wide, d2); done(wide, d2, { node: 'fan', output: { items: Array.from({ length: 10 }, (_, i) => i) }, model: 'm' });
    const fanned = next(wide, d2);
    assert.equal(fanned.length, 2, 'room left for the loop\'s 3 rounds');
    fanned.forEach(t => done(wide, d2, { node: 'many', index: t.index, output: {}, model: 'm' }));
    for (const stop of [false, false, true]) { const [t] = next(wide, d2); assert.equal(t.node, 'r'); done(wide, d2, { node: 'r', round: t.round, output: { stop }, model: 'm' }); }
    assert.deepEqual(events(d2, 'loop-exit').map(e => [e.round, e.reason]), [[3, 'until']], 'all three rounds ran');

    const base = { name: 'c', limits: { max_agents: 10 } };
    const L = nodes => ({ lp: { nodes, until: 'g2.stop == true', max_rounds: 2 } });
    assert.throws(() => check({ name: 'c', limits: { max_agents: 2 }, loops: { lp: { nodes: ['a'], until: 'a.stop == true', max_rounds: 3 } }, nodes: { a: { agent: 'a', out: ['stop'] } } }),
      /graph needs at least 3 agents; max_agents is 2/, 'rounds count toward the cap');
    assert.throws(() => check({ ...base, loops: L(['g1', 'g2']), nodes: { g1: { agent: 'x' }, x: { agent: 'x', needs: ['g1'] }, g2: { agent: 'y', needs: ['x'], out: ['stop'] } } }),
      /loops\.lp: x is outside the loop but between its nodes/);
    assert.throws(() => check({ ...base, loops: L(['g1', 'g2']), nodes: { g1: { agent: 'x' }, g2: { agent: 'y', needs: ['g1'], out: ['stop'] }, o: { agent: 'o', needs: ['g1', 'g2'] } } }),
      /loops\.lp: only g2, the until node, may have dependents outside the loop/);
    assert.throws(() => check({ ...base, loops: { lp: { nodes: ['g1', 'g2'], until: 'g1.stop == true', max_rounds: 2 } },
      nodes: { g1: { agent: 'x', out: ['stop'] }, g2: { agent: 'y', needs: ['g1'] }, o: { agent: 'o', needs: ['g2'] } } }), /loops\.lp: only g1, the until node, may have dependents outside the loop/);
    assert.throws(() => check({ ...base, loops: { ...L(['g1', 'g2']), mp: { nodes: ['g1'], until: 'g1.stop == true', max_rounds: 1 } },
      nodes: { g1: { agent: 'x', out: ['stop'] }, g2: { agent: 'y', needs: ['g1'], out: ['stop'] } } }), /loops\.mp: g1 is already in loop lp/);
    assert.throws(() => check({ ...base, loops: { lp: { nodes: ['a'], until: 'a.stop == true', max_rounds: 0 } }, nodes: { a: { agent: 'a', out: ['stop'] } } }),
      /loops\.lp: max_rounds must be an integer from 1 to 20/);
    assert.throws(() => check({ ...base, loops: { lp: { nodes: ['a'], until: 'a.stop == true', max_rounds: 2 } }, nodes: { a: { agent: 'a' } } }),
      /loops\.lp: until field "stop" must be listed in a's out/);
    assert.throws(() => check({ ...base, loops: { lp: { nodes: ['a'], until: 'b.stop == true', max_rounds: 2 } }, nodes: { a: { agent: 'a' }, b: { agent: 'b', out: ['stop'] } } }),
      /loops\.lp: until node b must be in the loop/);
  },
};
