// v0.8.0: AI 제공자(Gemini/OpenAI/Claude) 분기 · 재시도 · 설정 항목 보강 · 동시 제출 · 읽기 캐시
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../server/Code.gs'), 'utf8');

function fixture(opts = {}) {
  const sheets = {}, cache = new Map(), props = new Map();
  const http = []; // 기록: {url, headers, payload}
  let locked = false;
  const storage = m => ({ get: k => m.get(k) || null, put: (k, v) => m.set(k, v), remove: k => m.delete(k), getProperty: k => m.get(k) || null, setProperty: (k, v) => m.set(k, v), deleteProperty: k => m.delete(k) });
  const responder = opts.responder || ((url, req) => ({ code: 200, body: {} }));
  const c = { Date, Math, JSON, console,
    Utilities: { getUuid: crypto.randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, v) => Array.from(crypto.createHash('sha256').update(v).digest()), formatDate: () => '2026-11-01 10:00:00', sleep: ms => { c.__slept.push(ms); } },
    __slept: [],
    CacheService: { getScriptCache: () => storage(cache) }, PropertiesService: { getScriptProperties: () => storage(props) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false, 'recursive lock'); locked = true; }, releaseLock() { assert.equal(locked, true); locked = false; } }) },
    UrlFetchApp: { fetch(url, opt) { const req = JSON.parse(opt.payload); http.push({ url, headers: opt.headers || {}, req }); const r = responder(url, req, http.length); return { getResponseCode: () => r.code, getContentText: () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body) }; } },
    SpreadsheetApp: { flush: () => {}, getActiveSpreadsheet: () => ({ getSheetByName: n => sheet(n) }) }
  };
  let reads = 0;
  function sheet(n) {
    if (!sheets[n]) return null;
    const rows = sheets[n];
    return { getLastRow: () => rows.length, getLastColumn: () => Math.max(...rows.map(r => r.length)), getMaxRows: () => 1000,
      getRange(r, col, nr = 1, nc = 1) { return {
        getValues: () => { reads++; return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[col - 1 + j] ?? '')); },
        getValue: () => rows[r - 1]?.[col - 1] ?? '',
        setValues(vals) { for (let i = 0; i < nr; i++) { rows[r - 1 + i] ??= []; for (let j = 0; j < nc; j++) rows[r - 1 + i][col - 1 + j] = vals[i][j]; } return this; },
        setValue(v) { rows[r - 1] ??= []; rows[r - 1][col - 1] = v; return this; },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (rows[r - 1 + i]) rows[r - 1 + i][col - 1 + j] = ''; return this; },
        setBackground() { return this; }, setNumberFormat() { return this; }, setFontColor() { return this; }, setWrap() { return this; }, setFontWeight() { return this; }, setHorizontalAlignment() { return this; }
      }; },
      setColumnWidth() {}, setFrozenRows() {}, setRowHeight() {}
    };
  }
  vm.createContext(c); vm.runInContext(source, c);
  for (const [n, headers] of Object.entries(c.HEADERS)) sheets[n] = [Array.from(headers)];
  sheets['설정'] = [['항목', '값'], ['Gemini API 키', 'gkey'], ['교사 비밀번호', 'test-password'], ['모델', 'gemini-3.8-flash']];
  if (opts.settings) sheets['설정'].push(...opts.settings);
  sheets['학급'].push(['C1', 'ABC234', '가상 학급', 3, '2026-11-01', '활성']);
  for (let i = 1; i <= 25; i++) sheets['학생'].push(['C1', String(i), '학생' + i, '']);
  const criteria = [{ id: 'C1', name: '내용', group: '공통', levels: ['1', '2', '3', '4'] }, { id: 'C2', name: '짜임', group: '공통', levels: ['1', '2', '3', '4'] }];
  sheets['과제'].push(['T1', 'C1', '학교 소개', 'explain', '학교를 소개해요', '3-4', 0, 0, '', JSON.stringify(criteria), '열림', '2026-11-01', 3, 3]);
  // doPost와 같게: 예외는 {ok:false, error}로
  const request = (action, body = {}) => { c.requestCache_ = {}; try { return c.route_(action, body); } catch (e) { return { ok: false, error: String(e.message || e) }; } };
  const teacher = request('teacher.login', { pw: 'test-password' }).data.token;
  const join = no => request('student.join', { code: 'ABC234', no: String(no), name: '학생' + no }).data.token;
  const good = () => ({ criteria: [{ id: 'C1', level: 3, evidence: '나무가 있어요.', reason: '좋아요', tip: '예를' }, { id: 'C2', level: 2, evidence: '나무가 있어요.', reason: '', tip: '' }], strengths: ['좋아요'], improvements: ['예시'], nextTry: '예시를 써요', summary: '좋은 글이에요', corrections: [], growth: [], growthSummary: '' });
  return { c, sheets, request, teacher, join, good, http, reads: () => reads };
}
const geminiOk = out => ({ code: 200, body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(out) }] } }] } });
const openaiOk = out => ({ code: 200, body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(out) } }] } });
const claudeOk = out => ({ code: 200, body: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'geulsup_feedback', input: out }] } });

test('settings: provider rows are appended to an old 설정 sheet on teacher.status; default provider is gemini', () => {
  const f = fixture();
  assert.equal(f.sheets['설정'].length, 4);
  const st = f.request('teacher.status', { token: f.teacher }).data;
  assert.equal(st.teacher.provider, 'gemini');
  const items = f.sheets['설정'].slice(1).map(r => r[0]);
  for (const k of ['AI 제공자', 'OpenAI API 키', 'OpenAI 모델', 'Claude API 키', 'Claude 모델']) assert.ok(items.includes(k), k);
  assert.equal(f.sheets['설정'][1][1], 'gkey', '기존 값 유지');
});

test('openai: strict json_schema request, Bearer key, result parsed; missing key → clear error', () => {
  let f = fixture({ settings: [['AI 제공자', 'openai'], ['OpenAI 모델', 'gpt-5-mini']] });
  const r0 = f.request('ai.test', { token: f.teacher });
  assert.equal(r0.ok, false); assert.match(r0.error, /OpenAI API 키/);
  f = fixture({ settings: [['AI 제공자', 'ChatGPT'], ['OpenAI API 키', 'sk-test'], ['OpenAI 모델', 'gpt-5-mini']], responder: (url, req) => openaiOk(/인사/.test(JSON.stringify(req)) ? { greeting: '안녕하세요' } : f.good()) });
  const t = f.request('ai.test', { token: f.teacher });
  assert.equal(t.ok, true); assert.equal(t.data.provider, 'openai'); assert.equal(t.data.reply, '안녕하세요');
  const call = f.http[0];
  assert.match(call.url, /api\.openai\.com\/v1\/chat\/completions/);
  assert.equal(call.headers.Authorization, 'Bearer sk-test');
  assert.equal(call.req.model, 'gpt-5-mini');
  assert.equal(call.req.response_format.type, 'json_schema');
  assert.equal(call.req.response_format.json_schema.strict, true);
  const sch = call.req.response_format.json_schema.schema;
  assert.equal(sch.additionalProperties, false);
  // 채점 호출 전체 스키마도 strict 변환되는지
  const stu = f.join(1);
  const sub = f.request('submission.submit', { token: stu, taskId: 'T1', round: 1, revision: 0, text: '나무가 있어요.', title: '' });
  assert.equal(sub.ok, true); assert.ok(sub.data.feedback, sub.data.feedbackError);
  const fbCall = f.http[f.http.length - 1].req.response_format.json_schema.schema;
  const crit = fbCall.properties.criteria.items;
  assert.equal(crit.additionalProperties, false); assert.deepEqual(crit.required.sort(), Object.keys(crit.properties).sort());
  assert.match(f.sheets['피드백'][1][11], /^openai:gpt-5-mini$/, '모델 열에 제공자 기록');
});

test('openai: temperature-unsupported model → retried without temperature; 401 → key error; refusal → error', () => {
  let n = 0;
  const f = fixture({ settings: [['AI 제공자', 'openai'], ['OpenAI API 키', 'sk-test']], responder: (url, req) => { n++; if (req.temperature !== undefined) return { code: 400, body: { error: { message: "Unsupported value: 'temperature'" } } }; return openaiOk({ greeting: '안녕' }); } });
  assert.equal(f.request('ai.test', { token: f.teacher }).ok, true);
  assert.equal(n, 2); assert.equal(f.http[1].req.temperature, undefined);
  const f2 = fixture({ settings: [['AI 제공자', 'openai'], ['OpenAI API 키', 'bad']], responder: () => ({ code: 401, body: { error: { message: 'Incorrect API key' } } }) });
  const r = f2.request('ai.test', { token: f2.teacher }); assert.equal(r.ok, false); assert.match(r.error, /OpenAI 키/);
  const f3 = fixture({ settings: [['AI 제공자', 'openai'], ['OpenAI API 키', 'sk']], responder: () => ({ code: 200, body: { choices: [{ message: { refusal: 'no' } }] } }) });
  assert.match(f3.request('ai.test', { token: f3.teacher }).error, /거부/);
});

test('claude: forced tool_use with input_schema, x-api-key header; tool input is the result; max_tokens retry', () => {
  let n = 0;
  const f = fixture({ settings: [['AI 제공자', 'claude'], ['Claude API 키', 'sk-ant-1'], ['Claude 모델', 'claude-haiku-5-5']], responder: (url, req) => { n++; if (n === 1) return { code: 200, body: { stop_reason: 'max_tokens', content: [] } }; return claudeOk(/인사/.test(JSON.stringify(req)) ? { greeting: '안녕하세요' } : f.good()); } });
  const t = f.request('ai.test', { token: f.teacher });
  assert.equal(t.ok, true); assert.equal(t.data.provider, 'claude');
  assert.equal(n, 2, 'max_tokens → 재시도');
  const call = f.http[0];
  assert.match(call.url, /api\.anthropic\.com\/v1\/messages/);
  assert.equal(call.headers['x-api-key'], 'sk-ant-1'); assert.ok(call.headers['anthropic-version']);
  assert.equal(call.req.tool_choice.type, 'tool'); assert.equal(call.req.tools[0].name, 'geulsup_feedback');
  assert.equal(typeof call.req.system, 'string'); assert.equal(call.req.messages[0].role, 'user');
  const stu = f.join(2);
  const sub = f.request('submission.submit', { token: stu, taskId: 'T1', round: 1, revision: 0, text: '나무가 있어요.', title: '' });
  assert.ok(sub.data.feedback, sub.data.feedbackError);
  assert.equal(sub.data.feedback.criteria[0].level, 3);
  assert.match(f.sheets['피드백'][1][11], /^claude:claude-haiku-5-5$/);
});

test('retry: 429 backs off 3s/10s/25s then succeeds; permanent 429 fails with busy message after 4 tries', () => {
  let n = 0;
  const f = fixture({ responder: () => { n++; return n < 4 ? { code: 429, body: {} } : geminiOk({ greeting: '안녕' }); } });
  assert.equal(f.request('ai.test', { token: f.teacher }).ok, true);
  assert.equal(n, 4); assert.deepEqual(f.c.__slept, [3000, 10000, 25000]);
  const f2 = fixture({ responder: () => ({ code: 429, body: {} }) });
  const r = f2.request('ai.test', { token: f2.teacher });
  assert.equal(r.ok, false); assert.match(r.error, /바빠요/); assert.equal(f2.http.length, 4);
});

test('25 students submit at once: every submission is stored and graded; a transient 429 burst does not lose any', () => {
  let n = 0;
  const f = fixture({ responder: () => { n++; return n % 5 === 0 ? { code: 429, body: {} } : geminiOk(f.good()); } });
  const results = [];
  for (let i = 1; i <= 25; i++) {
    const tok = f.join(i);
    results.push(f.request('submission.submit', { token: tok, taskId: 'T1', round: 1, revision: 0, text: '학생 ' + i + ' 의 글이에요. 나무가 있어요.', title: '' }));
  }
  assert.equal(results.filter(r => r.ok).length, 25);
  assert.equal(results.filter(r => r.data.feedback).length, 25, '모두 피드백 받음 (재시도로 429 극복)');
  assert.equal(f.sheets['제출글'].length - 1, 25); assert.equal(f.sheets['피드백'].length - 1, 25);
  const list = f.request('submission.list', { token: f.teacher, taskId: 'T1' }).data;
  assert.equal(list.counts.done, 25);
});

test('read cache: submission.get reads each sheet once per request; writes are not cached', () => {
  const f = fixture({ responder: () => geminiOk(f.good()) });
  const tok = f.join(3);
  const sub = f.request('submission.submit', { token: tok, taskId: 'T1', round: 1, revision: 0, text: '나무가 있어요.', title: '' });
  const before = f.reads();
  f.request('submission.get', { token: f.teacher, submissionId: sub.data.submissionId });
  const getReads = f.reads() - before;
  assert.ok(getReads <= 6, 'submission.get 시트 읽기 ' + getReads + '회');
  // 쓰기 요청 뒤 바로 읽기 요청이 최신을 보는지
  f.request('feedback.teacher', { token: f.teacher, submissionId: sub.data.submissionId, teacherNote: '메모', finalLevels: {} });
  assert.equal(f.request('submission.get', { token: f.teacher, submissionId: sub.data.submissionId }).data.submission.feedback.teacherNote, '메모');
});
