/**
 * 글숲 (geulsup) — 학생 글쓰기 AI 피드백 앱 · 화면 로직
 * © 2026 영쌤클래스 · 교육용으로 제작 · 무단 복제·재배포 금지
 *
 * v0.1.0 — 1단계: 기반
 *   - 교사: 배포 URL 등록 → 연결 테스트 → 비밀번호 로그인 → 학급 개설 · 명단 · 링크/QR
 *   - 학생: 학급 링크(?s=배포ID&c=학급코드) 또는 코드 직접 입력 → 번호·이름으로 입장
 *
 * 서버: Google Apps Script 웹 앱 (Code.gs) — POST JSON, {ok, data} 규약
 */

(function () {
  'use strict';

  var APP_VERSION = '0.1.0';

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
    if (path.indexOf('/teacher/class/') === 0) return viewClassDetail(path.split('/')[3]);
    if (path === '/class') return viewStudentHome();
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
    } else if (student && path === '/class') {
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
  // 학생 홈 (1단계: 입장 확인 + 자리만 잡아 둠)
  // ───────────────────────────────────────────
  function viewStudentHome() {
    var s = getStudent();
    if (!s) { go('/'); return; }
    var card = h('div', { class: 'card student-home' }, [
      h('div', { class: 'muted', text: s.className }),
      h('div', { class: 'greet', text: s.name + ' 님, 어서 와요! 🌱' }),
      h('div', { class: 'empty' }, [
        h('span', { class: 'big-emoji', text: '✏️' }),
        '아직 글쓰기 과제가 없어요.',
        h('br'),
        h('span', { class: 'muted', text: '선생님이 과제를 올리면 여기에 나타나요.' })
      ])
    ]);
    render(card);
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
              h('div', { class: 'meta', text: c.grade + '학년 · 학생 ' + c.studentCount + '명 · ' + String(c.createdAt).slice(0, 10) }),
              h('div', { class: 'code', text: c.code })
            ]),
            h('div', { class: 'btns' }, [
              h('a', { href: '#/teacher/class/' + c.classId, class: 'btn small secondary', text: '링크·QR·명단' })
            ])
          ]));
        });
      })
      .catch(function (e) { clear(list); list.appendChild(h('p', { class: 'bad', text: e.message })); });

    teacherApi('teacher.status')
      .then(function (d) {
        clear(statusBox);
        statusBox.appendChild(h('li', {}, [h('span', { class: d.checks.sheets ? 'ok' : 'bad', text: d.checks.sheets ? '✅' : '❌' }), ' 시트 초기화 ' + (d.checks.sheets ? '완료' : '필요 (메뉴 → 시트 초기화)')]));
        statusBox.appendChild(h('li', {}, [h('span', { class: d.checks.apiKey ? 'ok' : 'bad', text: d.checks.apiKey ? '✅' : '❌' }), ' Gemini API 키 ' + (d.checks.apiKey ? '등록됨 (' + d.teacher.model + ')' : '없음 — 설정 시트에 입력하세요')]));
        statusBox.appendChild(h('li', {}, [h('span', { class: 'ok', text: '✅' }), ' 교사 비밀번호 설정됨']));
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
  // 시작
  // ───────────────────────────────────────────
  readLinkParams();
  window.addEventListener('hashchange', route);
  route();

  // 테스트용 노출 (브라우저 콘솔)
  window.__geulsup = { version: APP_VERSION, parseRoster: parseRoster, extractDeployId: extractDeployId };
})();
