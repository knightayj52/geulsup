/**
 * 글숲 (geulsup) — 학생 글쓰기 AI 피드백 앱 · 화면 로직
 * © 2026 영쌤클래스 · 교육용으로 제작 · 무단 복제·재배포 금지
 *
 * v0.6.0 — 개인 인증 · 저장 버전 관리 · 글쓰기/피드백 작업 공간
 * v0.5.0 — 5단계: 교사 피드백 한눈에
 *   - 제출 현황: 학생별 단계 이모지 · 총평/다음에 시도 펼쳐 보기 · 학급 통계(기준별 분포, 평균, 고칠 곳 유형)
 *   - 제출글 보기: 교사 한마디 · 기준별 최종 단계 조정 (학생 화면에 '선생님 판정'으로 표시)
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

  var APP_VERSION = '0.6.0'; // server protocol version
  var UI_VERSION = '0.6.1';
  var editorLifecycle = null;
  var submissionNavigation = [];
  var teacherNoteCleanup = null;
  var routeVersion = 0;

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
    student:   'geulsup_student_v2', // sessionStorage: 학생 인증 세션
    pendCode:  'geulsup_pending_code',// localStorage: 링크로 받은 학급 코드(입장 전)
    teacherToken: 'geulsup_teacher_token' // sessionStorage: 교사 인증 토큰 (비밀번호 저장 안 함)
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
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  function ssGet(k) { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  function getStudent() {
    try { return JSON.parse(ssGet(KEYS.student) || 'null'); } catch (e) { return null; }
  }

  // ───────────────────────────────────────────
  // DOM 유틸 (사용자 입력 텍스트는 항상 textContent로)
  // ───────────────────────────────────────────
  // Small, dependency-free line icons. Paths are fixed app assets, never user input.
  function icon(name) {
    var paths = {
      leaf: 'M12 21V11M12 15C3 15 3 6 3 6s9-1 9 9ZM12 11c0-8 9-9 9-9s1 9-9 9Z',
      pen: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7ZM4 15l5 4',
      grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
      book: 'M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z',
      check: 'm5 12 4 4L19 6',
      spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',
      chat: 'M5 3h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 4V5a2 2 0 0 1 2-2Z',
      seed: 'M18 4C5 2 2 10 6 16s15 2 12-12ZM6 16 16 6',
      tree: 'M12 21v-8M7 18H3l5-6H5l5-6H8l4-4 4 4h-2l5 6h-3l5 6h-4',
      fruit: 'M12 7c-9-5-12 7-6 13 2 2 4 1 6 1s4 1 6-1c6-6 3-18-6-13ZM12 7V3m0 2c1-4 6-4 6-4s0 5-6 4',
      arrow: 'M5 12h14m-6-6 6 6-6 6',
      settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
      people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM20 21v-2a4 4 0 0 0-3-4m0-12a4 4 0 0 1 0 8'
    };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'line-icon'); svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', paths[name] || paths.leaf);
    svg.appendChild(path); return svg;
  }
  function growthTrack() {
    return h('div', { class: 'growth-track', 'aria-label': '글의 성장 단계: 씨앗, 새싹, 나무, 열매' }, ['씨앗','새싹','나무','열매'].map(function (name, i) {
      return h('div', { class: 'growth-stop' }, [h('span', { class: 'growth-symbol stage-' + i }, [icon(['seed','leaf','tree','fruit'][i])]), h('span', { text: name })]);
    }));
  }
  function studioIntro(teacher) {
    return h('section', { class: 'studio-intro' }, [
      h('div', { class: 'eyebrow', text: teacher ? 'TEACHER’S STUDIO' : 'A LITTLE EVERY DAY' }),
      h('h1', {}, [teacher ? '함께 쓰고,' : '작은 생각이,', h('br'), h('em', { text: teacher ? '함께 자라는 교실.' : '단단한 글이 되는 곳.' })]),
      h('p', { class: 'intro-copy', text: teacher ? '아이들의 문장을 읽고, 다음 한 걸음을 함께 찾아 주세요. 글숲이 글쓰기의 과정을 모아 드립니다.' : '내 생각을 한 문장씩 꺼내 보세요. 쓰고, 읽고, 다시 다듬으며 나만의 글숲을 만들어 가요.' }),
      h('div', { class: 'botanical-note', 'aria-hidden': 'true' }, [h('div', { class: 'note-lines' }, [h('span'),h('span'),h('span')]), icon('leaf'), h('span', { class: 'note-caption', text: '한 문장씩, 나답게.' })]),
      growthTrack()
    ]);
  }
  function sectionHeading(kicker, title, description) {
    return h('header', { class: 'page-heading' }, [h('span', { class: 'eyebrow', text: kicker }), h('h1', { text: title }), description ? h('p', { text: description }) : null]);
  }
  function renderStudioNavigation(path) {
    var nav = document.getElementById('studioNav'); clear(nav);
    var teacher = path.indexOf('/teacher') === 0 && !!ssGet(KEYS.teacherToken);
    var student = path.indexOf('/class') === 0 && !!getStudent();
    document.body.classList.toggle('has-sidebar', teacher);
    document.body.classList.toggle('student-session', student);
    nav.hidden = !teacher;
    if (!teacher) return;
    nav.appendChild(h('div', { class: 'nav-caption', text: '나의 글쓰기 교실' }));
    function link(href, text, glyph, active) { nav.appendChild(h('a', { href: href, class: 'nav-link' + (active ? ' active' : ''), 'aria-current': active ? 'page' : null }, [icon(glyph), h('span', { text: text })])); }
    link('#/teacher/classes', '대시보드', 'grid', path === '/teacher/classes');
    link('#/teacher/new', '새 학급 만들기', 'people', path === '/teacher/new');
    var match = path.match(/^\/teacher\/class\/([^/]+)/);
    if (match) {
      nav.appendChild(h('div', { class: 'nav-caption section-caption', text: '선택한 학급' }));
      link('#/teacher/class/' + match[1] + '/tasks', '글쓰기 과제', 'pen', path.indexOf('/tasks') >= 0);
      link('#/teacher/class/' + match[1], '학급 · 입장 관리', 'settings', path.indexOf('/tasks') < 0);
    }
    nav.appendChild(h('div', { class: 'nav-note' }, [icon('leaf'), h('p', { text: '한 번의 점수보다,\n조금씩 달라지는 문장.' }), h('span', { text: '글숲 · 영쌤클래스' })]));
  }
  function decorateLabels(root) {
    // Only app-owned decorative labels; essay content and user-entered text stay untouched.
    root.querySelectorAll('.level-emoji, .lv-chip, .lv-dot').forEach(function (el) {
      var glyph = {'🌰':'seed','🌱':'leaf','🌳':'tree','🍎':'fruit'}[el.textContent];
      if (glyph) { var name = {'seed':'씨앗','leaf':'새싹','tree':'나무','fruit':'열매'}[glyph]; el.textContent = ''; el.appendChild(icon(glyph)); el.setAttribute('aria-label', name); }
    });
    root.querySelectorAll('h2, .big-emoji, .fb-block h3').forEach(function (el) {
      if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) return;
      var text = el.textContent;
      var match = text.match(/^(?:🌳|🌱|🌿|✏️|✍️|🤖|👩‍🏫|👍|🔧|🎯|🏁)\s*/u);
      if (match) { el.textContent = text.slice(match[0].length); el.prepend(icon(/✏|✍/.test(match[0]) ? 'pen' : /🤖|🎯/.test(match[0]) ? 'spark' : /👩/.test(match[0]) ? 'chat' : 'leaf')); }
    });
  }
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
    if (attrs.class && /(?:level-emoji|lv-chip|lv-dot)/.test(attrs.class)) {
      var names = {'🌰':'seed','🌱':'leaf','🌳':'tree','🍎':'fruit'}; if (names[el.textContent]) { var label = el.textContent; el.setAttribute('role', 'img'); el.setAttribute('aria-label', {'🌰':'씨앗','🌱':'새싹','🌳':'나무','🍎':'열매'}[label]); el.textContent = ''; el.appendChild(icon(names[label])); }
    }
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function render() { clear($app); for (var i = 0; i < arguments.length; i++) if (arguments[i]) $app.appendChild(arguments[i]); decorateLabels($app); window.scrollTo(0, 0); }

  var toastTimer = null;
  function toast(msg, isError) {
    $toast.textContent = msg;
    $toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.className = 'toast'; }, isError ? 3500 : 2200);
  }

  function setBusy(btn, busy, labelBusy) {
    if (!btn) return;
    if (busy) { if (!btn.disabled) btn.dataset.label = btn.textContent; btn.textContent = labelBusy || '잠시만요…'; btn.disabled = true; }
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

  function api(action, payload, serverId) {
    var id = serverId || lsGet(KEYS.apiId, '');
    if (!id) return Promise.reject(new Error('서버가 연결되어 있지 않아요. 교사 화면에서 배포 URL을 등록해 주세요.'));
    var body = Object.assign({ action: action }, payload || {});
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, /submit|feedback|ai.test/.test(action) ? 180000 : 30000);
    return fetch(apiUrl(id), {
      signal: controller.signal,
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
      }).catch(function (e) {
        if (e.name === 'AbortError') throw new Error('응답을 기다리는 시간이 길어졌어요. 저장·제출이 완료됐을 수 있으니 다시 열어 상태를 확인해 주세요.');
        throw e;
      }).finally(function () { clearTimeout(timeout); });
  }
  function teacherApi(action, payload) {
    return api(action, Object.assign({ token: ssGet(KEYS.teacherToken) }, payload || {}));
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
    if (s && extractDeployId(s)) { if (extractDeployId(s) !== lsGet(KEYS.apiId, '')) { ssDel(KEYS.student); ssDel(KEYS.teacherToken); } lsSet(KEYS.apiId, extractDeployId(s)); touched = true; }
    if (c) { var oldStudent = getStudent(); if (oldStudent && oldStudent.code !== c.toUpperCase()) ssDel(KEYS.student); lsSet(KEYS.pendCode, c.toUpperCase()); touched = true; }
    if (touched) {
      // 주소를 깨끗하게 (뒤로가기 해도 파라미터가 다시 안 붙도록)
      history.replaceState(null, '', location.pathname + (location.hash || '#/'));
    }
  }

  function route() {
    routeVersion++;
    if (teacherNoteCleanup) { teacherNoteCleanup(); teacherNoteCleanup = null; }
    if (editorLifecycle) { editorLifecycle.dispose(); editorLifecycle = null; }
    var hash = location.hash || '#/';
    var path = hash.replace(/^#/, '');
    $app.className = 'app' + (path.indexOf('/teacher') === 0 ? ' teacher-app' : '');
    renderTopbar(path);
    renderStudioNavigation(path);
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
      if (ssGet(KEYS.teacherToken)) {
        $topRight.appendChild(h('button', { class: 'small', text: '사용 마치기', onclick: function () { leaveSession('teacher'); } }));
      }
    } else if (student && path.indexOf('/class') === 0) {
      $topRight.appendChild(h('span', { class: 'chip', text: student.className + ' · ' + student.no + '번 ' + student.name }));
      $topRight.appendChild(h('button', { class: 'small', text: '사용 마치기', onclick: function () { leaveSession('student'); } }));
    } else {
      $topRight.appendChild(h('a', { href: '#/teacher', class: 'btn small ghost', text: '선생님 입장' }));
    }
  }

  function leaveSession(role) {
    var token = role === 'teacher' ? ssGet(KEYS.teacherToken) : (getStudent() || {}).token;
    if (editorLifecycle && editorLifecycle.dirty() && !confirm('아직 서버에 저장되지 않은 글이 있어요. 이 기기의 임시 글도 지우고 사용을 마칠까요? 취소하면 글을 복사하거나 저장할 수 있어요.')) return;
    if (editorLifecycle) { editorLifecycle.dispose(false, true); editorLifecycle = null; }
    if (token) api('auth.logout', { token: token }).catch(function () {});
    if (role === 'student') {
      var st = getStudent();
      if (st) {
        var prefix = 'geulsup_draft_' + lsGet(KEYS.apiId, '') + '_' + st.classId + '_' + st.no + '_';
        try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(prefix) === 0 || k.indexOf('geulsup_draft_' + st.classId + '_' + st.no + '_') === 0) lsDel(k); }); } catch (e) {}
      }
      ssDel(KEYS.student);
    } else ssDel(KEYS.teacherToken);
    go('/');
  }
  function checkProtocol(d) { if (!d || d.protocol !== 2) throw new Error('서버 업데이트가 필요해요. 선생님이 Code.gs v0.6.0을 적용한 뒤 기존 웹 앱을 새 버전으로 배포해 주세요.'); }

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
    var inName = h('input', { type: 'text', placeholder: '예: 김글숲', 'aria-label': '이름' });
    var inPin = h('input', { type: 'password', placeholder: '선생님이 나에게 준 개인 입장 코드', autocomplete: 'off', 'aria-label': '개인 입장 코드' });
    var btn = h('button', { class: 'big', text: '내 글숲으로 들어가기 →' });

    function join() {
      var code = inCode.value.trim().toUpperCase();
      var no = inNo.value.trim();
      var name = inName.value.trim();
      if (!code) return toast('학급 코드를 입력해 주세요.', true);
      if (!no || !name) return toast('번호와 이름을 입력해 주세요.', true);
      if (!hasApi) return toast('선생님이 보내 준 학급 링크로 들어와야 해요.', true);
      setBusy(btn, true, '확인하는 중…');
      api('ping').then(function (d) { checkProtocol(d); return api('student.join', { code: code, no: no, name: name, pin: inPin.value.trim() }); })
        .then(function (d) {
          ssSet(KEYS.student, JSON.stringify({ token: d.token, classId: d.classId, className: d.className, grade: d.grade, no: d.student.no, name: d.student.name, code: code }));
          lsDel(KEYS.pendCode);
          toast('환영해요, ' + d.student.name + '!');
          go('/class');
        })
        .catch(function (e) { toast(e.message, true); })
        .then(function () { setBusy(btn, false); });
    }
    btn.addEventListener('click', join);
    [inCode, inNo, inName, inPin].forEach(function (i) { i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') join(); }); });

    var hero = studioIntro(false);

    var card = h('div', { class: 'card' }, [
      h('h2', { text: '우리 반에 들어가기' }),
      h('p', { class: 'desc', text: '선생님이 알려 준 정보로 나의 글쓰기 교실에 들어가요.' }),
      h('label', { text: '학급 코드' }), inCode,
      h('div', { class: 'row' }, [
        h('div', {}, [h('label', { text: '번호' }), inNo]),
        h('div', {}, [h('label', { text: '이름' }), inName])
      ]),
      h('label', { text: '개인 입장 코드' }), inPin,
      h('p', { class: 'hint', text: '내 코드는 친구에게 알려 주지 않아요. 활동이 끝나면 위쪽의 사용 마치기를 눌러 주세요.' }),
      btn,
      !hasApi ? h('p', { class: 'hint center', text: '아직 서버가 연결되지 않았어요. 선생님이 보내 준 학급 링크(QR)로 들어오면 자동으로 연결돼요.' }) : null
    ]);

    card.classList.add('entry-card');
    card.prepend(h('div', { class: 'eyebrow', text: 'WELCOME TO GEULSUP' }));
    render(h('div', { class: 'entry-layout' }, [hero, card]));
    (pendCode ? inNo : inCode).focus();
  }

  // ───────────────────────────────────────────
  // 학생 홈 — 열린 과제 목록
  // ───────────────────────────────────────────
  var studentTaskCache = {}; // taskId → task (상세 화면에서 재사용)

  function fetchStudentTasks() {
    var s = getStudent();
    return api('task.listForStudent', { token: s.token }).then(function (d) {
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
      h('div', { class: 'greet', text: s.name + ' 님의 글쓰기 스튜디오' }),
      h('p', { class: 'welcome-copy', text: '오늘의 생각을 글로 남겨 볼까요? 완벽하지 않아도 괜찮아요.' }),
      growthTrack()
    ]);
    var stats = h('div', { class: 'studio-stats', 'aria-label': '열린 과제 현황' });
    render(card, stats, sectionHeading('MY WRITING', '나의 글쓰기 과제', '이어서 쓸 글이나 새롭게 시작할 글을 골라 보세요.'), list);

    fetchStudentTasks()
      .then(function (tasks) {
        clear(list);
        [['열린 과제', tasks.length], ['작성 중', tasks.filter(function (t) { return t.progress === '작성 중'; }).length], ['피드백 도착', tasks.filter(function (t) { return t.progress === '피드백 도착'; }).length]].forEach(function (item) { stats.appendChild(h('div', { class: 'studio-stat' }, [h('span', { text: item[0] }), h('strong', { text: String(item[1]) })])); });
        if (!tasks.length) {
          list.appendChild(h('div', { class: 'empty' }, [
            h('span', { class: 'big-emoji', text: '✏️' }),
            '아직 글쓰기 과제가 없어요.',
            h('br'),
            h('span', { class: 'muted', text: '선생님이 과제를 올리면 여기에 나타나요.' })
          ]));
          return;
        }
        tasks.forEach(function (t, index) {
          list.appendChild(h('a', { href: '#/class/task/' + t.taskId, class: 'task-item', 'data-progress': t.progress || '시작 전' }, [
            h('div', { class: 'task-card-top' }, [icon('book'), h('span', { class: 'task-number', text: String(index + 1).padStart(2, '0') })]),
            h('div', {}, [
              h('span', { class: 'badge genre', text: t.genreLabel }),
              h('span', { class: 'badge progress', text: t.progress || '시작 전' }),
              h('div', { class: 'task-title', text: t.title }),
              h('div', { class: 'task-meta', text: taskConditionText(t) || '분량 자유' })
            ]),
            h('div', { class: 'task-go', text: t.progress === '완료' ? '내 글 보기 →' : t.progress === '피드백 대기' ? '피드백 확인 →' : t.progress === '작성 중' ? '이어서 쓰기 →' : t.progress === '피드백 도착' ? '고쳐 쓰기 →' : '글 쓰러 가기 →' })
          ]));
        });
      })
      .catch(function (e) {
        clear(list);
        list.appendChild(h('p', { class: 'bad', text: e.message }));
        if (/다시 들어와/.test(e.message)) { ssDel(KEYS.student); }
      });
  }

  // ───────────────────────────────────────────
  // 학생: 과제 상세 + 글쓰기 편집기
  // ───────────────────────────────────────────
  function countChars(text) { return String(text || '').replace(/\r\n/g, '\n').trim().length; }

  function studentPayload(extra) {
    var s = getStudent();
    return Object.assign({ token: s.token }, extra || {});
  }

  function draftKey(taskId) { var s = getStudent(); return 'geulsup_draft_' + lsGet(KEYS.apiId, '') + '_' + s.classId + '_' + s.no + '_' + taskId; }

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
    var viewTicket = ++routeVersion;
    if (editorLifecycle) { editorLifecycle.dispose(false); editorLifecycle = null; }
    var s = getStudent();
    if (!s) { go('/'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '과제를 불러오는 중…' })]));

    var ready = studentTaskCache[taskId] ? Promise.resolve(studentTaskCache[taskId])
      : fetchStudentTasks().then(function () { if (viewTicket !== routeVersion) return; return studentTaskCache[taskId]; });

    ready.then(function (t) { if (viewTicket !== routeVersion) return;
      if (!t) throw new Error('이 과제는 지금 볼 수 없어요. 선생님께 여쭤보세요.');
      return api('submission.mine', studentPayload({ taskId: taskId })).then(function (mine) { if (viewTicket !== routeVersion) return; buildStudentTask(t, mine); });
    }).catch(function (e) { if (viewTicket !== routeVersion) return;
      if (/다시 들어와/.test(e.message)) ssDel(KEYS.student);
      render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/class', class: 'btn ghost small', text: '← 과제 목록' })]));
    });
  }

  function lineComparison(before, after) {
    var oldLines = String(before || '').split('\n'), newLines = String(after || '').split('\n');
    function unmatched(lines, other) {
      var counts = Object.create(null); other.forEach(function (line) { counts[line] = (counts[line] || 0) + 1; });
      return lines.filter(function (line) { if (counts[line]) { counts[line]--; return false; } return !!line.trim(); });
    }
    return { removed: unmatched(oldLines, newLines), added: unmatched(newLines, oldLines) };
  }
  function renderComparison(before, after) {
    var diff = lineComparison(before, after);
    return h('div', { class: 'line-comparison' }, [
      h('p', { class: 'hint', text: '줄 단위 비교예요. 순서만 바뀐 줄은 표시하지 않아요.' }),
      diff.removed.length || diff.added.length ? null : h('p', { text: '문장 내용의 변화가 없어요.' }),
      h('div', {}, diff.removed.map(function (x) { return h('p', { class: 'diff-removed', text: '이전: ' + x }); })),
      h('div', {}, diff.added.map(function (x) { return h('p', { class: 'diff-added', text: '이번: ' + x }); }))
    ]);
  }

  function buildStudentTask(t, mine) {
    if (editorLifecycle) { editorLifecycle.dispose(false); editorLifecycle = null; }
    var taskId = t.taskId;
    var header = h('div', { class: 'card writing-brief' }, [
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
    var studentAuth = { token: getStudent().token };
    var serverId = lsGet(KEYS.apiId, '');
    var localKey = draftKey(taskId);
    var local = null;
    try { local = JSON.parse(lsGet(localKey, 'null')); if (!local) local = JSON.parse(lsGet('geulsup_draft_' + getStudent().classId + '_' + getStudent().no + '_' + taskId, 'null')); } catch (e) { local = null; }
    var draft = mine.draft || { title: '', text: '', savedAt: '' };
    var revision = Number(draft.revision) || 0;
    var serverDraft = { title: draft.title, text: draft.text };
    var restored = false, conflictLocal = null;
    var prefilled = false;
    if (!mine.draft && latestSub && mine.nextRound > 1) {
      // 고쳐 쓰기: 이전 글을 그대로 가져와 고치게 함 (입력해야 저장됨)
      draft = { title: latestSub.title || '', text: latestSub.text || '', savedAt: '' };
      prefilled = true;
    }
    // A draft belongs to one server, student, round and server revision.
    if (local && (local.text !== draft.text || local.title !== draft.title)) {
      if (local.round === mine.nextRound && local.revision === revision) {
        draft = { title: local.title || '', text: local.text || '', savedAt: draft.savedAt };
        restored = true;
      } else conflictLocal = local;
    }

    var inTitle = h('input', { type: 'text', placeholder: '제목 (안 써도 돼요)', value: draft.title, maxlength: '100', class: 'essay-title' });
    var ta = h('textarea', { class: 'essay-editor', placeholder: '여기에 글을 써요. 쓰는 동안 자동으로 저장돼요.', spellcheck: 'false' });
    ta.value = draft.text;
    var counter = h('span', { class: 'char-count', text: '0자' });
    var saveState = h('span', { class: 'save-state', text: draft.savedAt ? '저장됨 ' + fmtTime(draft.savedAt) : '' });
    var condBox = h('div', { class: 'cond-list' });
    var btnSave = h('button', { class: 'small secondary', text: '지금 저장' });
    var btnSubmit = h('button', { class: 'big', text: '글 제출하기' });

    var dirty = false, saving = false, submitting = false, disposed = false, preventLocalWrites = false, localOK = true, savePromise = Promise.resolve(), timer = null;
    var lastSent = prefilled ? { title: null, text: null } : serverDraft;

    function refresh() {
      var text = ta.value;
      var n = countChars(text);
      counter.textContent = n + '자' + (t.minChars || t.maxChars ? ' / ' + (t.minChars && t.maxChars ? t.minChars + '~' + t.maxChars : t.minChars ? t.minChars + '자 이상' : t.maxChars + '자 이하') : '');
      clear(condBox);
      var checks = conditionChecks(t, text);
      checks.forEach(function (c) { condBox.appendChild(h('span', { class: 'cond ' + (c.ok ? 'ok' : ''), text: (c.ok ? '✅ ' : '⬜ ') + c.text })); });
      var allOk = checks.every(function (c) { return c.ok; }) && n > 0;
      btnSubmit.disabled = submitting || !allOk;
      btnSubmit.title = allOk ? '' : '조건을 모두 채우면 제출할 수 있어요';
    }

    function localSave() {
      if (preventLocalWrites) return localOK;
      localOK = lsSet(localKey, JSON.stringify({ title: inTitle.value, text: ta.value, round: mine.nextRound, revision: revision, at: Date.now() }));
      return localOK;
    }
    function hasChanges() { return ta.value.trim() !== lastSent.text || inTitle.value.trim() !== lastSent.title; }
    function serverSave(manual) {
      if (saving) { dirty = true; return savePromise.then(function () { return hasChanges() ? serverSave(manual) : undefined; }); }
      if (!hasChanges() && !manual) return Promise.resolve();
      var payload = { token: studentAuth.token, taskId: taskId, round: mine.nextRound, revision: revision, title: inTitle.value.trim(), text: ta.value.trim() };
      saving = true; dirty = false; saveState.textContent = '서버에 저장 중…';
      savePromise = api('submission.saveDraft', payload, serverId).then(function (d) {
        revision = d.revision; lastSent = { title: payload.title, text: payload.text };
        if (!disposed) localSave();
        saveState.textContent = hasChanges() ? '새 내용을 저장할 준비 중…' : '서버 저장 완료 · ' + fmtTime(d.savedAt);
        saveState.className = 'save-state';
        if (manual) toast('서버에 저장했어요.');
      }).catch(function (e) {
        if (!disposed) localSave();
        saveState.textContent = localOK ? '서버 저장 실패 · 이 기기에만 보관됨' : '저장 실패 · 글을 복사해 보관해 주세요';
        saveState.className = 'save-state bad';
        if (manual) toast(e.message, true);
        throw e;
      }).finally(function () {
        saving = false;
        if (dirty && !disposed && !submitting) { dirty = false; scheduleSave(); }
      });
      return savePromise;
    }
    function scheduleSave() { clearTimeout(timer); timer = setTimeout(function () { if (!disposed && !submitting) serverSave(false).catch(function () {}); }, 2500); }
    function onInput() {
      refresh(); localSave();
      saveState.textContent = localOK ? '이 기기에 저장됨 · 서버 저장 대기' : '기기 저장 불가 · 서버 저장 대기';
      scheduleSave();
    }
    ta.addEventListener('input', onInput); inTitle.addEventListener('input', onInput);
    btnSave.addEventListener('click', function () { clearTimeout(timer); serverSave(true).catch(function () {}); });
    btnSubmit.addEventListener('click', function () {
      if (submitting) return;
      if (!countChars(ta.value) || conditionChecks(t, ta.value).some(function (c) { return !c.ok; })) return;
      if (!confirm('글을 제출하고 AI 피드백을 받을까요? 이름은 별도로 보내지 않지만 글 본문은 AI에 전달돼요. 주소나 연락처는 적지 않았는지 확인해 주세요.')) return;
      submitting = true; clearTimeout(timer);
      ta.disabled = true; inTitle.disabled = true; btnSave.disabled = true;
      setBusy(btnSubmit, true, '글을 저장하는 중…');
      serverSave(false).then(function () {
        btnSubmit.textContent = '제출하고 피드백을 만드는 중…';
        return api('submission.submit', { token: studentAuth.token, taskId: taskId, title: inTitle.value.trim(), text: ta.value.trim(), round: mine.nextRound, revision: revision }, serverId);
      }).then(function (d) {
        lsDel(localKey);
        if (!disposed) { toast(d.feedback ? '제출과 피드백이 완료됐어요 🌳' : '글은 제출됐어요. 피드백은 다시 요청할 수 있어요.'); viewStudentTask(taskId); }
      }).catch(function (e) {
        if (!disposed) toast(e.message, true);
      }).finally(function () {
        submitting = false; ta.disabled = false; inTitle.disabled = false; btnSave.disabled = false;
        btnSubmit.textContent = '글 제출하기'; refresh();
      });
    });
    function beforeUnload(ev) { if (hasChanges() || submitting) { localSave(); ev.preventDefault(); ev.returnValue = ''; } }
    window.addEventListener('beforeunload', beforeUnload);
    editorLifecycle = {
      dirty: function () { return hasChanges() || submitting; },
      dispose: function (flush, clearLocal) {
        preventLocalWrites = !!clearLocal;
        disposed = true; clearTimeout(timer); window.removeEventListener('beforeunload', beforeUnload);
        if (flush !== false && !submitting && hasChanges()) { localSave(); serverSave(false).catch(function () {}); }
      }
    };

    var roundLabel = (mine.nextRound > 1 ? mine.nextRound + '차 · 고쳐 쓰기' : '글쓰기') + (mine.maxRounds ? ' (' + mine.maxRounds + '차까지)' : '');
    var editor = h('div', { class: 'card writing-paper' }, [
      h('div', { class: 'row', style: 'align-items:center' }, [
        h('h2', { text: roundLabel, style: 'margin:0' }),
        h('div', { class: 'fit editor-status' }, [counter, saveState])
      ]),
      restored ? h('p', { class: 'hint', text: '이 기기의 임시 글을 복원했어요. 서버에 다시 저장합니다.' }) : null,
      conflictLocal ? h('details', { class: 'recovery' }, [h('summary', { text: '다른 버전의 임시 글이 있어요. 펼쳐서 복사할 수 있어요.' }), h('div', { class: 'essay-view', text: conflictLocal.title + '\n' + conflictLocal.text })]) : null,
      prefilled ? h('p', { class: 'hint', text: '이전에 쓴 글을 그대로 가져왔어요. 피드백을 보고 고쳐서 다시 제출해 보세요.' }) : null,
      inTitle,
      ta,
      latestSub ? h('details', { class: 'draft-compare', ontoggle: function (ev) { var box = ev.currentTarget; if (box.open) { while (box.children.length > 1) box.lastChild.remove(); box.appendChild(renderComparison(latestSub.text, ta.value)); } } }, [h('summary', { text: '이전 글과 달라진 부분 보기' })]) : null,
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

    var workspace = h('div', { class: 'writing-workspace' + (fbCard ? ' has-feedback' : '') }, [editor, fbCard]);
    if (fbCard) workspace.prepend(h('div', { class: 'workspace-tabs', role: 'group', 'aria-label': '글쓰기 화면 선택' }, [
      h('button', { class: 'small', 'aria-pressed': 'true', text: '내 글 쓰기', onclick: function () { workspace.classList.remove('show-feedback'); this.setAttribute('aria-pressed', 'true'); this.nextElementSibling.setAttribute('aria-pressed', 'false'); } }),
      h('button', { class: 'small secondary', 'aria-pressed': 'false', text: '피드백 보기', onclick: function () { workspace.classList.add('show-feedback'); this.setAttribute('aria-pressed', 'true'); this.previousElementSibling.setAttribute('aria-pressed', 'false'); } })
    ]));
    render(header, workspace, prev);
    refresh();
    if (restored) { localSave(); scheduleSave(); }
    if (!draft.text) ta.focus();
  }

  // ───────────────────────────────────────────
  // 교사: 설정 + 로그인
  // ───────────────────────────────────────────
  function viewTeacher() {
    var apiId = lsGet(KEYS.apiId, '');
    if (apiId && ssGet(KEYS.teacherToken)) { go('/teacher/classes'); return; }

    // 1) 서버 연결
    var inUrl = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/AKfy…/exec', value: apiId ? apiUrl(apiId) : '' });
    var btnTest = h('button', { text: '연결 테스트', class: 'fit' });
    var connStatus = h('div', { class: 'hint', text: apiId ? '등록된 서버가 있어요. 바꾸려면 새 URL을 넣고 테스트하세요.' : '' });

    btnTest.addEventListener('click', function () {
      var id = extractDeployId(inUrl.value);
      if (!id) return toast('웹 앱 URL(…/exec) 형식이 아니에요.', true);
      setBusy(btnTest, true, '확인 중…');
      api('ping', {}, id)
        .then(function (d) {
          checkProtocol(d);
          if (id !== lsGet(KEYS.apiId, '')) { ssDel(KEYS.teacherToken); ssDel(KEYS.student); studentTaskCache = {}; classCache = {}; }
          lsSet(KEYS.apiId, id);
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
      api('ping').then(function (d) { checkProtocol(d); return api('teacher.login', { pw: inPw.value }); })
        .then(function (d) {
          ssSet(KEYS.teacherToken, d.token); inPw.value = '';
          if (d.genres && d.genres.length) GENRES = d.genres;
          toast((d.teacher.name ? d.teacher.name + ' 선생님, ' : '') + '환영합니다!');
          go('/teacher/classes');
        })
        .catch(function (e) { ssDel(KEYS.teacherToken); toast(e.message, true); setBusy(btnLogin, false); });
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
      h('h2', { text: '선생님, 어서 오세요' }),
      h('label', { text: '교사 비밀번호' }), inPw,
      btnLogin,
      h('p', { class: 'hint', text: '로그인은 최대 6시간 유지돼요. 사용을 마치면 로그아웃해 주세요. 학생이 쓰는 기기에서는 로그인하지 마세요.' })
    ]);

    var help = h('details', { class: 'setup-guide' }, [h('summary', { text: '처음 연결하시나요? 설정 안내 보기' }), guide, connect]);
    if (!apiId) help.open = true;
    loginCard.classList.add('entry-card'); loginCard.prepend(h('div', { class: 'eyebrow', text: 'TEACHER ACCESS' }));
    render(h('div', { class: 'entry-layout teacher-entry' }, [studioIntro(true), h('div', {}, [loginCard, help])]));
  }

  // ───────────────────────────────────────────
  // 교사: 학급 목록
  // ───────────────────────────────────────────
  function viewClasses() {
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }

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
        h('button', { class: 'ghost small', text: '서버 설정 바꾸기', onclick: function () { ssDel(KEYS.teacherToken); go('/teacher'); } })
      ])
    ]);

    var stats = h('div', { class: 'studio-stats' });
    card.classList.add('dashboard-classes');
    var settings = h('details', { class: 'service-details' }, [h('summary', {}, [icon('settings'), '연결 상태 · 설정']), setup]);
    render(sectionHeading('TEACHER’S STUDIO', '오늘도, 함께 자라는 글숲', '아이들의 생각을 만나고, 다음 문장을 함께 만들어 주세요.'), stats, card, settings);

    teacherApi('class.list')
      .then(function (d) {
        clear(list);
        [['운영 중인 학급', d.classes.filter(function (c) { return c.status === '활성'; }).length], ['등록된 학생', d.classes.reduce(function (n,c) { return n + Number(c.studentCount || 0); }, 0)], ['글쓰기 과제', d.classes.reduce(function (n,c) { return n + Number(c.taskCount || 0); }, 0)]].forEach(function (item) { stats.appendChild(h('div', { class: 'studio-stat' }, [h('span', { text: item[0] }), h('strong', { text: String(item[1]) })])); });
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
              h('a', { href: '#/teacher/class/' + c.classId + '/tasks', class: 'btn small', text: '과제 살펴보기 →' }),
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
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }

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

  function buildStudentCodes(classId) {
    var box = h('div', { class: 'private-codes' });
    var list = h('div');
    var button = h('button', { class: 'secondary small', text: '개인 입장 코드 발급·확인', onclick: function () {
      setBusy(button, true);
      teacherApi('student.codes', { classId: classId }).then(function (d) {
        clear(list);
        list.appendChild(h('p', { class: 'hint', text: '전체 목록은 학생들에게 보여 주지 마세요. 각 학생에게 자신의 코드만 전달하세요.' }));
        d.students.forEach(function (st) {
          var code = h('code', { text: st.pin });
          list.appendChild(h('div', { class: 'code-row' }, [h('span', { text: st.no + '번 ' + st.name }), code,
            h('button', { class: 'small ghost', text: '복사', onclick: function () { copyText(st.pin); } }),
            h('button', { class: 'small ghost', text: '재발급', onclick: function (e) {
              if (!confirm(st.name + ' 학생의 코드를 바꿀까요? 기존 로그인도 만료됩니다.')) return;
              var btn = e.currentTarget; setBusy(btn, true);
              teacherApi('student.codes', { classId: classId, resetNo: st.no }).then(function (r) { var item = r.students.filter(function (x) { return x.no === st.no; })[0]; st.pin = item.pin; code.textContent = item.pin; }).catch(function (err) { toast(err.message, true); }).finally(function () { setBusy(btn, false); });
            } })]));
        });
      }).catch(function (e) { toast(e.message, true); }).finally(function () { setBusy(button, false); });
    } });
    box.append(button, list); return box;
  }

  function viewClassDetail(classId) {
    var viewTicket = ++routeVersion;
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }
    var holder = h('div', {}, [h('div', { class: 'loading', text: '학급 정보를 불러오는 중…' })]);
    render(holder);

    Promise.all([teacherApi('class.list'), teacherApi('student.list', { classId: classId })])
      .then(function (res) { if (viewTicket !== routeVersion) return;
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
          h('p', { class: 'hint', text: '링크로 들어오면 서버 연결과 학급 코드가 자동으로 채워져요. 학생은 번호·이름·개인 입장 코드를 입력해요. 아래에서 개인 코드를 확인해 한 명씩 전달해 주세요.' })
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
          buildStudentCodes(classId),
          h('div', { class: 'actions' }, [
            h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' }),
            h('a', { href: '#/teacher/class/' + cls.classId + '/tasks', class: 'btn small', text: '✏️ 과제 관리' }),
            h('button', { class: 'small secondary', text: '명단 수정', onclick: function () { viewClassForm({ classId: cls.classId, name: cls.name, grade: cls.grade, students: students }); } }),
            h('button', { class: 'small ' + (archived ? 'secondary' : 'danger'), text: archived ? '다시 열기' : '학급 보관(닫기)', onclick: function (ev) {
              var b = ev.currentTarget;
              setBusy(b, true);
              teacherApi('class.setStatus', { classId: cls.classId, status: archived ? '활성' : '보관' })
                .then(function () { if (viewTicket !== routeVersion) return; toast(archived ? '학급을 다시 열었어요.' : '학급을 보관했어요. 학생은 들어올 수 없어요.'); viewClassDetail(classId); })
                .catch(function (e) { if (viewTicket !== routeVersion) return; toast(e.message, true); setBusy(b, false); });
            } })
          ])
        ]);
        render(card);
      })
      .catch(function (e) { if (viewTicket !== routeVersion) return; render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' })])); });
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
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }
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
    var viewTicket = ++routeVersion;
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '불러오는 중…' })]));

    var loads = [getClass(classId)];
    if (taskId) loads.push(teacherApi('task.get', { taskId: taskId }));
    Promise.all(loads).then(function (res) { if (viewTicket !== routeVersion) return;
      buildTaskForm(res[0], res[1] ? res[1].task : null);
    }).catch(function (e) { if (viewTicket !== routeVersion) return;
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

    var preview = h('div', { class: 'card' });
    var sections = [card, critCard, preview];
    var labels = ['1. 글감·조건', '2. 평가 기준', '3. 미리보기·저장'];
    var tabs = h('nav', { class: 'wizard-tabs', 'aria-label': '과제 만들기 단계' });
    var currentStep = 0;
    function showStep(step) {
      currentStep = step;
      sections.forEach(function (part, i) { part.hidden = i !== step; });
      [].forEach.call(tabs.children, function (b, i) { b.className = i === step ? '' : 'secondary'; b.setAttribute('aria-current', i === step ? 'step' : 'false'); });
      if (step === 2) {
        clear(preview);
        preview.append(h('h2', { text: '학생에게 이렇게 보여요' }), h('h3', { text: inTitle.value || '(과제 제목)' }), h('div', { class: 'prompt-box', text: inPrompt.value || '(글감·안내)' }), h('p', { text: '평가 기준: ' + state.criteria.map(function (c) { return c.name; }).join(' · ') }), h('p', { class: 'hint', text: '최소 ' + (inMin.value || '제한 없음') + ' / 최대 ' + (inMax.value || '제한 없음') + '자 · 필수 낱말: ' + (inWords.value || '없음') }), btnSave);
      }
    }
    labels.forEach(function (label, i) { tabs.appendChild(h('button', { text: label, onclick: function () { showStep(i); } })); });
    var moves = h('div', { class: 'actions' }, [h('button', { class: 'ghost', text: '이전 단계', onclick: function () { showStep(Math.max(0, currentStep - 1)); } }), h('button', { text: '다음 단계', onclick: function () { showStep(Math.min(2, currentStep + 1)); } })]);
    btnSave.remove();
    render(tabs, card, critCard, preview, moves);
    showStep(0);
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
    var viewTicket = ++routeVersion;
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '제출 현황을 불러오는 중…' })]));
    teacherApi('submission.list', { taskId: taskId })
      .then(function (d) { if (viewTicket !== routeVersion) return;
        var c = d.counts;
        var criteria = d.task.criteria || [];
        submissionNavigation = d.rows.filter(function (r) { return r.submissionId; }).map(function (r) { return { id: r.submissionId, name: r.no + '번 ' + r.name }; });
        var graded = d.rows.filter(function (r) { return r.feedback; });

        var summary = h('div', { class: 'count-row' }, [
          h('div', { class: 'count' }, [h('b', { text: String(c.submitted + c.done) }), h('span', { text: '제출' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.done) }), h('span', { text: '피드백 완료' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.draft) }), h('span', { text: '작성 중' })]),
          h('div', { class: 'count' }, [h('b', { text: String(c.none) }), h('span', { text: '미작성 / ' + c.total }) ])
        ]);

        // ── 학급 한눈에: 기준별 분포·평균, 낮은 기준, 고칠 곳 유형 ──
        var overview = null;
        if (graded.length) {
          var stats = criteria.map(function (cr) {
            var dist = [0, 0, 0, 0, 0]; var sum = 0, n = 0;
            graded.forEach(function (r) {
              var lvRow = r.feedback.levels.filter(function (l) { return l.id === cr.id; })[0];
              if (lvRow && lvRow.level >= 1) { dist[lvRow.level]++; sum += lvRow.level; n++; }
            });
            return { id: cr.id, name: cr.name, dist: dist, avg: n ? sum / n : 0, n: n };
          });
          var weakest = stats.filter(function (x) { return x.n; }).sort(function (a, b) { return a.avg - b.avg; }).slice(0, 2);
          var kindCount = {};
          graded.forEach(function (r) { (r.feedback.correctionKinds || []).forEach(function (k) { kindCount[k] = (kindCount[k] || 0) + 1; }); });
          var kinds = Object.keys(kindCount).sort(function (a, b) { return kindCount[b] - kindCount[a]; });

          var bars = h('div', { class: 'stat-list' }, stats.map(function (st) {
            var total = st.n || 1;
            return h('div', { class: 'stat-row' }, [
              h('div', { class: 'stat-name' }, [st.name, h('span', { class: 'stat-avg', text: st.n ? ' 평균 ' + st.avg.toFixed(1) : ' -' })]),
              h('div', { class: 'stat-bar' }, [1, 2, 3, 4].map(function (L) {
                var w = st.dist[L] / total * 100;
                return w ? h('div', { class: 'stat-seg lv' + L, style: 'width:' + w + '%', title: L + '단계 ' + st.dist[L] + '명', text: st.dist[L] ? lv(L).emoji + st.dist[L] : '' }) : null;
              }))
            ]);
          }));
          overview = h('div', { class: 'card overview-card' }, [
            h('h2', { text: '학급 한눈에' }),
            h('p', { class: 'desc', text: '피드백을 받은 ' + graded.length + '명의 최근 차수 기준 · 선생님이 바꾼 단계가 있으면 그것으로 셈' }),
            bars,
            h('div', { class: 'overview-notes' }, [
              weakest.length ? h('p', {}, [h('b', { text: '함께 지도하면 좋을 기준: ' }), weakest.map(function (w) { return w.name + '(' + w.avg.toFixed(1) + ')'; }).join(', ')]) : null,
              kinds.length ? h('p', {}, [h('b', { text: '자주 나온 고칠 곳: ' }), kinds.map(function (k) { return k + ' ' + kindCount[k] + '건'; }).join(' · ')]) : null
            ])
          ]);
        }

        // ── 학생별 표 (피드백 펼쳐 보기) ──
        var tbody = h('tbody');
        d.rows.forEach(function (r) {
          var canOpen = !!r.submissionId;
          var fb = r.feedback;
          var levelsCell = fb ? h('span', { class: 'lv-string', title: fb.levels.map(function (l) { return l.name + ' ' + l.level; }).join(' / ') }, fb.levels.map(function (l) {
            return h('span', { class: 'lv-chip' + (l.overridden ? ' ov' : ''), text: lv(l.level).emoji });
          })) : h('span', { class: 'muted', text: '-' });
          var btnMore = fb ? h('button', { class: 'small ghost', text: '피드백' }) : null;
          var tr = h('tr', { class: (r.state === '미작성' ? 'dim' : '') }, [
            h('td', { text: r.no }),
            h('td', {}, [r.name, fb && fb.hasTeacherNote ? h('span', { class: 'badge done', text: '한마디', style: 'margin-left:6px;font-size:10px' }) : null]),
            h('td', {}, [stateBadge(r.state), r.finished ? h('span', { class: 'badge off', text: '끝', style: 'margin-left:4px' }) : null]),
            h('td', { text: r.round ? r.round + '차' : '-' }),
            h('td', {}, [levelsCell]),
            h('td', { class: 'act' }, [btnMore, canOpen ? h('a', { href: '#/teacher/submission/' + r.submissionId, class: 'btn small secondary', text: '보기' }) : null])
          ]);
          tr.dataset.state = r.state; tr.dataset.name = r.name; tr.dataset.note = fb && fb.hasTeacherNote ? 'yes' : 'no';
          tbody.appendChild(tr);
          if (fb) {
            var detail = h('tr', { class: 'fb-row', style: 'display:none' }, [
              h('td', { colspan: '6' }, [
                h('div', { class: 'fb-inline' }, [
                  h('div', { class: 'muted', text: fb.round + '차 피드백 · ' + fmtTime(fb.createdAt) + ' · 고칠 곳 ' + fb.correctionsCount + '개' }),
                  h('div', { class: 'fb-inline-levels' }, fb.levels.map(function (l) { return h('span', { class: 'badge', text: l.name + ' ' + l.level + (l.overridden ? '*' : '') }); })),
                  fb.summaryText ? h('p', { class: 'fb-inline-summary', text: fb.summaryText }) : null,
                  fb.improvements && fb.improvements.length ? h('ul', { class: 'fb-inline-list' }, fb.improvements.map(function (x) { return h('li', { text: x }); })) : null,
                  fb.nextTry ? h('p', {}, [h('b', { text: '🎯 ' }), fb.nextTry]) : null,
                  h('a', { href: '#/teacher/submission/' + fb.submissionId, class: 'btn small secondary', text: '전체 피드백 · 한마디 쓰기 →' })
                ])
              ])
            ]);
            tr._detail = detail;
            tbody.appendChild(detail);
            btnMore.addEventListener('click', function () {
              var open = detail.style.display !== 'none';
              detail.style.display = open ? 'none' : '';
              btnMore.textContent = open ? '피드백' : '접기';
            });
          }
        });
        var table = h('table', { class: 'sub-table' }, [
          h('thead', {}, [h('tr', {}, [h('th', { text: '번호' }), h('th', { text: '이름' }), h('th', { text: '상태' }), h('th', { text: '차수' }), h('th', { text: '단계' }), h('th', { text: '' })])]),
          tbody
        ]);
        var btnAll = h('button', { class: 'small ghost', text: '피드백 모두 펼치기', onclick: function () {
          var rows = tbody.querySelectorAll('.fb-row');
          var anyClosed = [].some.call(rows, function (x) { return x.style.display === 'none'; });
          [].forEach.call(rows, function (x) { x.style.display = anyClosed ? '' : 'none'; });
          [].forEach.call(tbody.querySelectorAll('button.ghost'), function (b) { if (b !== btnAll) b.textContent = anyClosed ? '접기' : '피드백'; });
          btnAll.textContent = anyClosed ? '피드백 모두 접기' : '피드백 모두 펼치기';
        } });

        var search = h('input', { type: 'text', placeholder: '학생 이름 검색', 'aria-label': '학생 이름 검색' });
        var filter = h('select', { 'aria-label': '제출 상태 필터' }, ['전체', '미작성', '작성 중', '제출됨', '피드백완료', '교사 한마디 없음'].map(function (x) { return h('option', { value: x, text: x === '제출됨' ? '피드백 대기' : x }); }));
        function applyFilter() {
          [].forEach.call(tbody.querySelectorAll('tr[data-state]'), function (row) {
            var visible = row.dataset.name.indexOf(search.value.trim()) >= 0 && (filter.value === '전체' || (filter.value === '교사 한마디 없음' ? row.dataset.note === 'no' : row.dataset.state === filter.value));
            row.hidden = !visible; if (row._detail) row._detail.hidden = !visible;
          });
        }
        search.addEventListener('input', applyFilter); filter.addEventListener('change', applyFilter);
        var card = h('div', { class: 'card' }, [
          h('span', { class: 'badge genre', text: d.task.genreLabel }),
          h('span', { class: 'badge' + (d.task.status === '열림' ? '' : ' off'), text: d.task.status, style: 'margin-left:6px' }),
          h('h2', { text: d.task.title, style: 'margin-top:8px' }),
          summary,
          h('div', { class: 'row', style: 'justify-content:space-between;margin:8px 0' }, [
            h('span', { class: 'muted', text: '단계: ' + LEVELS.slice(1).map(function (L) { return L.emoji + L.n; }).join(' ') + '  (* 선생님이 바꾼 단계)' }),
            graded.length ? h('div', { class: 'fit' }, [btnAll]) : null
          ]),
          h('div', { class: 'review-filters' }, [search, filter]),
          h('div', { class: 'table-wrap' }, [table]),
          h('div', { class: 'actions' }, [
            h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' }),
            h('button', { class: 'small secondary', text: '새로고침', onclick: function () { viewSubmissions(classId, taskId); } })
          ])
        ]);
        render(card, overview);
      })
      .catch(function (e) { if (viewTicket !== routeVersion) return; render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/class/' + classId + '/tasks', class: 'btn ghost small', text: '← 과제 목록' })])); });
  }

  // ───────────────────────────────────────────
  // 교사: 제출글 보기
  // ───────────────────────────────────────────
  function viewSubmissionDetail(submissionId) {
    var viewTicket = ++routeVersion;
    if (teacherNoteCleanup) { teacherNoteCleanup(); teacherNoteCleanup = null; }
    if (!ssGet(KEYS.teacherToken)) { go('/teacher'); return; }
    render(h('div', { class: 'card' }, [h('div', { class: 'loading', text: '글을 불러오는 중…' })]));
    teacherApi('submission.get', { submissionId: submissionId })
      .then(function (d) { if (viewTicket !== routeVersion) return;
        var sub = d.submission;
        var task = d.task;
        var backHref = task ? '#/teacher/class/' + task.classId + '/tasks/' + task.taskId + '/submissions' : '#/teacher/classes';
        var actions = [h('a', { href: backHref, class: 'btn ghost small', text: '← 제출 현황' })];
        if (sub.status === '제출됨') {
          actions.push(h('button', { class: 'small danger', text: '제출 되돌리기 (학생이 다시 고치게)', onclick: function (ev) {
            if (!confirm(sub.name + ' 학생의 ' + sub.round + '차 제출을 되돌릴까요? 학생이 다시 고쳐서 제출할 수 있게 돼요.')) return;
            var b = ev.currentTarget; setBusy(b, true);
            teacherApi('submission.reopen', { submissionId: submissionId })
              .then(function () { if (viewTicket !== routeVersion) return; toast('되돌렸어요. 학생 화면에서 다시 고칠 수 있어요.'); viewSubmissionDetail(submissionId); })
              .catch(function (e) { if (viewTicket !== routeVersion) return; toast(e.message, true); setBusy(b, false); });
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
        var teacherCard = null;
        if (sub.status !== '임시저장' && sub.feedback) {
          teacherCard = buildTeacherEditCard(submissionId, sub.feedback, task ? task.criteria : []);
        }
        if (sub.status !== '임시저장') {
          var btnRegen = h('button', { class: 'small secondary', text: sub.feedback ? '🔄 다시 채점' : '🤖 AI 채점 실행', onclick: function (ev) {
            if (sub.feedback && !confirm('AI 피드백을 다시 만들까요? 기존 AI 결과는 덮어써요. (교사 한마디·최종 단계는 유지)')) return;
            var b = ev.currentTarget; setBusy(b, true, 'AI가 읽는 중…');
            teacherApi('feedback.regenerate', { submissionId: submissionId })
              .then(function () { if (viewTicket !== routeVersion) return; toast('AI 피드백을 만들었어요.'); viewSubmissionDetail(submissionId); })
              .catch(function (e) { if (viewTicket !== routeVersion) return; toast(e.message, true); setBusy(b, false); });
          } });
          fbCard = sub.feedback
            ? renderFeedback(sub.feedback, sub, { forStudent: false, extraActions: [btnRegen] })
            : h('div', { class: 'card' }, [
                h('div', { class: 'feedback-placeholder' }, [h('span', { class: 'big-emoji', text: '🤖' }), '아직 AI 피드백이 없어요. (제출 때 AI 호출이 실패했을 수 있어요)']),
                h('div', { class: 'actions' }, [btnRegen])
              ]);
        }
        var prev = null;
        var priorRound = d.rounds.filter(function (r) { return r.round < sub.round; }).sort(function (a,b) { return b.round-a.round; })[0];
        if (priorRound) card.appendChild(h('details', {}, [h('summary', { text: '이전 글과 달라진 부분' }), renderComparison(priorRound.text, sub.text)]));
        var others = d.rounds.filter(function (r) { return r.submissionId !== submissionId; });
        if (others.length) {
          prev = h('div', { class: 'card' }, [h('h3', { text: '다른 차수', style: 'margin-top:0' })].concat(others.map(function (r) {
            return h('details', { class: 'prev-round' }, [
              h('summary', { text: r.round + '차 · ' + (r.status === '임시저장' ? '작성 중' : r.status) + ' · ' + r.charCount + '자 · ' + fmtTime(r.submittedAt || r.savedAt) + (r.feedback ? ' · ' + levelSummary(r.feedback) : '') }),
              h('div', { class: 'essay-view', text: r.text })
            ]);
          })));
        }
        var nav = h('nav', { class: 'student-review-nav', 'aria-label': '학생 글 이동' }, submissionNavigation.map(function (item) { return h('a', { href: '#/teacher/submission/' + item.id, class: 'btn small ' + (item.id === submissionId ? '' : 'ghost'), text: item.name, 'aria-current': item.id === submissionId ? 'page' : null }); }));
        render(nav, h('div', { class: 'review-workspace' }, [h('div', {}, [card, prev]), h('div', {}, [teacherCard, fbCard])]));
      })
      .catch(function (e) { if (viewTicket !== routeVersion) return; render(h('div', { class: 'card' }, [h('p', { class: 'bad', text: e.message }), h('a', { href: '#/teacher/classes', class: 'btn ghost small', text: '← 학급 목록' })])); });
  }

  // 교사 한마디 · 기준별 최종 단계 편집 카드
  function buildTeacherEditCard(submissionId, fb, criteria) {
    var note = h('textarea', { placeholder: '학생에게 직접 전하고 싶은 말을 적어 주세요. 학생 화면의 피드백 아래에 "선생님 한마디"로 보여요.', style: 'min-height:90px' });
    note.value = fb.teacherNote || '';
    var selects = {};
    var rows = (fb.criteria || []).map(function (c) {
      var sel = h('select', {}, [h('option', { value: '0', text: 'AI 판정 그대로 (' + c.level + '단계)' })].concat([1, 2, 3, 4].map(function (L) {
        return h('option', { value: String(L), text: L + '단계 ' + lv(L).name + (L === c.level ? ' (AI와 같음)' : '') });
      })));
      var cur = fb.finalLevels && fb.finalLevels[c.id];
      sel.value = cur ? String(cur) : '0';
      selects[c.id] = sel;
      return h('div', { class: 'final-row' }, [
        h('span', { class: 'final-name' }, [lv(c.level).emoji + ' ', h('b', { text: c.name })]),
        sel
      ]);
    });
    var btn = h('button', { class: 'big', text: '선생님 한마디 · 단계 저장' });
    var initialNote = note.value;
    var initialLevels = JSON.stringify(Object.keys(selects).map(function (id) { return selects[id].value; }));
    function teacherDirty() { return initialNote !== note.value || initialLevels !== JSON.stringify(Object.keys(selects).map(function (id) { return selects[id].value; })); }
    function warnNote(ev) { if (teacherDirty()) { ev.preventDefault(); ev.returnValue = ''; } }
    window.addEventListener('beforeunload', warnNote);
    var guard = function (ev) { var link = ev.target.closest('a[href]'); if (link && teacherDirty() && !confirm('선생님 한마디·단계를 아직 저장하지 않았어요. 이동할까요?')) { ev.preventDefault(); ev.stopPropagation(); } };
    document.addEventListener('click', guard, true);
    teacherNoteCleanup = function () { window.removeEventListener('beforeunload', warnNote); document.removeEventListener('click', guard, true); };
    btn.addEventListener('click', function () {
      var finalLevels = {};
      Object.keys(selects).forEach(function (id) { var v = parseInt(selects[id].value, 10); if (v) finalLevels[id] = v; });
      setBusy(btn, true, '저장 중…');
      note.disabled = true; Object.keys(selects).forEach(function (id) { selects[id].disabled = true; });
      teacherApi('feedback.teacher', { submissionId: submissionId, teacherNote: note.value.trim(), finalLevels: finalLevels })
        .then(function () { initialNote = note.value; initialLevels = JSON.stringify(Object.keys(selects).map(function (id) { return selects[id].value; })); toast('저장했어요. 학생 화면에 반영돼요.'); setBusy(btn, false); })
        .catch(function (e) { toast(e.message, true); setBusy(btn, false); }).finally(function () { note.disabled = false; Object.keys(selects).forEach(function (id) { selects[id].disabled = false; }); });
    });
    return h('div', { class: 'card teacher-edit' }, [
      h('h2', { text: '👩‍🏫 선생님 한마디 · 최종 단계' }),
      h('p', { class: 'desc', text: 'AI 판정이 교사 판단과 다르면 여기서 바꿔 주세요. 바꾼 단계는 학생에게 "선생님 판정"으로 표시되고, 학급 통계에도 그 값이 쓰여요. AI를 다시 채점해도 여기 쓴 내용은 유지돼요.' }),
      h('label', { text: '선생님 한마디' }), note,
      h('label', { text: '기준별 최종 단계' }),
      h('div', { class: 'final-list' }, rows),
      btn
    ]);
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
            h('span', { class: 'growth-delta ' + (up ? 'up' : down ? 'down' : ''), text: up ? '새롭게 자란 부분' : down ? '다시 살펴볼 부분' : '유지한 부분' }),
            g.comment ? h('div', { class: 'growth-comment', text: g.comment }) : null
          ]);
        }))
      ]);
    }

    var teacherNote = fb.teacherNote ? h('div', { class: 'fb-block fb-teacher' }, [h('h3', { text: '👩‍🏫 선생님 한마디' }), h('p', { text: fb.teacherNote })]) : null;

    var head = h('div', { class: 'fb-head' }, [
      h('div', {}, [
        h('div', { class: 'muted', text: who + sub.round + '차 피드백 · ' + fmtTime(fb.createdAt) + (forStudent ? '' : ' · ' + (fb.model || '')) }),
        h('h2', { text: forStudent ? '🌱 AI 글쓰기 도우미' : 'AI 피드백', style: 'margin:4px 0 0' })
      ]),
      opts.extraActions ? h('div', { class: 'fit actions', style: 'margin:0' }, opts.extraActions) : null
    ]);

    var feedbackDetails = h('details', { class: 'feedback-details' }, [h('summary', { text: '기준별 근거와 자세한 피드백 보기' }), grid, details, growth, list('👍 잘한 점', fb.strengths, 'fb-good'), list('🔧 고쳐 볼 점', fb.improvements, 'fb-fix'), corrections]);
    if (!forStudent) feedbackDetails.open = true;
    return h('div', { class: 'card fb-card' }, [
      head,
      fb.summary ? h('div', { class: 'fb-summary', text: fb.summary }) : null,
      forStudent && fb.strengths && fb.strengths.length ? list('잘한 점', [fb.strengths[0]], 'fb-good') : null,
      fb.nextTry ? h('div', { class: 'fb-block fb-next' }, [h('h3', { text: '🎯 다음에 꼭 해 볼 한 가지' }), h('p', { text: fb.nextTry })]) : null,
      feedbackDetails,
      teacherNote
    ]);
  }

  // ───────────────────────────────────────────
  // 시작
  // ───────────────────────────────────────────
  lsDel('geulsup_student'); ssDel('geulsup_teacher_pw');
  readLinkParams();
  window.addEventListener('hashchange', route);
  route();

  // 테스트용 노출 (브라우저 콘솔)
  window.__geulsup = { version: APP_VERSION, uiVersion: UI_VERSION, parseRoster: parseRoster, extractDeployId: extractDeployId, taskConditionText: taskConditionText, bandForGrade: bandForGrade, countChars: countChars, conditionChecks: conditionChecks, fmtTime: fmtTime, levelSummary: levelSummary };
})();
