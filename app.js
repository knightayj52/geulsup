/**
 * 글숲 (geulsup) — 학생 글쓰기 AI 피드백 앱 · 화면 로직
 * © 2026 영쌤클래스 · 교육용으로 제작 · 무단 복제·재배포 금지
 *
 * v0.4.1 — 과제 설정(고칠 곳 표시 개수 · 최대 차수), 차수 종료 화면
 * v0.4.0 — 4단계: AI 피드백
 *   - 학생: 제출 즉시 기준별 성장 단계(씨앗·새싹·나무·열매)·근거·조언, 잘한 점/고쳐 볼 점/다음에 시도, 고칠 곳 → 고쳐 쓰기(다음 차수)
 *   - 교사: 제출글 화면에 AI 결과 표시, 다시 채점, AI 연결 테스트
 * v0.3.0 — 3단계: 글쓰기·제출
 *   - 학생: 글쓰기 편집기(글자 수·조건 체크·자동 임시 저장·제출), 제출한 글 보기
 *   - 교사: 과제별 제출 현황 · 글 열람 · 제출 되돌리기
 * v0.2.1 — 학년군 날짜 변환 버그 수정 (루브릭·과제 시트)
 * v0.2.0 — 2단계: 과제 만들기
 *   - 교사: 학급별 과제 목록 · 과제 만들기/수정(갈래 → 기본 루브릭 자동 불러오기, 기준 편집) · 열기/닫기
 *   - 학생: 열린 과제 목록 · 과제 상세(글감·조건·평가 기준 이름)
 * v0.1.0 — 1단계: 기반
 *   - 교사: 배포 URL 등록 → 연결 테스트 → 비밀번호 로그인 → 학급 개설 · 명단 · 링크/QR
 *   - 학생: 학급 링크(?s=배포ID&c=학급코드) 또는 코드 직접 입력 → 번호·이름으로 입장
 *
 * 서버: Google Apps Script 웹 앱 (Code.gs) — POST JSON, {ok, data} 규약
 */

(function () {
  'use strict';

  var APP_VERSION = '0.4.1';

  // 서버와 같은 목록 (ping/login 응답으로 덮어씀)
  var GENRES = [
    { key: 'explain', label: '설명하는 글' },
    { key: 'argue',   label: '주장하는 글' },
    { key: 'propose', label: '제안하는 글' },
    { key: 'review',  label: '감상문' }
  ];
  var BANDS = [{ key: '3-4', label: '3~4학년' }, { key: '5-6', label: '5~6학년' }];
  var GENRE_HINTS = {
    explain: '예: 우리 학교의 자랑거리 한 가지를 골라, 처음 듣는 친구도 알 수 있게 설명해 보세요.',
    argue:   '예: "쉬는 시간을 20분으로 늘려야 한다"에 찬성 또는 반대하는 글을 쓰세요. 까닭을 두 가지 이상 드세요.',
    propose: '예: 우리 반에서 고치고 싶은 문제 하나를 골라, 누가 무엇을 어떻게 하면 좋을지 제안해 보세요.',
    review:  '예: 최근에 읽은 책에서 가장 인상 깊은 장면을 고르고, 왜 그렇게 느꼈는지 쓰세요.'
  };
  function genreLabel(key) { for (var i = 0; i < GENRES.length; i++) if (GENRES[i].key === key) return GENRES[i].label; return key; }
  function bandLabel(key) { for (var i = 0; i < BANDS.length; i++) if (BANDS[i].key === key) return BANDS[i].label; return key; }
  function bandForGrade(grade) { return Number(grade) >= 5 ? '5-6' : '3-4'; }

  // ───────────────────────────────────────────
  // 저장 키
  // ───────────────────────────────────────────
  var KEYS = {
    apiId:     'geulsup_api_id',      // localStorage: GAS 배포 ID
    student:   'geulsup_student',     // localStorage: 입장한 학생 정보
    pendCode:  'geulsup_pending_code',// localStorage: 링크로 받은 학급 코드(입장 전)
    teacherPw: 'geulsup_teacher_pw'   // sessionStorage: 교사 비밀번호(브라우저 닫으면 사라짐)
  };

  var $app = document.getElementById('app');
  var $topRight = document.getElementById('topbarRight');
  var $toast = document.getElementById('toast');

  // ───────────────────────────────────────────
  // 저장소 유틸
  // ───────────────────────────────────────────
  function lsGet(k, fallback) {
    try { var v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  function getStudent() {
    try { return JSON.parse(lsGet(KEYS.student, 'null')); } catch (e) { return null; }
  }

  // ───────────────────────────────────────────
  // DOM 유틸 (사용자 입력 텍스트는 항상 textContent로)
  // ───────────────────────────────────────────
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // 고정 문구에만 사용
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function render() { clear($app); for (var i = 0; i < arguments.length; i++) if (arguments[i]) $app.appendChild(arguments[i]); window.scrollTo(0, 0); }

  var toastTimer = null;
  function toast(msg, isError) {
    $toast.textContent = msg;
    $toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.className = 'toast'; }, isError ? 3500 : 2200);
  }

  function setBusy(btn, busy, labelBusy) {
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = labelBusy || '잠시만요…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ───────────────────────────────────────────
  // API
  // ───────────────────────────────────────────
  function extractDeployId(input) {
    var s = String(input || '').trim();
    var m = s.match(/\/s\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
    return '';
  }
  function apiUrl(id) { return 'https://script.google.com/macros/s/' + id + '/exec'; }

  function api(action, payload) {
    var id = lsGet(KEYS.apiId, '');
    if (!id) return Promise.reject(new Error('서버가 연결되어 있지 않아요. 교사 화면에서 배포 URL을 등록해 주세요.'));
    var body = Object.assign({ action: action }, payload || {});
    return fetch(apiUrl(id), {
      method: 'POST',
      // text/plain 으로 보내야 브라우저가 preflight 없이 GAS로 보냅니다
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j;
        try { j = JSON.parse(t); } catch (e) { throw new Error('서버 응답을 읽을 수 없어요. 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
        if (!j.ok) throw new Error(j.error || '알 수 없는 오류');
        return j.data;
      });
  }
  function teacherApi(action, payload) {
    return api(action, Object.assign({ pw: ssGet(KEYS.teacherPw) }, payload || {}));
  }

  // ───────────────────────────────────────────
  // 라우팅
  // ───────────────────────────────────────────
  function go(hash) { location.hash = hash; }

  function readLinkParams() {
    var q = new URLSearchParams(location.search);
    var s = q.get('s');
    var c = q.get('c');
    var touched = false;
    if (s && extractDeployId(s)) { lsSet(KEYS.apiId, extractDeployId(s)); touched = true; }
    if (c) { lsSet(KEYS.pendCode, c.toUpperCase()); touched = true; }
    if (touched) {
      // 주소를 깨끗하게 (뒤로가기 해도 파라미터가 다시 안 붙도록)
      history.replaceState(null, '', location.pathname + (location.hash || '#/'));
    }
  }

  function route() {
    var hash = location.hash || '#/';
    var path = hash.replace(/^#/, '');
    renderTopbar(path);
    if (path === '/' || path === '') return viewHome();
    if (path === '/teacher') return viewTeacher();
    if (path === '/teacher/classes') return viewClasses();
    if (path === '/teacher/new') return viewClassForm(null);
    if (path.indexOf('/teacher/class/') === 0) {
      var seg = path.split('/'); // ['', 'teacher', 'class', classId, 'tasks'?, taskId|'new'?]
      if (seg[4] === 'tasks' && seg[5] === 'new') return viewTaskForm(seg[3], null);
      if (seg[4] === 'tasks' && seg[5] && seg[6] === 'submissions') return viewSubmissions(seg[3], seg[5]);
      if (seg[4] === 'tasks' && seg[5]) return viewTaskForm(seg[3], seg[5]);
      if (seg[4] === 'tasks') return viewTasks(seg[3]);
      return viewClassDetail(seg[3]);
    }
    if (path.indexOf('/teacher/submission/') === 0) return viewSubmissionDetail(path.split('/')[3]);
    if (path === '/class') return viewStudentHome();
    if (path.indexOf('/class/task/') === 0) return viewStudentTask(path.split('/')[3]);
    return viewHome();
  }

  function renderTopbar(path) {
    clear($topRight);
    var student = getStudent();
    if (path.indexOf('/teacher') === 0) {
      $topRight.appendChild(h('span', { class: 'chip', text: '교사 모드' }));
      if (ssGet(KEYS.teacherPw)) {
        $topRight.appendChild(h('button', { class: 'small', text: '나가기', onclick: function () { ssDel(KEYS.teacherPw); go('/'); } }));
      }
    } else if (student && path.indexOf('/class') === 0) {
      $topRight.appendChild(h('span', { class: 'chip', text: student.className + ' · ' + student.no + '번 ' + student.name }));
      $topRight.appendChild(h('button', { class: 'small', text: '나가기', onclick: function () { lsDel(KEYS.student); go('/'); } }));
    } else {
      $topRight.appendChild(h('a', { href: '#/teacher', class: 'btn small ghost', text: '교사 모드', style: 'color:#fff;border-color:rgba(255,255,255,.6)' }));
    }
  }

  // ───────────────────────────────────────────
  // 홈 (학생 입장)
  // ───────────────────────────────────────────
  function viewHome() {
    var student = getStudent();
    if (student) { go('/class'); return; }

    var pendCode = lsGet(KEYS.pendCode, '');
    var hasApi = !!lsGet(KEYS.apiId, '');

    var inCode = h('input', { type: 'text', placeholder: '예: ABC234', maxlength: '6', autocapitalize: 'characters', value: pendCode, style: 'letter-spacing:3px;text-transform:uppercase;font-weight:700' });
    var inNo = h('input', { type: 'text', inputmode: 'numeric', placeholder: '예: 12' });
    var inName = h('input', { type: 'text', placeholder: '예: 김글숲' });
    var btn = h('button', { class: 'big', text: '글숲에 들어가기 🌳' });

    function join() {
      var code = inCode.value.trim().toUpperCase();
      var no = inNo.value.trim();
      var name = inName.value.trim();
      if (!code) return toast('학급 코드를 입력해 주세요.', true);
      if (!no || !name) return toast('번호와 이름을 입력해 주세요.', true);
      if (!hasApi) return toast('선생님이 보내 준 학급 링크로 들어와야 해요.', true);
      setBusy(btn, true, '확인하는 중…');
      api('student.join', { code: code, no: no, name: name })
        .then(function (d) {
          lsSet(KEYS.student, JSON.stringify({ classId: d.classId, className: d.className, grade: d.grade, no: d.student.no, name: d.student.name, code: code }));
          lsDel(KEYS.pendCode);
          toast('환영해요, ' + d.student.name + '!');
          go('/class');
        })
        .catch(function (e) { toast(e.message, true); })
        .then(function () { setBusy(btn, false); });
    }
    btn.addEventListener('click', join);
    [inCode, inNo, inName].forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') join(); }); });

    var hero = h('div', { class: 'hero' }, [
      h('h1', { text: '🌳 글숲' }),
      h('p', { text: '내가 쓴 글이 자라는 곳' })
    ]);

    var card = h('div', { class: 'card' }, [
      h('h2', { text: '우리 반에 들어가기' }),
      h('p', { class: 'desc', text: '선생님이 알려 준 학급 코드와 내 번호, 이름을 적어 주세요.' }),
      h('label', { text: '학급 코드' }), inCode,
      h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '번호' }), inNo]),
        h('div', {}, [h('label', { text: '이름' }), inName])
      ]),
      btn,
      !hasApi ? h('p', { class: 'hint center', text: '아직 서버가 연결되지 않았어요. 선생님이 보내 준 학급 링크(QR)로 들어오면 자동으로 연결돼요.' }) : null
    ]);

    render(hero, card);
    (pendCode ? inNo : inCode).focus();
  }

  // ───────────────────────────────────────────
  // 학생 홈 — 열린 과제 목록
  // ───────────────────────────────────────────
  var studentTaskCache = {}; // taskId → task (상세 화면에서 재사용)

  function fetchStudentTasks() {
    var s = getStudent();
    return api('task.listForStudent', { classId: s.classId, code: s.code }).then(function (d) {
      studentTaskCache = {};
      d.tasks.forEach(function (t) { studentTaskCache[t.taskId] = t; });
      return d.tasks;
    });
  }

  function taskConditionText(t) {
    var parts = [];
    if (t.minChars && t.maxChars) parts.push(t.minChars + '~' + t.maxChars + '자');
    else if (t.minChars) parts.push(t.minChars + '자 이상');
    else if (t.maxChars) parts.push(t.maxChars + '자 이하');
    if (t.requiredWords && t.requiredWords.length) parts.push('꼭 쓸 낱말: ' + t.requiredWords.join(', '));
    return parts.join(' · ');
  }

  function viewStudentHome() {
    var s = getStudent();
    if (!s) { go('/'); return; }
    var list = h('div', { class: 'task-list' }, [h('div', { class: 'loading', text: '과제를 불러오는 중…' })]);
    var card = h('div', { class: 'card student-home' }, [
      h('div', { class: 'muted', text: s.className }),
      h('div', { class: 'greet', text: s.name + ' 님, 어서 와요! 🌱' }),
      list
    ]);
    render(card);

    fetchStudentTasks()
      .then(function (tasks) {
        clear(list);
        if (!tasks.length) {
          list.appendChild(h('div', { class: 'empty' }, [
            h('span', { class: 'big-emoji', text: '✏️' }),
            '아직 글쓰기 과제가 없어요.',
            h('br'),
            h('span', { class: 'muted', text: '선생님이 과제를 올리면 여기에 나타나요.' })
          ]));
          return;
        }
        tasks.forEach(function (t) {
          list.appendChild(h('a', { href: '#/class/task/' + t.taskId, class: 'task-item' }, [
            h('div', {}, [
              h('span', { class: 'badge genre', text: t.genreLabel }),
              h('div', { class: 'task-title', text: t.title }),
              h('div', { class: 'task-meta', text: taskConditionText(t) || '분량 자유' })
            ]),
            h('div', { class: 'task-go', text: '글 쓰러 가기 →' })
          ]));
        });
      })
      .catch(function (e) {
        clear(list);
        list.appendChild(h('p', { class: 'bad', text: e.message }));
        if (/다시 들어와/.test(e.message)) { lsDel(KEYS.student); }
      });
  }

  // ───────────────────────────────────────────
  // 학생: 과제 상세 + 글쓰기 편집기
  // ───────────────────────────────────────────
  function countChars(text) { return String(text || '').replace(/\r\n/g, '\n').trim().length; }

  function studentPayload(extra) {
    var s = getStudent();
    return Object.assign({ classId: s.classId, code: s.code, no: s.no, name: s.name }, extra || {});
  }

  function draftKey(taskId) { var s = getStudent(); return 'geulsup_draft_' + s.classId + '_' + s.no + '_' + taskId; }

  function conditionChecks(t, text) {
    var n = countChars(text);
    var items = [];
    if (t.minChars) items.push({ ok: n >= t.minChars, text: t.minChars + '자 이상' });
    if (t.maxChars) items.push({ ok: n <= t.maxChars, text: t.maxChars + '자 이하' });
    (t.requiredWords || []).forEach(function (w) { items.push({ ok: text.indexOf(w) >= 0, text: '"' + w + '" 쓰기' }); });
    return items;
  }

  function fmtTime(str) {
    // '2026-10-21 09:41:03' → '10/21 09:41'
    var m = String(str || '').match(/^\d{4}-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    return m ? (Number(m[1]) + '/' + Number(m[2]) + ' ' + m[3] + ':' + m[4]) : String(str || '');
  }

  function viewStudentTask(taskId) {
    var s = getStudent();
    if (!s) { go('/'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '과제를 불러오는 중…' })]));

    var ready = studentTaskCache[taskId] ? Promise.resolve(studentTaskCache[taskId])
      : fetchStudentTasks().then(function () { return studentTaskCache[taskId]; });

    ready.then(function (t) {
      if (!t) throw new Error('이 과제는 지금 볼 수 없어요. 선생님께 여쭤보세요.');
      return api('submission.mine', studentPayload({ taskId: taskId })).then(function (mine) { buildStudentTask(t, mine); });
    }).catch(function (e) {
      if (/다시 들어와/.test(e.message)) lsDel(KEYS.student);
      render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/class', class: 'btn ghost small', text: '← 과제 목록' })]));
    });
  }

  function buildStudentTask(t, mine) {
    var taskId = t.taskId;
    var header = h('div', { class: 'card' }, [
      h('span', { class: 'badge genre', text: t.genreLabel }),
      h('h2', { text: t.title, style: 'margin-top:8px' }),
      h('div', { class: 'prompt-box', text: t.prompt }),
      h('div', { class: 'chips', style: 'margin-top:6px' }, [h('span', { class: 'muted', text: '선생님이 보는 기준: ' })].concat(t.criteriaNames.map(function (n) { return h('span', { class: 'badge', text: n }); })))
    ]);

    // ── 제출됐지만 아직 피드백이 없는 상태 (AI 실패 등) → 다시 요청 ──
    if (mine.locked) {
      var last = mine.submitted[mine.submitted.length - 1];
      var btnFb = h('button', { class: 'big', text: '피드백 받기 🤖' });
      btnFb.addEventListener('click', function () {
        setBusy(btnFb, true, 'AI가 글을 읽는 중… (30초쯤 걸려요)');
        api('feedback.request', studentPayload({ taskId: taskId, submissionId: last.submissionId }))
          .then(function () { toast('피드백이 도착했어요!'); viewStudentTask(taskId); })
          .catch(function (e) { toast(e.message, true); setBusy(btnFb, false); });
      });
      var done = h('div', { class: 'card' }, [
        h('div', { class: 'submitted-banner' }, [
          h('span', { class: 'big-emoji', text: '🌿' }),
          h('div', {}, [
            h('div', { style: 'font-weight:700;font-size:17px', text: last.round + '차 글을 제출했어요!' }),
            h('div', { class: 'muted', text: fmtTime(last.submittedAt) + ' · ' + last.charCount + '자 · 아직 피드백이 만들어지지 않았어요. 아래 버튼을 눌러 보세요.' })
          ])
        ]),
        btnFb,
        last.title ? h('h3', { text: last.title }) : null,
        h('div', { class: 'essay-view', text: last.text }),
        h('div', { class: 'actions' }, [h('a', { href: '#/class', class: 'btn ghost small', text: '← 과제 목록' })])
      ]);
      render(header, done);
      return;
    }

    // ── 최근 피드백 (고쳐 쓰기 전에 보여 줌) ──
    var latestSub = mine.submitted.length ? mine.submitted[mine.submitted.length - 1] : null;
    var fbCard = latestSub && latestSub.feedback ? renderFeedback(latestSub.feedback, latestSub, { forStudent: true }) : null;

    // ── 차수 제한에 도달: 더 쓸 수 없음 ──
    if (mine.finished) {
      var fin = h('div', { class: 'card' }, [
        h('div', { class: 'submitted-banner' }, [
          h('span', { class: 'big-emoji', text: '🏁' }),
          h('div', {}, [
            h('div', { style: 'font-weight:700;font-size:17px', text: mine.maxRounds + '차까지 모두 마쳤어요! 수고했어요.' }),
            h('div', { class: 'muted', text: '이 과제는 ' + mine.maxRounds + '차까지 쓸 수 있어요. 아래에서 지금까지 쓴 글과 피드백을 다시 볼 수 있어요.' })
          ])
        ]),
        h('div', { class: 'actions' }, [h('a', { href: '#/class', class: 'btn ghost small', text: '← 과제 목록' })])
      ]);
      var hist = h('div', { class: 'card' }, [h('h3', { text: '내가 쓴 글', style: 'margin-top:0' })].concat(mine.submitted.map(function (sv) {
        return h('details', { class: 'prev-round' }, [
          h('summary', { text: sv.round + '차 · ' + fmtTime(sv.submittedAt) + ' · ' + sv.charCount + '자' + (sv.feedback ? ' · ' + levelSummary(sv.feedback) : '') }),
          h('div', { class: 'essay-view', text: sv.text })
        ]);
      })));
      render(header, fin, fbCard, hist);
      return;
    }

    // ── 편집기 ──
    var local = null;
    try { local = JSON.parse(lsGet(draftKey(taskId), 'null')); } catch (e) { local = null; }
    var draft = mine.draft || { title: '', text: '', savedAt: '' };
    var prefilled = false;
    if (!mine.draft && latestSub && mine.nextRound > 1) {
      // 고쳐 쓰기: 이전 글을 그대로 가져와 고치게 함 (입력해야 저장됨)
      draft = { title: latestSub.title || '', text: latestSub.text || '', savedAt: '' };
      prefilled = true;
    }
    // 서버 저장본보다 이 기기의 임시본이 더 최근이면 그걸 씁니다 (전송 실패 대비)
    if (local && local.at && (!draft.savedAt || local.at > draft.savedAt) && (local.text !== draft.text || local.title !== draft.title)) {
      draft = { title: local.title || '', text: local.text || '', savedAt: draft.savedAt };
    }

    var inTitle = h('input', { type: 'text', placeholder: '제목 (안 써도 돼요)', value: draft.title, maxlength: '100', class: 'essay-title' });
    var ta = h('textarea', { class: 'essay-editor', placeholder: '여기에 글을 써요. 쓰는 동안 자동으로 저장돼요.', spellcheck: 'false' });
    ta.value = draft.text;
    var counter = h('span', { class: 'char-count', text: '0자' });
    var saveState = h('span', { class: 'save-state', text: draft.savedAt ? '저장됨 ' + fmtTime(draft.savedAt) : '' });
    var condBox = h('div', { class: 'cond-list' });
    var btnSave = h('button', { class: 'small secondary', text: '지금 저장' });
    var btnSubmit = h('button', { class: 'big', text: '제출하기 🌳' });

    var dirty = false, saving = false, timer = null, lastSent = prefilled ? { title: null, text: null } : { title: draft.title, text: draft.text };

    function refresh() {
      var text = ta.value;
      var n = countChars(text);
      counter.textContent = n + '자' + (t.minChars || t.maxChars ? ' / ' + (t.minChars && t.maxChars ? t.minChars + '~' + t.maxChars : t.minChars ? t.minChars + '자 이상' : t.maxChars + '자 이하') : '');
      clear(condBox);
      var checks = conditionChecks(t, text);
      checks.forEach(function (c) { condBox.appendChild(h('span', { class: 'cond ' + (c.ok ? 'ok' : ''), text: (c.ok ? '✅ ' : '⬜ ') + c.text })); });
      var allOk = checks.every(function (c) { return c.ok; }) && n > 0;
      btnSubmit.disabled = !allOk;
      btnSubmit.title = allOk ? '' : '조건을 모두 채우면 제출할 수 있어요';
    }

    function localSave() {
      lsSet(draftKey(taskId), JSON.stringify({ title: inTitle.value, text: ta.value, at: nowIso() }));
    }
    function nowIso() {
      var d = new Date(); function p(x) { return (x < 10 ? '0' : '') + x; }
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function serverSave(manual) {
      if (saving) { dirty = true; return Promise.resolve(); }
      var payload = { title: inTitle.value.trim(), text: ta.value };
      if (!manual && payload.title === lastSent.title && payload.text === lastSent.text) return Promise.resolve();
      saving = true; dirty = false;
      saveState.textContent = '저장 중…';
      return api('submission.saveDraft', studentPayload({ taskId: taskId, title: payload.title, text: payload.text }))
        .then(function (d) {
          lastSent = payload;
          saveState.textContent = '저장됨 ' + fmtTime(d.savedAt);
          saveState.className = 'save-state';
          if (manual) toast('저장했어요.');
        })
        .catch(function (e) {
          saveState.textContent = '저장 실패 — 이 기기에는 남아 있어요';
          saveState.className = 'save-state bad';
          if (manual) toast(e.message, true);
          if (/이미 제출/.test(e.message)) { lsDel(draftKey(taskId)); viewStudentTask(taskId); }
        })
        .then(function () { saving = false; if (dirty) { dirty = false; scheduleSave(); } });
    }
    function scheduleSave() { clearTimeout(timer); timer = setTimeout(function () { serverSave(false); }, 2500); }
    function onInput() { refresh(); localSave(); scheduleSave(); }
    ta.addEventListener('input', onInput);
    inTitle.addEventListener('input', onInput);
    btnSave.addEventListener('click', function () { clearTimeout(timer); serverSave(true); });

    btnSubmit.addEventListener('click', function () {
      var text = ta.value;
      var n = countChars(text);
      if (!n) return toast('글을 써 주세요.', true);
      var bad = conditionChecks(t, text).filter(function (c) { return !c.ok; });
      if (bad.length) return toast('아직 채우지 못한 조건이 있어요: ' + bad.map(function (c) { return c.text; }).join(', '), true);
      if (!confirm('제출하면 피드백을 받을 때까지 고칠 수 없어요.\n' + n + '자 · 제출할까요?')) return;
      clearTimeout(timer);
      setBusy(btnSubmit, true, '제출하는 중…');
      setBusy(btnSubmit, true, '제출하고 AI가 글을 읽는 중… (30초쯤 걸려요)');
      api('submission.submit', studentPayload({ taskId: taskId, title: inTitle.value.trim(), text: text }))
        .then(function (d) {
          lsDel(draftKey(taskId));
          if (d.feedback) toast('제출했어요! 피드백이 도착했어요 🌳');
          else toast('제출했어요. 피드백은 조금 뒤에 다시 받아 보세요. ' + (d.feedbackError || ''), true);
          viewStudentTask(taskId);
        })
        .catch(function (e) { toast(e.message, true); setBusy(btnSubmit, false); refresh(); });
    });

    // 화면을 떠날 때 마지막 저장 시도
    window.onbeforeunload = function () { if (ta.value !== lastSent.text || inTitle.value.trim() !== lastSent.title) { localSave(); serverSave(false); } };
    window.addEventListener('hashchange', function once() { window.removeEventListener('hashchange', once); window.onbeforeunload = null; clearTimeout(timer); if (ta.value !== lastSent.text || inTitle.value.trim() !== lastSent.title) serverSave(false); });

    var roundLabel = (mine.nextRound > 1 ? mine.nextRound + '차 · 고쳐 쓰기 ✍️' : '글쓰기') + (mine.maxRounds ? ' (' + mine.maxRounds + '차까지)' : '');
    var editor = h('div', { class: 'card' }, [
      h('div', { class: 'row', style: 'align-items:center' }, [
        h('h2', { text: roundLabel, style: 'margin:0' }),
        h('div', { class: 'fit editor-status' }, [counter, saveState])
      ]),
      prefilled ? h('p', { class: 'hint', text: '이전에 쓴 글을 그대로 가져왔어요. 피드백을 보고 고쳐서 다시 제출해 보세요.' }) : null,
      inTitle,
      ta,
      condBox,
      h('div', { class: 'actions', style: 'justify-content:space-between' }, [
        btnSave,
        h('a', { href: '#/class', class: 'btn ghost small', text: '← 과제 목록' })
      ]),
      btnSubmit
    ]);

    // 이전 차수 글 (고쳐 쓰기일 때)
    var prev = null;
    if (mine.submitted.length) {
      prev = h('div', { class: 'card' }, [h('h3', { text: '이전에 제출한 글', style: 'margin-top:0' })].concat(mine.submitted.map(function (sv) {
        return h('details', { class: 'prev-round' }, [
          h('summary', { text: sv.round + '차 · ' + fmtTime(sv.submittedAt) + ' · ' + sv.charCount + '자' + (sv.feedback ? ' · ' + levelSummary(sv.feedback) : '') }),
          h('div', { class: 'essay-view', text: sv.text })
        ]);
      })));
    }

    render(header, fbCard, editor, prev);
    refresh();
    if (!draft.text) ta.focus();
  }

  // ───────────────────────────────────────────
  // 교사: 설정 + 로그인
  // ───────────────────────────────────────────
  function viewTeacher() {
    var apiId = lsGet(KEYS.apiId, '');
    if (apiId && ssGet(KEYS.teacherPw)) { go('/teacher/classes'); return; }

    // 1) 서버 연결
    var inUrl = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/AKfy…/exec', value: apiId ? apiUrl(apiId) : '' });
    var btnTest = h('button', { text: '연결 테스트', class: 'fit' });
    var connStatus = h('div', { class: 'hint', text: apiId ? '등록된 서버가 있어요. 바꾸려면 새 URL을 넣고 테스트하세요.' : '' });

    btnTest.addEventListener('click', function () {
      var id = extractDeployId(inUrl.value);
      if (!id) return toast('웹 앱 URL(…/exec) 형식이 아니에요.', true);
      lsSet(KEYS.apiId, id);
      setBusy(btnTest, true, '확인 중…');
      api('ping')
        .then(function (d) {
          connStatus.textContent = '✅ 연결 성공 — ' + d.app + ' 서버 v' + d.version;
          connStatus.className = 'hint ok';
          toast('서버와 연결됐어요!');
        })
        .catch(function (e) {
          connStatus.textContent = '❌ ' + e.message;
          connStatus.className = 'hint bad';
        })
        .then(function () { setBusy(btnTest, false); });
    });

    // 2) 로그인
    var inPw = h('input', { type: 'password', placeholder: '설정 시트에 적은 교사 비밀번호', autocomplete: 'current-password' });
    var btnLogin = h('button', { class: 'big', text: '교사 모드 들어가기' });
    function login() {
      if (!lsGet(KEYS.apiId, '')) return toast('먼저 서버 URL을 등록하고 연결 테스트를 해 주세요.', true);
      if (!inPw.value) return toast('비밀번호를 입력해 주세요.', true);
      setBusy(btnLogin, true, '확인 중…');
      ssSet(KEYS.teacherPw, inPw.value);
      teacherApi('teacher.login')
        .then(function (d) {
          if (d.genres && d.genres.length) GENRES = d.genres;
          toast((d.teacher.name ? d.teacher.name + ' 선생님, ' : '') + '환영합니다!');
          go('/teacher/classes');
        })
        .catch(function (e) { ssDel(KEYS.teacherPw); toast(e.message, true); setBusy(btnLogin, false); });
    }
    btnLogin.addEventListener('click', login);
    inPw.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') login(); });

    var guide = h('div', { class: 'card' }, [
      h('h2', { text: '처음 설정하기' }),
      h('p', { class: 'desc', text: '글숲은 선생님의 구글 스프레드시트가 서버가 되어요. 한 번만 해 두면 됩니다.' }),
      h('ol', { class: 'steps' }, [
        h('li', { html: '글숲 <b>스프레드시트 사본</b>을 내 드라이브에 만듭니다.' }),
        h('li', { html: '시트 메뉴 <b>🌳 글숲 → 시트 초기화</b>를 실행합니다.' }),
        h('li', { html: '<b>설정</b> 시트의 노란 칸에 Gemini API 키와 교사 비밀번호를 적습니다.' }),
        h('li', { html: '확장 프로그램 → Apps Script → <b>배포 → 새 배포 → 웹 앱</b> (실행: 나 / 액세스: <b>모든 사용자</b>)' }),
        h('li', { html: '나온 <b>웹 앱 URL</b>을 아래에 붙여 넣고 연결 테스트 → 비밀번호로 들어옵니다.' })
      ])
    ]);

    var connect = h('div', { class: 'card' }, [
      h('h2', { text: '1. 서버 연결' }),
      h('label', { text: '웹 앱 URL' }),
      h('div', { class: 'row' }, [inUrl, btnTest]),
      connStatus
    ]);

    var loginCard = h('div', { class: 'card' }, [
      h('h2', { text: '2. 교사 로그인' }),
      h('label', { text: '교사 비밀번호' }), inPw,
      btnLogin,
      h('p', { class: 'hint', text: '비밀번호는 이 브라우저를 닫으면 지워져요. 학생이 쓰는 기기에서는 로그인하지 마세요.' })
    ]);

    render(guide, connect, loginCard);
  }

  // ───────────────────────────────────────────
  // 교사: 학급 목록
  // ───────────────────────────────────────────
  function viewClasses() {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }

    var list = h('div', { class: 'class-list' }, [h('div', { class: 'loading', text: '학급을 불러오는 중…' })]);
    var statusBox = h('ul', { class: 'status-list' });

    var card = h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('div', {}, [h('h2', { text: '내 학급' }), h('p', { class: 'desc', text: '학급을 만들고 학생들에게 링크나 QR을 나눠 주세요.' })]),
        h('a', { href: '#/teacher/new', class: 'btn fit', text: '+ 새 학급 만들기' })
      ]),
      list
    ]);

    var setup = h('div', { class: 'card' }, [
      h('h2', { text: '서버 상태' }),
      statusBox,
      h('div', { class: 'actions' }, [
        h('button', { class: 'ghost small', text: '서버 설정 바꾸기', onclick: function () { ssDel(KEYS.teacherPw); go('/teacher'); } })
      ])
    ]);

    render(card, setup);

    teacherApi('class.list')
      .then(function (d) {
        clear(list);
        if (!d.classes.length) {
          list.appendChild(h('div', { class: 'empty' }, [h('span', { class: 'big-emoji', text: '🌱' }), '아직 학급이 없어요. 첫 학급을 만들어 보세요!']));
          return;
        }
        d.classes.forEach(function (c) {
          var archived = c.status !== '활성';
          list.appendChild(h('div', { class: 'class-item' + (archived ? ' archived' : '') }, [
            h('div', {}, [
              h('div', { class: 'name' }, [c.name + ' ', h('span', { class: 'badge' + (archived ? ' off' : ''), text: archived ? '보관' : '활성' })]),
              h('div', { class: 'meta', text: c.grade + '학년 · 학생 ' + c.studentCount + '명 · 과제 ' + (c.taskCount || 0) + '개 · ' + String(c.createdAt).slice(0, 10) }),
              h('div', { class: 'code', text: c.code })
            ]),
            h('div', { class: 'btns' }, [
              h('a', { href: '#/teacher/class/' + c.classId + '/tasks', class: 'btn small', text: '✏️ 과제' }),
              h('a', { href: '#/teacher/class/' + c.classId, class: 'btn small secondary', text: '링크·QR·명단' })
            ])
          ]));
        });
      })
      .catch(function (e) { clear(list); list.appendChild(h('p', { class: 'bad', text: e.message })); });

    var versionLine = h('li', { style: 'display:none' });
    statusBox.appendChild(versionLine);
    api('ping').then(function (d) {
      var sv = String(d.version || '?');
      if (sv !== APP_VERSION) {
        versionLine.style.display = '';
        versionLine.appendChild(h('span', { class: 'bad', text: '⚠️' }));
        versionLine.appendChild(h('span', {}, [
          ' 서버 v' + sv + ' / 화면 v' + APP_VERSION + ' — 버전이 달라요. Apps Script에서 Code.gs를 교체한 뒤 ',
          h('b', { text: '배포 관리 → 편집 → 새 버전 → 배포' }),
          '를 해 주세요.'
        ]));
      }
    }).catch(function () { /* 상태 카드에서 따로 표시됨 */ });

    teacherApi('teacher.status')
      .then(function (d) {
        var keepVersion = versionLine;
        clear(statusBox);
        statusBox.appendChild(keepVersion);
        statusBox.appendChild(h('li', {}, [h('span', { class: d.checks.sheets ? 'ok' : 'bad', text: d.checks.sheets ? '✅' : '❌' }), ' 시트 초기화 ' + (d.checks.sheets ? '완료' : '필요 (메뉴 → 시트 초기화)')]));
        statusBox.appendChild(h('li', {}, [h('span', { class: d.checks.apiKey ? 'ok' : 'bad', text: d.checks.apiKey ? '✅' : '❌' }), ' Gemini API 키 ' + (d.checks.apiKey ? '등록됨 (' + d.teacher.model + ')' : '없음 — 설정 시트에 입력하세요')]));
        statusBox.appendChild(h('li', {}, [h('span', { class: 'ok', text: '✅' }), ' 교사 비밀번호 설정됨']));
        statusBox.appendChild(h('li', {}, [h('span', { class: d.checks.rubrics ? 'ok' : 'bad', text: d.checks.rubrics ? '✅' : '❌' }), ' 기본 루브릭 ' + (d.checks.rubrics ? '준비됨 (루브릭 시트에서 문구 수정 가능)' : '없음 — 시트 메뉴 → 기본 루브릭 다시 넣기')]));
        if (d.checks.apiKey) {
          var aiLine = h('span', { class: 'muted', text: '' });
          var btnAi = h('button', { class: 'small secondary', text: 'AI 연결 테스트', onclick: function () {
            setBusy(btnAi, true, '확인 중…');
            teacherApi('ai.test')
              .then(function (r) { aiLine.textContent = '✅ ' + r.model + ' 응답: "' + r.reply + '" (' + (r.ms / 1000).toFixed(1) + '초)'; })
              .catch(function (e) { aiLine.textContent = '❌ ' + e.message; aiLine.className = 'bad'; })
              .then(function () { setBusy(btnAi, false); });
          } });
          statusBox.appendChild(h('li', {}, [btnAi, aiLine]));
        }
        if (d.teacher.name || d.teacher.school) {
          statusBox.appendChild(h('li', {}, [h('span', { class: 'muted', text: '👩‍🏫 ' + [d.teacher.school, d.teacher.name].filter(Boolean).join(' · ') })]));
        }
      })
      .catch(function (e) { clear(statusBox); statusBox.appendChild(h('li', { class: 'bad', text: e.message })); });
  }

  // ───────────────────────────────────────────
  // 교사: 학급 만들기 / 명단 수정
  // ───────────────────────────────────────────
  function parseRoster(text) {
    // 한 줄에 한 명: "12 김글숲" / "12, 김글숲" / "12. 김글숲" / "12\t김글숲" / 번호 없이 이름만 → 순서대로 번호
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var out = [];
    var auto = 1;
    lines.forEach(function (line) {
      var m = line.match(/^(\d+)\s*[.,:\t\-]?\s*(.+)$/);
      if (m) { out.push({ no: String(parseInt(m[1], 10)), name: m[2].trim() }); auto = parseInt(m[1], 10) + 1; }
      else { out.push({ no: String(auto++), name: line }); }
    });
    return out;
  }

  function viewClassForm(existing) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }

    var inName = h('input', { type: 'text', placeholder: '예: 4학년 2반', value: existing ? existing.name : '' });
    var sel = h('select', {}, [1, 2, 3, 4, 5, 6].map(function (g) {
      return h('option', { value: String(g), text: g + '학년', selected: existing && String(existing.grade) === String(g) ? 'selected' : null });
    }));
    if (!existing) sel.value = '4';
    var inRoster = h('textarea', { placeholder: '1 김글숲\n2 이나무\n3 박새싹\n…\n\n(번호 없이 이름만 적으면 순서대로 번호가 붙어요)' });
    if (existing && existing.students) inRoster.value = existing.students.map(function (s) { return s.no + ' ' + s.name; }).join('\n');
    var preview = h('p', { class: 'hint', text: '' });
    inRoster.addEventListener('input', function () {
      var r = parseRoster(inRoster.value);
      preview.textContent = r.length ? '학생 ' + r.length + '명 · ' + r.slice(0, 3).map(function (s) { return s.no + '번 ' + s.name; }).join(', ') + (r.length > 3 ? ' …' : '') : '';
    });
    inRoster.dispatchEvent(new Event('input'));

    var btn = h('button', { class: 'big', text: existing ? '명단 저장하기' : '학급 만들기 🌳' });
    btn.addEventListener('click', function () {
      var students = parseRoster(inRoster.value);
      if (!existing && !inName.value.trim()) return toast('학급 이름을 입력해 주세요.', true);
      if (!students.length) return toast('학생 명단을 입력해 주세요.', true);
      setBusy(btn, true, '저장 중…');
      var p = existing
        ? teacherApi('student.set', { classId: existing.classId, students: students })
        : teacherApi('class.create', { name: inName.value.trim(), grade: sel.value, students: students });
      p.then(function (d) {
        toast(existing ? '명단을 저장했어요.' : '학급을 만들었어요! 코드: ' + d.code);
        go('/teacher/class/' + (existing ? existing.classId : d.classId));
      })
        .catch(function (e) { toast(e.message, true); setBusy(btn, false); });
    });

    var card = h('div', { class: 'card' }, [
      h('h2', { text: existing ? '학생 명단 수정' : '새 학급 만들기' }),
      h('p', { class: 'desc', text: existing ? '명단을 통째로 다시 저장해요. 빠진 학생은 더 이상 들어올 수 없어요.' : '학생은 번호와 이름으로 들어와요. 명단에 있는 학생만 입장할 수 있어요.' }),
      existing ? null : h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '학급 이름' }), inName]),
        h('div', { class: 'fit', style: 'min-width:120px' }, [h('label', { text: '학년' }), sel])
      ]),
      h('label', { text: '학생 명단 (한 줄에 한 명)' }), inRoster, preview,
      btn,
      h('div', { class: 'actions' }, [
        h('a', { href: existing ? '#/teacher/class/' + existing.classId : '#/teacher/classes', class: 'btn ghost small', text: '← 돌아가기' })
      ])
    ]);
    render(card);
    (existing ? inRoster : inName).focus();
  }

  // ───────────────────────────────────────────
  // 교사: 학급 상세 (링크 · QR · 명단 · 상태)
  // ───────────────────────────────────────────
  function studentLink(code) {
    var base = location.origin + location.pathname;
    return base + '?s=' + encodeURIComponent(lsGet(KEYS.apiId, '')) + '&c=' + encodeURIComponent(code);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast('복사했어요!'); }, function () { toast('복사에 실패했어요. 직접 드래그해서 복사해 주세요.', true); });
    }
    toast('이 브라우저는 자동 복사가 안 돼요. 직접 드래그해서 복사해 주세요.', true);
    return Promise.resolve();
  }

  function viewClassDetail(classId) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }
    var holder = h('div', {}, [h('div', { class: 'loading', text: '학급 정보를 불러오는 중…' })]);
    render(holder);

    Promise.all([teacherApi('class.list'), teacherApi('student.list', { classId: classId })])
      .then(function (res) {
        var cls = res[0].classes.filter(function (c) { return c.classId === classId; })[0];
        var students = res[1].students;
        if (!cls) throw new Error('학급을 찾을 수 없어요.');
        var archived = cls.status !== '활성';
        var link = studentLink(cls.code);

        var qrBox = h('div', { class: 'qr-wrap' });
        var share = h('div', { class: 'share-box' }, [
          h('div', { style: 'font-weight:700;margin-bottom:8px', text: '학생 입장 링크' }),
          h('div', { class: 'link', text: link }),
          h('div', { class: 'actions', style: 'margin-top:10px' }, [
            h('button', { class: 'small', text: '링크 복사', onclick: function () { copyText(link); } }),
            h('button', { class: 'small secondary', text: '코드만 복사', onclick: function () { copyText(cls.code); } }),
            h('button', { class: 'small secondary', text: 'QR 보기/숨기기', onclick: function () { qrBox.style.display = qrBox.style.display === 'none' ? 'flex' : 'none'; } })
          ]),
          qrBox,
          h('p', { class: 'hint', text: '링크로 들어오면 서버 연결과 학급 코드가 자동으로 채워져요. 학생은 번호와 이름만 적으면 돼요.' })
        ]);
        try {
          /* global QRCode */
          new QRCode(qrBox, { text: link, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
        } catch (e) {
          qrBox.appendChild(h('span', { class: 'muted', text: 'QR을 만들 수 없어요 (인터넷 연결 확인).' }));
        }

        var rosterList = h('div', { class: 'muted', style: 'line-height:2' }, students.map(function (s) {
          return h('span', { class: 'badge', style: 'margin:0 6px 6px 0;display:inline-block', text: s.no + ' ' + s.name });
        }));

        var card = h('div', { class: 'card' }, [
          h('div', { class: 'row' }, [
            h('div', {}, [
              h('h2', {}, [cls.name + ' ', h('span', { class: 'badge' + (archived ? ' off' : ''), text: archived ? '보관' : '활성' })]),
              h('p', { class: 'desc', text: cls.grade + '학년 · 학생 ' + students.length + '명' })
            ]),
            h('div', { class: 'code fit', text: cls.code })
          ]),
          share,
          h('h3', { text: '학생 명단' }),
          rosterList,
          h('div', { class: 'actions' }, [
            h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' }),
            h('a', { href: '#/teacher/class/' + cls.classId + '/tasks', class: 'btn small', text: '✏️ 과제 관리' }),
            h('button', { class: 'small secondary', text: '명단 수정', onclick: function () { viewClassForm({ classId: cls.classId, name: cls.name, grade: cls.grade, students: students }); } }),
            h('button', { class: 'small ' + (archived ? 'secondary' : 'danger'), text: archived ? '다시 열기' : '학급 보관(닫기)', onclick: function (ev) {
              var b = ev.currentTarget;
              setBusy(b, true);
              teacherApi('class.setStatus', { classId: cls.classId, status: archived ? '활성' : '보관' })
                .then(function () { toast(archived ? '학급을 다시 열었어요.' : '학급을 보관했어요. 학생은 들어올 수 없어요.'); viewClassDetail(classId); })
                .catch(function (e) { toast(e.message, true); setBusy(b, false); });
            } })
          ])
        ]);
        render(card);
      })
      .catch(function (e) { render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' })])); });
  }

  // ───────────────────────────────────────────
  // 교사: 과제 목록
  // ───────────────────────────────────────────
  var classCache = {}; // classId → class (목록에서 채움)

  function getClass(classId) {
    if (classCache[classId]) return Promise.resolve(classCache[classId]);
    return teacherApi('class.list').then(function (d) {
      d.classes.forEach(function (c) { classCache[c.classId] = c; });
      if (!classCache[classId]) throw new Error('학급을 찾을 수 없어요.');
      return classCache[classId];
    });
  }

  function viewTasks(classId) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }
    var list = h('div', { class: 'task-list' }, [h('div', { class: 'loading', text: '과제를 불러오는 중…' })]);
    var title = h('h2', { text: '과제' });
    var desc = h('p', { class: 'desc', text: '' });
    var card = h('div', { class: 'card' }, [
      h('div', { class: 'row' }, [
        h('div', {}, [title, desc]),
        h('a', { href: '#/teacher/class/' + classId + '/tasks/new', class: 'btn fit', text: '+ 새 과제' })
      ]),
      list,
      h('div', { class: 'actions' }, [h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' })])
    ]);
    render(card);

    Promise.all([getClass(classId), teacherApi('task.list', { classId: classId })])
      .then(function (res) {
        var cls = res[0];
        var tasks = res[1].tasks;
        title.textContent = cls.name + ' · 과제';
        desc.textContent = cls.grade + '학년 · 학생 ' + cls.studentCount + '명 · 열린 과제는 학생 화면에 바로 보여요.';
        clear(list);
        if (!tasks.length) {
          list.appendChild(h('div', { class: 'empty' }, [h('span', { class: 'big-emoji', text: '✏️' }), '아직 과제가 없어요. 첫 과제를 만들어 보세요!']));
          return;
        }
        tasks.forEach(function (t) {
          var closed = t.status !== '열림';
          var item = h('div', { class: 'task-item teacher' + (closed ? ' closed' : '') }, [
            h('div', {}, [
              h('span', { class: 'badge genre', text: t.genreLabel }),
              h('span', { class: 'badge' + (closed ? ' off' : ''), text: closed ? '닫힘' : '열림', style: 'margin-left:6px' }),
              h('div', { class: 'task-title', text: t.title }),
              h('div', { class: 'task-meta', text: bandLabel(t.band) + ' 기준 ' + t.criteria.length + '개 · ' + (taskConditionText(t) || '분량 자유') + ' · 고칠 곳 ' + (t.maxCorrections ? t.maxCorrections + '개' : '모두') + ' · ' + (t.maxRounds ? t.maxRounds + '차까지' : '차수 제한 없음') + ' · ' + String(t.createdAt).slice(0, 10) })
            ]),
            h('div', { class: 'btns' }, [
              h('a', { href: '#/teacher/class/' + classId + '/tasks/' + t.taskId + '/submissions', class: 'btn small', text: '📄 제출 ' + (t.submittedCount || 0) + (t.draftCount ? ' (+' + t.draftCount + ' 작성 중)' : '') }),
              h('a', { href: '#/teacher/class/' + classId + '/tasks/' + t.taskId, class: 'btn small secondary', text: '수정' }),
              h('button', { class: 'small ' + (closed ? 'secondary' : 'ghost'), text: closed ? '다시 열기' : '닫기', onclick: function (ev) {
                var b = ev.currentTarget; setBusy(b, true);
                teacherApi('task.setStatus', { taskId: t.taskId, status: closed ? '열림' : '닫힘' })
                  .then(function () { toast(closed ? '과제를 다시 열었어요.' : '과제를 닫았어요. 학생에게 보이지 않아요.'); viewTasks(classId); })
                  .catch(function (e) { toast(e.message, true); setBusy(b, false); });
              } })
            ])
          ]);
          list.appendChild(item);
        });
      })
      .catch(function (e) { clear(list); list.appendChild(h('p', { class: 'bad', text: e.message })); });
  }

  // ───────────────────────────────────────────
  // 교사: 과제 만들기 / 수정
  // ───────────────────────────────────────────
  function viewTaskForm(classId, taskId) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '불러오는 중…' })]));

    var loads = [getClass(classId)];
    if (taskId) loads.push(teacherApi('task.get', { taskId: taskId }));
    Promise.all(loads).then(function (res) {
      buildTaskForm(res[0], res[1] ? res[1].task : null);
    }).catch(function (e) {
      render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' })]));
    });
  }

  function buildTaskForm(cls, existing) {
    var classId = cls.classId;
    var state = {
      criteria: existing ? existing.criteria.map(cloneCriterion) : [],
      loadedKey: existing ? existing.genre + '|' + existing.band : ''
    };

    // ── 기본 정보 ──
    var inTitle = h('input', { type: 'text', placeholder: '예: 우리 학교 자랑거리 설명하기', value: existing ? existing.title : '' });
    var selGenre = h('select', {}, [h('option', { value: '', text: '갈래를 고르세요' })].concat(GENRES.map(function (g) {
      return h('option', { value: g.key, text: g.label });
    })));
    if (existing) selGenre.value = existing.genre;
    var selBand = h('select', {}, BANDS.map(function (b) { return h('option', { value: b.key, text: b.label + ' 기준' }); }));
    selBand.value = existing ? existing.band : bandForGrade(cls.grade);
    var inPrompt = h('textarea', { placeholder: GENRE_HINTS[selGenre.value] || '학생에게 보여 줄 글감·안내를 적어 주세요.' });
    if (existing) inPrompt.value = existing.prompt;
    var inMin = h('input', { type: 'text', inputmode: 'numeric', placeholder: '예: 300', value: existing && existing.minChars ? String(existing.minChars) : '' });
    var inMax = h('input', { type: 'text', inputmode: 'numeric', placeholder: '예: 800', value: existing && existing.maxChars ? String(existing.maxChars) : '' });
    var inWords = h('input', { type: 'text', placeholder: '예: 까닭, 예를 들어 (쉼표로 구분)', value: existing ? existing.requiredWords.join(', ') : '' });
    var selCorr = h('select', {}, [
      h('option', { value: '3', text: '3개까지' }),
      h('option', { value: '5', text: '5개까지' }),
      h('option', { value: '7', text: '7개까지 (기본)' }),
      h('option', { value: '10', text: '10개까지' }),
      h('option', { value: '0', text: '찾은 것 모두' })
    ]);
    selCorr.value = existing && existing.maxCorrections !== undefined ? String(existing.maxCorrections) : '7';
    if (![].slice.call(selCorr.options).some(function (o) { return o.value === selCorr.value; })) selCorr.value = '7';
    var selRounds = h('select', {}, [
      h('option', { value: '0', text: '제한 없음 (기본)' }),
      h('option', { value: '1', text: '1차만 (고쳐 쓰기 없음)' }),
      h('option', { value: '2', text: '2차까지' }),
      h('option', { value: '3', text: '3차까지' }),
      h('option', { value: '5', text: '5차까지' })
    ]);
    selRounds.value = existing && existing.maxRounds !== undefined ? String(existing.maxRounds) : '0';
    if (![].slice.call(selRounds.options).some(function (o) { return o.value === selRounds.value; })) selRounds.value = '0';

    // ── 기준 편집기 ──
    var critBox = h('div', { class: 'crit-list' });
    var critStatus = h('p', { class: 'hint', text: '' });

    function cloneCriterion(c) { return { id: c.id, name: c.name, group: c.group || '추가', levels: (c.levels || []).slice(0, 4).concat(['', '', '', '']).slice(0, 4) }; }

    function renderCriteria() {
      clear(critBox);
      if (!state.criteria.length) {
        critBox.appendChild(h('div', { class: 'empty', style: 'padding:22px' }, ['갈래를 고르면 기본 기준이 들어와요.']));
        critStatus.textContent = '';
        return;
      }
      state.criteria.forEach(function (c, idx) {
        var open = false;
        var body = h('div', { class: 'crit-body', style: 'display:none' });
        var nameIn = h('input', { type: 'text', value: c.name, placeholder: '기준 이름' });
        nameIn.addEventListener('input', function () { c.name = nameIn.value; head.textContent = (c.name || '(이름 없음)'); });
        var levelInputs = c.levels.map(function (l, li) {
          var ta = h('textarea', { rows: '2', placeholder: (li + 1) + '단계일 때의 글 모습', style: 'min-height:56px' });
          ta.value = l;
          ta.addEventListener('input', function () { c.levels[li] = ta.value; });
          return h('div', { class: 'level-row' }, [h('span', { class: 'level-no', text: (li + 1) + '단계' }), ta]);
        });
        body.appendChild(h('label', { text: '기준 이름' }));
        body.appendChild(nameIn);
        body.appendChild(h('label', { text: '단계별 서술 (AI는 이 문장을 기준으로 단계를 판단해요)' }));
        levelInputs.forEach(function (r) { body.appendChild(r); });
        body.appendChild(h('div', { class: 'actions', style: 'margin-top:8px' }, [
          h('button', { class: 'small danger', text: '이 기준 빼기', onclick: function () { state.criteria.splice(idx, 1); renderCriteria(); } })
        ]));

        var head = h('span', { class: 'crit-name', text: c.name || '(이름 없음)' });
        var toggle = h('button', { class: 'small ghost', text: '펼치기' });
        var row = h('div', { class: 'crit-item' }, [
          h('div', { class: 'crit-head' }, [
            h('span', { class: 'badge ' + (c.group === '공통' ? '' : c.group === '갈래' ? 'genre' : 'extra'), text: c.group }),
            head,
            h('span', { class: 'crit-preview', text: (c.levels[3] || '').slice(0, 40) + ((c.levels[3] || '').length > 40 ? '…' : '') }),
            toggle
          ]),
          body
        ]);
        toggle.addEventListener('click', function () { open = !open; body.style.display = open ? 'block' : 'none'; toggle.textContent = open ? '접기' : '펼치기'; });
        critBox.appendChild(row);
      });
      critStatus.textContent = '기준 ' + state.criteria.length + '개 · 공통 ' + state.criteria.filter(function (c) { return c.group === '공통'; }).length + ' · 갈래 ' + state.criteria.filter(function (c) { return c.group === '갈래'; }).length + ' · 추가 ' + state.criteria.filter(function (c) { return c.group !== '공통' && c.group !== '갈래'; }).length;
    }

    function loadDefaults(force) {
      var genre = selGenre.value, band = selBand.value;
      if (!genre) return;
      var key = genre + '|' + band;
      if (!force && key === state.loadedKey && state.criteria.length) return;
      if (!force && state.criteria.length && !confirm('갈래/학년군을 바꾸면 기준이 기본값으로 다시 채워져요. 지금 고친 내용은 사라집니다. 계속할까요?')) {
        return;
      }
      critStatus.textContent = '기본 기준을 불러오는 중…';
      clear(critBox);
      critBox.appendChild(h('div', { class: 'loading', text: '기본 기준을 불러오는 중…' }));
      teacherApi('rubric.defaults', { genre: genre, band: band })
        .then(function (d) {
          if (!d.criteria || !d.criteria.length) {
            throw new Error('루브릭 시트에서 "' + genreLabel(genre) + ' · ' + bandLabel(band) + '" 기준을 찾지 못했어요. 시트 메뉴 🌳 글숲 → "기본 루브릭 다시 넣기"를 실행한 뒤 다시 시도해 주세요.');
          }
          state.criteria = d.criteria.map(cloneCriterion);
          state.loadedKey = key;
          renderCriteria();
          toast(genreLabel(genre) + ' · ' + bandLabel(band) + ' 기본 기준을 불러왔어요.');
        })
        .catch(function (e) {
          // 토스트는 금방 사라지므로, 그 자리에 오류를 남기고 다시 시도할 수 있게 합니다
          var msg = e.message;
          if (/알 수 없는 요청/.test(msg)) msg = '서버가 아직 예전 버전이에요. Apps Script에서 Code.gs를 교체한 뒤 "배포 관리 → 편집 → 새 버전 → 배포"를 해 주세요. (' + msg + ')';
          clear(critBox);
          critBox.appendChild(h('div', { class: 'empty', style: 'padding:22px' }, [
            h('p', { class: 'bad', text: '기본 기준을 불러오지 못했어요.', style: 'margin:0 0 6px' }),
            h('p', { class: 'muted', text: msg, style: 'margin:0 0 12px' }),
            h('button', { class: 'small secondary', text: '다시 불러오기', onclick: function () { loadDefaults(true); } })
          ]));
          critStatus.textContent = '';
        });
    }

    selGenre.addEventListener('change', function () {
      if (!inPrompt.value.trim() || Object.keys(GENRE_HINTS).some(function (k) { return GENRE_HINTS[k] === inPrompt.placeholder; })) inPrompt.placeholder = GENRE_HINTS[selGenre.value] || '';
      loadDefaults(false);
    });
    selBand.addEventListener('change', function () { loadDefaults(false); });

    var btnAddCrit = h('button', { class: 'small secondary', text: '+ 기준 직접 추가', onclick: function () {
      state.criteria.push({ id: 'X' + Date.now().toString(36), name: '', group: '추가', levels: ['', '', '', ''] });
      renderCriteria();
      var items = critBox.querySelectorAll('.crit-item');
      var last = items[items.length - 1];
      if (last) { last.querySelector('.crit-head button').click(); last.querySelector('input').focus(); }
    } });
    var btnReload = h('button', { class: 'small ghost', text: '기본값으로 되돌리기', onclick: function () { if (!selGenre.value) return toast('먼저 갈래를 고르세요.', true); if (confirm('지금 기준을 모두 버리고 기본 기준으로 되돌릴까요?')) loadDefaults(true); } });

    // ── 저장 ──
    var btnSave = h('button', { class: 'big', text: existing ? '과제 저장하기' : '과제 만들기 ✏️' });
    btnSave.addEventListener('click', function () {
      var payload = {
        classId: classId,
        title: inTitle.value.trim(),
        genre: selGenre.value,
        band: selBand.value,
        prompt: inPrompt.value.trim(),
        minChars: parseInt(inMin.value, 10) || 0,
        maxChars: parseInt(inMax.value, 10) || 0,
        requiredWords: inWords.value.split(',').map(function (w) { return w.trim(); }).filter(Boolean),
        maxCorrections: parseInt(selCorr.value, 10),
        maxRounds: parseInt(selRounds.value, 10),
        criteria: state.criteria.map(function (c) { return { id: c.id, name: c.name.trim(), group: c.group, levels: c.levels.map(function (l) { return l.trim(); }) }; })
      };
      if (!payload.title) return toast('과제 제목을 입력해 주세요.', true);
      if (!payload.genre) return toast('갈래를 고르세요.', true);
      if (!payload.prompt) return toast('글감을 입력해 주세요.', true);
      if (payload.maxChars && payload.minChars && payload.maxChars < payload.minChars) return toast('최대 글자 수가 최소보다 작아요.', true);
      if (!payload.criteria.length) return toast('평가 기준이 한 개 이상 필요해요.', true);
      for (var i = 0; i < payload.criteria.length; i++) {
        var c = payload.criteria[i];
        if (!c.name) return toast((i + 1) + '번째 기준의 이름이 비어 있어요.', true);
        if (c.levels.some(function (l) { return !l; })) return toast('"' + c.name + '" 기준의 단계 서술을 4개 모두 적어 주세요.', true);
      }
      setBusy(btnSave, true, '저장 중…');
      var p = existing ? teacherApi('task.update', Object.assign({ taskId: existing.taskId }, payload)) : teacherApi('task.create', payload);
      p.then(function () {
        toast(existing ? '과제를 저장했어요.' : '과제를 만들었어요! 학생 화면에 바로 보여요.');
        classCache = {};
        go('/teacher/class/' + classId + '/tasks');
      }).catch(function (e) { toast(e.message, true); setBusy(btnSave, false); });
    });

    var card = h('div', { class: 'card' }, [
      h('h2', { text: existing ? '과제 수정' : '새 과제 만들기' }),
      h('p', { class: 'desc', text: cls.name + ' · ' + cls.grade + '학년' }),
      h('label', { text: '과제 제목' }), inTitle,
      h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '갈래' }), selGenre]),
        h('div', { class: 'fit', style: 'min-width:150px' }, [h('label', { text: '기준 학년군' }), selBand])
      ]),
      h('label', { text: '글감 · 안내 (학생에게 그대로 보여요)' }), inPrompt,
      h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '최소 글자 수' }), inMin]),
        h('div', {}, [h('label', { text: '최대 글자 수' }), inMax])
      ]),
      h('label', { text: '꼭 써야 할 낱말 (선택)' }), inWords,
      h('p', { class: 'hint', text: '글자 수는 공백 포함. 비워 두면 제한 없음.' }),
      h('h3', { text: 'AI 피드백 설정' }),
      h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '고칠 곳(맞춤법 등) 보여 줄 개수' }), selCorr]),
        h('div', {}, [h('label', { text: '고쳐 쓰기 차수' }), selRounds])
      ]),
      h('p', { class: 'hint', text: '고칠 곳은 한 번에 너무 많이 보이면 학생이 지치니 7개쯤을 권해요. 나머지는 다음 차수에서 다시 잡혀요. 차수를 제한하면 마지막 차수 피드백을 받은 뒤 더 쓸 수 없어요.' })
    ]);

    var critCard = h('div', { class: 'card' }, [
      h('h2', { text: '평가 기준' }),
      h('p', { class: 'desc', text: '공통 기준 + 갈래 기준이 학년군에 맞춰 들어와요. 문구를 고치거나 기준을 빼고 더할 수 있어요. 단계 서술이 곧 AI 채점 기준이 됩니다.' }),
      critBox, critStatus,
      h('div', { class: 'actions' }, [btnAddCrit, btnReload]),
      btnSave,
      h('div', { class: 'actions' }, [h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' })])
    ]);

    render(card, critCard);
    renderCriteria();
    if (!existing) inTitle.focus();
  }

  // ───────────────────────────────────────────
  // 교사: 과제별 제출 현황
  // ───────────────────────────────────────────
  function stateBadge(state) {
    var cls = state === '제출됨' ? 'badge sub' : state === '피드백완료' ? 'badge done' : state === '작성 중' ? 'badge draft' : 'badge off';
    return h('span', { class: cls, text: state });
  }

  function viewSubmissions(classId, taskId) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '제출 현황을 불러오는 중…' })]));
    teacherApi('submission.list', { taskId: taskId })
      .then(function (d) {
        var c = d.counts;
        var summary = h('div', { class: 'count-row' }, [
          h('div', { class: 'count' }, [h('b', { text: String(c.submitted + c.done) }), h('span', { text: '제출' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.draft) }), h('span', { text: '작성 중' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.none) }), h('span', { text: '미작성' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.total) }), h('span', { text: '전체' })])
        ]);
        var table = h('table', { class: 'sub-table' }, [
          h('thead', {}, [h('tr', {}, [h('th', { text: '번호' }), h('th', { text: '이름' }), h('th', { text: '상태' }), h('th', { text: '차수' }), h('th', { text: '글자' }), h('th', { text: '시각' }), h('th', { text: '' })])]),
          h('tbody', {}, d.rows.map(function (r) {
            var canOpen = !!r.submissionId;
            var tr = h('tr', { class: (r.state === '미작성' ? 'dim' : '') + (canOpen ? ' has-link' : '') }, [
              h('td', { text: r.no }),
              h('td', { text: r.name }),
              h('td', {}, [stateBadge(r.state)]),
              h('td', { text: r.round ? r.round + '차' : '-' }),
              h('td', { text: r.charCount ? r.charCount + '자' : '-' }),
              h('td', { class: 'muted', text: fmtTime(r.submittedAt || r.savedAt) || '-' }),
              h('td', { class: 'act' }, [canOpen ? h('a', { href: '#/teacher/submission/' + r.submissionId, class: 'btn small secondary', text: '보기' }) : null])
            ]);
            if (canOpen) tr.addEventListener('click', function (ev) { if (ev.target.tagName !== 'A') go('/teacher/submission/' + r.submissionId); });
            return tr;
          }))
        ]);
        var card = h('div', { class: 'card' }, [
          h('span', { class: 'badge genre', text: d.task.genreLabel }),
          h('span', { class: 'badge' + (d.task.status === '열림' ? '' : ' off'), text: d.task.status, style: 'margin-left:6px' }),
          h('h2', { text: d.task.title, style: 'margin-top:8px' }),
          summary,
          h('div', { class: 'table-wrap' }, [table]),
          h('div', { class: 'actions' }, [
            h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' }),
            h('button', { class: 'small secondary', text: '새로고침', onclick: function () { viewSubmissions(classId, taskId); } })
          ])
        ]);
        render(card);
      })
      .catch(function (e) { render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' })])); });
  }

  // ───────────────────────────────────────────
  // 교사: 제출글 보기
  // ───────────────────────────────────────────
  function viewSubmissionDetail(submissionId) {
    if (!ssGet(KEYS.teacherPw)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '글을 불러오는 중…' })]));
    teacherApi('submission.get', { submissionId: submissionId })
      .then(function (d) {
        var sub = d.submission;
        var task = d.task;
        var backHref = task ? '#/teacher/class/' + task.classId + '/tasks/' + task.taskId + '/submissions' : '#/teacher/classes';
        var actions = [h('a', { href: backHref, class: 'btn ghost small', text: '← 제출 현황' })];
        if (sub.status === '제출됨') {
          actions.push(h('button', { class: 'small danger', text: '제출 되돌리기 (학생이 다시 고치게)', onclick: function (ev) {
            if (!confirm(sub.name + ' 학생의 ' + sub.round + '차 제출을 되돌릴까요? 학생이 다시 고쳐서 제출할 수 있게 돼요.')) return;
            var b = ev.currentTarget; setBusy(b, true);
            teacherApi('submission.reopen', { submissionId: submissionId })
              .then(function () { toast('되돌렸어요. 학생 화면에서 다시 고칠 수 있어요.'); viewSubmissionDetail(submissionId); })
              .catch(function (e) { toast(e.message, true); setBusy(b, false); });
          } }));
        }
        var card = h('div', { class: 'card' }, [
          h('div', { class: 'row', style: 'align-items:center' }, [
            h('div', {}, [
              h('div', { class: 'muted', text: task ? task.genreLabel + ' · ' + task.title : '' }),
              h('h2', { text: sub.no + '번 ' + sub.name + ' · ' + sub.round + '차', style: 'margin:4px 0' })
            ]),
            h('div', { class: 'fit' }, [stateBadge(sub.status === '임시저장' ? '작성 중' : sub.status)])
          ]),
          h('p', { class: 'muted', text: (sub.submittedAt ? '제출 ' + fmtTime(sub.submittedAt) : '마지막 저장 ' + fmtTime(sub.savedAt)) + ' · ' + sub.charCount + '자' }),
          sub.title ? h('h3', { text: sub.title }) : null,
          h('div', { class: 'essay-view', text: sub.text || '(아직 쓴 내용이 없어요)' }),
          h('div', { class: 'actions' }, actions)
        ]);
        var fbCard = null;
        if (sub.status !== '임시저장') {
          var btnRegen = h('button', { class: 'small secondary', text: sub.feedback ? '🔄 다시 채점' : '🤖 AI 채점 실행', onclick: function (ev) {
            if (sub.feedback && !confirm('AI 피드백을 다시 만들까요? 기존 AI 결과는 덮어써요. (교사 한마디·최종 단계는 유지)')) return;
            var b = ev.currentTarget; setBusy(b, true, 'AI가 읽는 중…');
            teacherApi('feedback.regenerate', { submissionId: submissionId })
              .then(function () { toast('AI 피드백을 만들었어요.'); viewSubmissionDetail(submissionId); })
              .catch(function (e) { toast(e.message, true); setBusy(b, false); });
          } });
          fbCard = sub.feedback
            ? renderFeedback(sub.feedback, sub, { forStudent: false, extraActions: [btnRegen] })
            : h('div', { class: 'card' }, [
                h('div', { class: 'feedback-placeholder' }, [h('span', { class: 'big-emoji', text: '🤖' }), '아직 AI 피드백이 없어요. (제출 때 AI 호출이 실패했을 수 있어요)']),
                h('div', { class: 'actions' }, [btnRegen])
              ]);
        }
        var prev = null;
        var others = d.rounds.filter(function (r) { return r.submissionId !== submissionId; });
        if (others.length) {
          prev = h('div', { class: 'card' }, [h('h3', { text: '다른 차수', style: 'margin-top:0' })].concat(others.map(function (r) {
            return h('details', { class: 'prev-round' }, [
              h('summary', { text: r.round + '차 · ' + (r.status === '임시저장' ? '작성 중' : r.status) + ' · ' + r.charCount + '자 · ' + fmtTime(r.submittedAt || r.savedAt) + (r.feedback ? ' · ' + levelSummary(r.feedback) : '') }),
              h('div', { class: 'essay-view', text: r.text })
            ]);
          })));
        }
        render(card, fbCard, prev);
      })
      .catch(function (e) { render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' })])); });
  }

  // ───────────────────────────────────────────
  // 피드백 렌더러 (학생·교사 공용)
  // ───────────────────────────────────────────
  var LEVELS = [
    { n: 0, name: '?',   emoji: '❔', cls: 'lv0' },
    { n: 1, name: '씨앗', emoji: '🌰', cls: 'lv1' },
    { n: 2, name: '새싹', emoji: '🌱', cls: 'lv2' },
    { n: 3, name: '나무', emoji: '🌳', cls: 'lv3' },
    { n: 4, name: '열매', emoji: '🍎', cls: 'lv4' }
  ];
  function lv(n) { return LEVELS[Math.max(0, Math.min(4, Number(n) || 0))]; }
  function effectiveLevel(fb, c) {
    // 교사가 최종 단계를 정했으면 그것이 우선 (5단계)
    var f = fb.finalLevels && fb.finalLevels[c.id];
    return f ? { level: Number(f), overridden: true } : { level: c.level, overridden: false };
  }
  function levelSummary(fb) {
    return (fb.criteria || []).map(function (c) { return lv(effectiveLevel(fb, c).level).emoji; }).join('');
  }

  function renderFeedback(fb, sub, opts) {
    opts = opts || {};
    var forStudent = !!opts.forStudent;
    var who = forStudent ? '' : (sub.no + '번 ' + sub.name + ' · ');

    // 단계 그리드
    var grid = h('div', { class: 'level-grid' }, (fb.criteria || []).map(function (c) {
      var e = effectiveLevel(fb, c);
      var L = lv(e.level);
      var card = h('div', { class: 'level-card ' + L.cls }, [
        h('div', { class: 'level-emoji', text: L.emoji }),
        h('div', { class: 'level-name', text: c.name }),
        h('div', { class: 'level-label', text: e.level ? e.level + '단계 ' + L.name : '판정 없음' }),
        e.overridden ? h('div', { class: 'level-teacher', text: '선생님 판정' }) : null
      ]);
      return card;
    }));

    // 기준별 상세 (펼침)
    var details = h('div', { class: 'crit-fb-list' }, (fb.criteria || []).map(function (c) {
      var e = effectiveLevel(fb, c);
      var L = lv(e.level);
      return h('details', { class: 'crit-fb' }, [
        h('summary', {}, [h('span', { class: 'lv-dot ' + L.cls, text: L.emoji }), ' ', h('b', { text: c.name }), ' · ' + (e.level ? e.level + '단계' : '판정 없음') + (e.overridden ? ' (선생님)' : '')]),
        h('div', { class: 'crit-fb-body' }, [
          c.evidence ? h('div', { class: 'fb-quote' }, [h('span', { class: 'fb-quote-label', text: '글에서' }), h('span', { text: '"' + c.evidence + '"' })]) : null,
          c.reason ? h('p', { text: c.reason }) : null,
          c.tip ? h('p', { class: 'fb-tip' }, [h('b', { text: '다음 단계로 → ' }), c.tip]) : null
        ])
      ]);
    }));

    function list(title, items, cls) {
      if (!items || !items.length) return null;
      return h('div', { class: 'fb-block ' + cls }, [h('h3', { text: title }), h('ul', {}, items.map(function (x) { return h('li', { text: x }); }))]);
    }

    var corrections = null;
    if (fb.corrections && fb.corrections.length) {
      corrections = h('div', { class: 'fb-block fb-corr' }, [
        h('h3', { text: '✏️ 고칠 곳 (' + fb.corrections.length + ')' }),
        h('div', { class: 'corr-list' }, fb.corrections.map(function (x) {
          return h('div', { class: 'corr' }, [
            h('span', { class: 'corr-kind', text: x.kind }),
            h('span', { class: 'corr-orig', text: x.original }),
            h('span', { class: 'corr-arrow', text: '→' }),
            h('span', { class: 'corr-fixed', text: x.fixed })
          ]);
        })),
        forStudent ? h('p', { class: 'hint', text: 'AI가 찾은 것이라 틀릴 수도 있어요. 이상하면 선생님께 물어보세요.' }) : null
      ]);
    }

    var growth = null;
    if (fb.growth && fb.growth.items && fb.growth.items.length) {
      growth = h('div', { class: 'fb-block fb-growth' }, [
        h('h3', { text: '🌿 지난 글보다 얼마나 자랐을까?' }),
        fb.growth.summary ? h('p', { text: fb.growth.summary }) : null,
        h('div', { class: 'growth-list' }, fb.growth.items.map(function (g) {
          var up = g.after > g.before, down = g.after < g.before;
          return h('div', { class: 'growth-row' }, [
            h('span', { class: 'growth-name', text: g.name }),
            h('span', { class: 'growth-steps' }, [lv(g.before).emoji + ' ' + (g.before || '?') + ' → ' + lv(g.after).emoji + ' ' + (g.after || '?')]),
            h('span', { class: 'growth-delta ' + (up ? 'up' : down ? 'down' : ''), text: up ? '▲ 올라갔어요' : down ? '▼ 내려갔어요' : '그대로' }),
            g.comment ? h('div', { class: 'growth-comment', text: g.comment }) : null
          ]);
        }))
      ]);
    }

    var teacherNote = fb.teacherNote ? h('div', { class: 'fb-block fb-teacher' }, [h('h3', { text: '👩‍🏫 선생님 한마디' }), h('p', { text: fb.teacherNote })]) : null;

    var head = h('div', { class: 'fb-head' }, [
      h('div', {}, [
        h('div', { class: 'muted', text: who + sub.round + '차 피드백 · ' + fmtTime(fb.createdAt) + (forStudent ? '' : ' · ' + (fb.model || '')) }),
        h('h2', { text: forStudent ? '🤖 AI 선생님의 피드백' : 'AI 피드백', style: 'margin:4px 0 0' })
      ]),
      opts.extraActions ? h('div', { class: 'fit actions', style: 'margin:0' }, opts.extraActions) : null
    ]);

    return h('div', { class: 'card fb-card' }, [
      head,
      fb.summary ? h('div', { class: 'fb-summary', text: fb.summary }) : null,
      grid,
      details,
      growth,
      list('👍 잘한 점', fb.strengths, 'fb-good'),
      list('🔧 고쳐 볼 점', fb.improvements, 'fb-fix'),
      fb.nextTry ? h('div', { class: 'fb-block fb-next' }, [h('h3', { text: '🎯 다음에 꼭 해 볼 한 가지' }), h('p', { text: fb.nextTry })]) : null,
      corrections,
      teacherNote
    ]);
  }

  // ───────────────────────────────────────────
  // 시작
  // ───────────────────────────────────────────
  readLinkParams();
  window.addEventListener('hashchange', route);
  route();

  // 테스트용 노출 (브라우저 콘솔)
  window.__geulsup = { version: APP_VERSION, parseRoster: parseRoster, extractDeployId: extractDeployId, taskConditionText: taskConditionText, bandForGrade: bandForGrade, countChars: countChars, conditionChecks: conditionChecks, fmtTime: fmtTime, levelSummary: levelSummary };
})();
