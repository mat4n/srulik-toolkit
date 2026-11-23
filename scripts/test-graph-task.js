// Graph contract: the bundled task.yaml walks a task with and without Git hosting, then the rest of the plan.
'use strict';
const { assert, readFileSync, temp, mod, log } = require('./graph-fixtures.js');
const { drive, events, TASK_YAML } = require('./graph-flow-helpers.js');

module.exports = {
  // the bundled task graph walks a task with and without Git hosting
  C48() {
    const { check } = mod('spec.js'); const { status } = mod('run.js');
    const spec = check(mod('yaml.js').parse(readFileSync(TASK_YAML, 'utf8')));
    const answers = (hosted, plan, fixes, reviews, opts = {}) => {
      let planRound = 0, fixRound = 0, reviewCall = 0;
      return t => {
        switch (t.node) {
          case 'research': return { notes: 'n' };
          case 'grill': return { answers: 'a' };
          case 'reresearch': return { ready: true, questions: [], notes: 'n' };
          case 'draft': return { plan_file: `/p${t.round}` };
          case 'plan-review': return { ...plan[planRound++], findings: [], hosted };
          case 'approve': return { merge: true };
          case 'issue': return { url: 'u' };
          case 'implement': return { branch: `b-${t.item.id}`, checks: 'ok' };
          case 'integrate': return { base: 'main', branch: 'feat', ok: true };
          case 'audit': return { ok: true, gaps: [] };
          case 'pr': return { number: 7, url: 'u' };
          case 'review': return { findings: reviews(t, reviewCall++) };
          case 'verify': return { confirmed: true, evidence: 'e' };
          case 'post': return { posted: true };
          case 'fix': return fixes[fixRound++];
          case 'babysit': return { state: 'MERGE READY', merge: opts.merge ?? true };
          case 'merge': return { merged: true };
          case 'continue': return opts.cont ?? { done: true, remaining: [] };
          case 'recap': if (opts.seen) opts.seen.recap = t.prompt; return { text: 'r' };
          default: throw new Error(`unexpected node ${t.node}`);
        }
      };
    };
    const dispatched = dir => events(dir, 'dispatch').map(e => e.node);
    // no Git hosting: the hosted-only nodes are skipped, merge too although the owner authorized it
    const local = temp('graph-');
    drive(spec, local, answers(false, [{ clean: true, plan_file: '/p1', tasks: [{ id: 't1' }] }], [{ clean: true, decided: [] }], () => []), { request: 'fix a typo' });
    for (const node of ['issue', 'pr', 'post', 'babysit', 'merge']) assert.ok(!dispatched(local).includes(node), `${node} is skipped without hosting`);
    assert.deepEqual(events(local, 'skipped').map(e => e.node).sort(), ['babysit', 'continue', 'issue', 'merge', 'post', 'pr']);
    assert.ok(dispatched(local).includes('recap'));
    assert.ok(!dispatched(local).includes('continue'), 'continue runs no post-merge steps when no merge ran');
    assert.ok(events(local, 'skipped').some(e => e.node === 'continue'));
    assert.equal(status(spec, local).state, 'done');
    // hosted: two plan rounds, ordered implementation, two review rounds, merge after babysit
    const hosted = temp('graph-');
    drive(spec, hosted, answers(true,
      [{ clean: false, plan_file: '/p1', tasks: [{ id: 'old' }] }, { clean: true, plan_file: '/p2', tasks: [{ id: 't1' }, { id: 't2', after: ['t1'] }] }],
      [{ clean: false, decided: ['found x'] }, { clean: true, decided: ['found x'] }],
      (t, n) => (t.round === 1 && t.item === 'bugs' ? [{ title: 'x' }] : [])), { request: 'a feature' });
    const lines = log(hosted);
    const draft2 = lines.find(e => e.type === 'dispatch' && e.node === 'draft' && e.round === 2);
    assert.ok(draft2, 'the plan loop ran twice');
    assert.deepEqual(lines.filter(e => e.type === 'admit' && e.node === 'implement').at(-1).items.map(i => i.item.id), ['t1', 't2'], 'implementation uses the reviewed plan');
    assert.equal(lines.filter(e => e.type === 'dispatch' && e.node === 'post').length, 2, 'one post per review round');
    const at = pred => lines.findIndex(pred);
    assert.ok(at(e => e.type === 'dispatch' && e.node === 'implement' && e.index === 1) > at(e => e.type === 'result' && e.node === 'implement' && e.index === 0), 't2 waits for t1');
    assert.ok(at(e => e.type === 'dispatch' && e.node === 'merge') > at(e => e.type === 'result' && e.node === 'babysit'), 'merge waits for babysit');
    assert.ok(at(e => e.type === 'dispatch' && e.node === 'recap') > at(e => e.type === 'result' && e.node === 'continue'), 'recap waits for the rest of the plan');
    assert.equal(status(spec, hosted).state, 'done');
    // no merge authority: merge and continue are skipped, and recap still runs
    const one = [{ clean: true, plan_file: '/p1', tasks: [{ id: 't1' }] }];
    const unmerged = temp('graph-');
    drive(spec, unmerged, answers(true, one, [{ clean: true, decided: [] }], () => [], { merge: false }), { request: 'r' });
    assert.ok(!dispatched(unmerged).includes('continue'), 'continue waits for a verified merge');
    assert.ok(dispatched(unmerged).includes('recap'));
    // an unfinished plan reaches recap as a BLOCKED handoff that names what remains
    const open = temp('graph-'); const recapSeen = {};
    drive(spec, open, answers(true, one, [{ clean: true, decided: [] }], () => [], { cont: { done: false, remaining: ['prd: Harness approval'] }, seen: recapSeen }), { request: 'r' });
    assert.match(recapSeen.recap, /done false/);
    assert.match(recapSeen.recap, /prd: Harness approval/);
    assert.match(recapSeen.recap, /BLOCKED handoff/);
    // prompts carry the previous round: the reviewed plan file and the decided findings
    const { next } = mod('run.js');
    const probe = temp('graph-');
    let seen = {};
    drive(spec, probe, (() => { const a = answers(true,
      [{ clean: false, plan_file: '/p1', tasks: [{ id: 't1' }] }, { clean: true, plan_file: '/p2', tasks: [{ id: 't1' }] }],
      [{ clean: false, decided: ['found x'] }, { clean: true, decided: ['found x'] }], () => []);
      return t => { if (t.round === 2) seen[t.node] = t.prompt; return a(t); }; })(), { request: 'r' });
    assert.match(seen.draft, /\/p1/, 'the second draft sees the reviewed plan file');
    assert.match(seen.review, /found x/, 'the second review round sees decided findings');
    void next;
  },
};
