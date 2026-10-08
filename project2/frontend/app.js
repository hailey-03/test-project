const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'X-Requested-By': 'resource-manager', ...(options.headers || {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
  return body;
}

const postJson = (path, data) => api(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

// ---------- 공통 UI ----------
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function confirmModal({ title, text, okLabel, danger }) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    const ok = $('#modalOk');
    ok.textContent = okLabel;
    ok.className = 'btn' + (danger ? ' btn-danger' : '');
    $('#modal').classList.remove('hidden');
    const close = (result) => {
      $('#modal').classList.add('hidden');
      ok.onclick = $('#modalCancel').onclick = $('#modal').onclick = null;
      resolve(result);
    };
    ok.onclick = () => close(true);
    $('#modalCancel').onclick = () => close(false);
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') close(false); };
  });
}

function openDetail(title, html) {
  $('#detailTitle').textContent = title;
  $('#detailBody').innerHTML = html;
  $('#detail').classList.remove('hidden');
}
$('#detailClose').onclick = () => $('#detail').classList.add('hidden');
$('#detail').onclick = (e) => { if (e.target.id === 'detail') $('#detail').classList.add('hidden'); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#detail').classList.add('hidden');
});

function markUpdated() {
  $('#updatedAt').textContent = '마지막 갱신 ' + new Date().toLocaleTimeString('ko-KR');
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatUptime(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}분`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}시간 ${mins % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

const fmtTime = (iso) => new Date(iso).toLocaleString('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmtHM = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

const STATE_LABEL = {
  running: '실행 중', stopped: '중지됨', pending: '시작 중',
  stopping: '중지 중', 'shutting-down': '종료 중', terminated: '종료됨',
};
const ACTION_LABEL = { start: '시작', stop: '중지', reboot: '재부팅' };
const ACTION_PILL = { start: 'green', stop: 'red', reboot: 'slate' };
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

const ICON = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  bucket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  reboot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:13px;height:13px"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
};

function stat(label, value, dot, unit = '') {
  return `<div class="stat">
    <div class="stat-label">${dot ? `<span class="dot ${dot}"></span>` : ''}${label}</div>
    <div class="stat-value">${value}${unit ? `<small>${unit}</small>` : ''}</div>
  </div>`;
}

// ---------- 탭 ----------
const PAGES = {
  ec2: ['EC2 인스턴스', '내 인스턴스의 상태 · CPU · 보안을 확인하고 시작 · 중지 · 재부팅할 수 있어요.'],
  s3: ['S3 버킷', '내 버킷의 파일을 둘러보고 다운로드 · 업로드할 수 있어요.'],
  schedule: ['자동 스케줄', '정해진 요일 · 시간에 인스턴스를 자동으로 시작하거나 중지해요.'],
  logs: ['작업 기록', '누가 언제 인스턴스를 시작 · 중지했는지 확인해요.'],
  cost: ['비용 (추정)', '실행 중인 인스턴스의 온디맨드 단가로 계산한 예상 비용이에요.'],
};
let currentTab = 'ec2';

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `tab-${currentTab}`));
    loadTab();
  });
});
$('#refreshBtn').addEventListener('click', () => { cache.clear(); loadTab(); });

function loadTab() {
  const [title, desc] = PAGES[currentTab];
  $('#pageTitle').textContent = title;
  $('#pageDesc').textContent = desc;
  ({ ec2: loadEc2, s3: loadBuckets, schedule: loadSchedules, logs: loadLogs, cost: loadCost })[currentTab]();
}

// CPU · 보안그룹은 자주 바뀌지 않으므로 1분간 재사용
const cache = new Map();
async function cached(key, fn, ttl = 60000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- EC2 ----------
let pollTimer;
let instances = [];

async function loadEc2() {
  const grid = $('#ec2Grid');
  if (!instances.length) grid.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const [list, cost] = await Promise.all([api('/api/ec2'), api('/api/cost')]);
    instances = list;
    const running = list.filter((i) => i.state === 'running').length;
    const stopped = list.filter((i) => i.state === 'stopped').length;
    $('#ec2Stats').innerHTML =
      stat('전체 인스턴스', list.length, null, '대') +
      stat('실행 중', running, 'green', '대') +
      stat('중지됨', stopped, 'red', '대') +
      stat('현재 시간당 비용', `$${cost.hourly}`, 'accent');

    grid.innerHTML = list.length ? list.map(renderInstance).join('')
      : '<div class="empty-state">이름에 키워드가 포함된 인스턴스가 없어요</div>';
    markUpdated();
    list.forEach(loadInstanceExtras);

    clearTimeout(pollTimer);
    if (list.some((i) => ['pending', 'stopping'].includes(i.state)) && currentTab === 'ec2') {
      pollTimer = setTimeout(loadEc2, 5000);
    }
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

function renderInstance(i) {
  const isRunning = i.state === 'running';
  const lock = i.isSelf ? 'disabled title="이 페이지가 실행 중인 서버라 중지할 수 없어요"' : '';
  return `
  <article class="instance ${esc(i.state)}" data-instance="${esc(i.id)}">
    <div class="instance-head">
      <div>
        <div class="instance-name">${esc(i.name)}</div>
        <div class="instance-id mono">${esc(i.id)}</div>
        ${i.isSelf ? '<span class="self-badge">이 페이지가 실행 중인 서버</span>' : ''}
        <button class="sg-chip" data-sg="${esc(i.id)}">${ICON.shield}보안 확인 중…</button>
      </div>
      <span class="status ${esc(i.state)}">${STATE_LABEL[i.state] || esc(i.state)}</span>
    </div>
    <dl class="meta">
      <div><dt>타입</dt><dd class="mono">${esc(i.type)}</dd></div>
      <div><dt>가동 시간</dt><dd>${isRunning && i.launchTime ? formatUptime(i.launchTime) : '-'}</dd></div>
      <div><dt>사설 IP</dt><dd class="mono">${esc(i.privateIp || '-')}</dd></div>
      <div><dt>공인 IP</dt><dd class="mono">${esc(i.publicIp || '-')}</dd></div>
    </dl>
    <div class="cpu" data-cpu="${esc(i.id)}"><div class="cpu-empty">CPU 불러오는 중…</div></div>
    <div class="actions">
      <button class="btn btn-start" data-id="${esc(i.id)}" data-action="start" ${i.state !== 'stopped' ? 'disabled' : ''}>${ICON.play}시작</button>
      <button class="btn btn-stop" data-id="${esc(i.id)}" data-action="stop" ${!isRunning ? 'disabled' : lock}>${ICON.stop}중지</button>
      <button class="btn btn-reboot" data-id="${esc(i.id)}" data-action="reboot" ${!isRunning ? 'disabled' : lock}>${ICON.reboot}재부팅</button>
    </div>
  </article>`;
}

function loadInstanceExtras(inst) {
  cached(`cpu:${inst.id}`, () => api(`/api/ec2/${inst.id}/cpu`))
    .then((data) => {
      const el = document.querySelector(`[data-cpu="${inst.id}"]`);
      if (el) renderCpu(el, data);
    })
    .catch((e) => {
      const el = document.querySelector(`[data-cpu="${inst.id}"]`);
      if (el) el.innerHTML = `<div class="cpu-empty">${esc(e.message)}</div>`;
    });

  cached(`sg:${inst.id}`, () => api(`/api/ec2/${inst.id}/security`))
    .then((sg) => {
      const chip = document.querySelector(`[data-sg="${inst.id}"]`);
      if (!chip) return;
      chip.classList.add(sg.openCount ? 'warn' : 'ok');
      chip.innerHTML = `${ICON.shield}${sg.openCount ? `전체 공개 포트 ${sg.openCount}개` : '보안 양호'}`;
    })
    .catch(() => {
      const chip = document.querySelector(`[data-sg="${inst.id}"]`);
      if (chip) chip.innerHTML = `${ICON.shield}보안 정보 없음`;
    });
}

// CPU 미니 차트: 한 개 시리즈라 범례 없이 제목으로 이름을 붙이고, 마우스를 올리면 값 표시
function renderCpu(el, data) {
  const pts = data.points;
  if (!pts.length) {
    el.innerHTML = '<div class="cpu-head"><span>CPU 사용률 · 24시간</span></div><div class="cpu-empty">데이터 없음 (중지 상태였거나 아직 수집 전)</div>';
    return;
  }
  const W = 300, H = 72;
  const end = Date.now(), start = end - data.hours * 3600000;
  const peak = Math.max(...pts.map((p) => p.avg));
  const avg = pts.reduce((s, p) => s + p.avg, 0) / pts.length;
  const yMax = [5, 10, 20, 50, 100].find((n) => n >= peak * 1.2) || 100;
  const x = (t) => ((new Date(t) - start) / (end - start)) * W;
  const y = (v) => H - (v / yMax) * H;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.avg).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.at(-1).t).toFixed(1)},${H}L${x(pts[0].t).toFixed(1)},${H}Z`;
  const now = pts.at(-1).avg;

  el.innerHTML = `
    <div class="cpu-head">
      <span>CPU 사용률 · 24시간</span>
      <span class="cpu-now">현재 <b>${now.toFixed(1)}%</b> · 평균 ${avg.toFixed(1)}% · 최고 ${peak.toFixed(1)}%</span>
    </div>
    <div class="cpu-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="최근 24시간 CPU 평균 ${avg.toFixed(1)}%, 최고 ${peak.toFixed(1)}%">
        <line class="cpu-grid dash" x1="0" x2="${W}" y1="0" y2="0"/>
        <line class="cpu-grid dash" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>
        <path class="cpu-area" d="${area}"/>
        <path class="cpu-line" d="${line}"/>
        <line class="cpu-grid" x1="0" x2="${W}" y1="${H}" y2="${H}"/>
      </svg>
      <span class="cpu-ymax">${yMax}%</span>
      <div class="cpu-hover"></div>
    </div>
    <div class="cpu-axis"><span>24시간 전</span><span>12시간 전</span><span>지금</span></div>`;

  const hover = el.querySelector('.cpu-hover');
  const chart = el.querySelector('.cpu-chart');
  let cursor, dot, tip;
  hover.addEventListener('mousemove', (e) => {
    const rect = hover.getBoundingClientRect();
    const t = start + ((e.clientX - rect.left) / rect.width) * (end - start);
    const p = pts.reduce((a, b) => (Math.abs(new Date(b.t) - t) < Math.abs(new Date(a.t) - t) ? b : a));
    const left = `${(x(p.t) / W) * 100}%`;
    if (!cursor) {
      cursor = Object.assign(document.createElement('div'), { className: 'cpu-cursor' });
      dot = Object.assign(document.createElement('div'), { className: 'cpu-dot' });
      tip = Object.assign(document.createElement('div'), { className: 'cpu-tip' });
      chart.append(cursor, dot, tip);
    }
    cursor.style.left = dot.style.left = left;
    dot.style.top = `${(y(p.avg) / H) * 100}%`;
    const frac = x(p.t) / W;
    tip.style.left = `clamp(60px, ${frac * 100}%, calc(100% - 60px))`;
    tip.innerHTML = `${fmtHM(p.t)} · 평균 <b>${p.avg.toFixed(1)}%</b> · 최고 ${p.max.toFixed(1)}%`;
  });
  hover.addEventListener('mouseleave', () => {
    [cursor, dot, tip].forEach((n) => n && n.remove());
    cursor = dot = tip = null;
  });
}

async function showSecurity(instanceId) {
  const inst = instances.find((i) => i.id === instanceId);
  openDetail(`보안그룹 · ${inst?.name || instanceId}`, '<p class="muted">불러오는 중…</p>');
  try {
    const sg = await cached(`sg:${instanceId}`, () => api(`/api/ec2/${instanceId}/security`));
    const summary = sg.openCount
      ? `<div class="sg-summary warn">⚠️ 인터넷 전체(0.0.0.0/0)에 열린 포트가 <b>${sg.openCount}개</b> 있어요. 필요한 IP만 허용하도록 줄이는 걸 권장해요. (웹 포트 80/443은 제외)</div>`
      : '<div class="sg-summary ok">✅ 인터넷 전체에 열린 위험한 포트가 없어요.</div>';
    const blocks = sg.groups.map((g) => `
      <div class="sg-block">
        <div class="sg-block-head">${esc(g.name)}<span class="mono">${esc(g.id)}</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>프로토콜</th><th>포트</th><th>허용 대상</th><th>설명</th><th></th></tr></thead>
            <tbody>${g.rules.map((r) => `
              <tr class="${r.risky ? 'risky' : ''}">
                <td>${esc(r.protocol)}</td>
                <td class="mono">${esc(r.ports === '-1' ? '전체' : r.ports)}</td>
                <td class="mono">${esc(r.source)}</td>
                <td class="muted">${esc(r.description || '-')}</td>
                <td>${r.risky ? '<span class="pill red">전체 공개</span>' : r.open ? '<span class="pill amber">공개 (웹)</span>' : '<span class="pill green">제한됨</span>'}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">인바운드 규칙 없음</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`).join('');
    $('#detailBody').innerHTML = summary + blocks;
  } catch (e) {
    $('#detailBody').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

$('#ec2Grid').addEventListener('click', async (e) => {
  const sgBtn = e.target.closest('[data-sg]');
  if (sgBtn) return showSecurity(sgBtn.dataset.sg);

  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { id, action } = btn.dataset;
  const name = instances.find((i) => i.id === id)?.name || id;

  if (action !== 'start') {
    const ok = await confirmModal({
      title: `인스턴스를 ${ACTION_LABEL[action]}할까요?`,
      text: `${name} (${id})\n${action === 'stop' ? '중지하면 이 서버에서 돌아가는 서비스가 멈춰요.' : '잠시 서비스가 끊겼다가 다시 시작돼요.'}`,
      okLabel: ACTION_LABEL[action],
      danger: action === 'stop',
    });
    if (!ok) return;
  }

  btn.classList.add('loading');
  try {
    await api(`/api/ec2/${id}/${action}`, { method: 'POST' });
    toast(`${name} ${ACTION_LABEL[action]} 요청을 보냈어요`);
    setTimeout(loadEc2, 1500);
  } catch (err) {
    toast(err.message, true);
    btn.classList.remove('loading');
  }
});

// ---------- S3 ----------
let currentBucket = null;
let currentPrefix = '';
let currentFiles = [];

async function loadBuckets() {
  const ul = $('#bucketList');
  try {
    const buckets = await api('/api/s3');
    ul.innerHTML = buckets.length
      ? buckets.map((b) => `<li data-bucket="${esc(b.name)}" class="${b.name === currentBucket ? 'active' : ''}">${ICON.bucket}${esc(b.name)}</li>`).join('')
      : '<li class="empty muted">내 버킷이 없어요</li>';
    markUpdated();
    if (currentBucket) loadObjects(currentPrefix);
  } catch (e) {
    ul.innerHTML = `<li class="empty muted">${esc(e.message)}</li>`;
  }
}

$('#bucketList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-bucket]');
  if (!li) return;
  currentBucket = li.dataset.bucket;
  document.querySelectorAll('#bucketList li').forEach((x) => x.classList.toggle('active', x === li));
  loadObjects('');
});

async function loadObjects(prefix) {
  currentPrefix = prefix;
  $('#uploadBtn').hidden = false;
  const parts = prefix.split('/').filter(Boolean);
  const crumbs = [`<a data-prefix="">${esc(currentBucket)}</a>`];
  parts.forEach((p, idx) => {
    crumbs.push(`<span class="sep">/</span><a data-prefix="${esc(parts.slice(0, idx + 1).join('/') + '/')}">${esc(p)}</a>`);
  });
  $('#objPath').innerHTML = crumbs.join('');

  const body = $('#objBody');
  body.innerHTML = '<tr><td colspan="4" class="muted">불러오는 중…</td></tr>';
  try {
    const data = await api(`/api/s3/${encodeURIComponent(currentBucket)}?prefix=${encodeURIComponent(prefix)}`);
    currentFiles = data.files.map((f) => f.key);
    const rows = [
      ...data.folders.map((f) => `
        <tr class="folder-row" data-prefix="${esc(f)}">
          <td><span class="file-name">${ICON.folder}${esc(f.slice(prefix.length))}</span></td>
          <td class="right muted">—</td><td class="right muted">—</td><td></td>
        </tr>`),
      ...data.files.map((f) => `
        <tr>
          <td><span class="file-name">${ICON.file}${esc(f.key.slice(prefix.length))}</span></td>
          <td class="right mono">${formatSize(f.size)}</td>
          <td class="right muted">${esc(new Date(f.modified).toLocaleString('ko-KR'))}</td>
          <td class="right"><button class="dl-btn" data-download="${esc(f.key)}" title="다운로드">${ICON.download}</button></td>
        </tr>`),
    ];
    body.innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">비어 있어요</td></tr>';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="4" class="muted">${esc(e.message)}</td></tr>`;
  }
}

$('#tab-s3').addEventListener('click', (e) => {
  const dl = e.target.closest('[data-download]');
  if (dl) {
    const a = document.createElement('a');
    a.href = `/api/s3/${encodeURIComponent(currentBucket)}/download?key=${encodeURIComponent(dl.dataset.download)}`;
    a.click();
    return;
  }
  const el = e.target.closest('[data-prefix]');
  if (el && currentBucket) loadObjects(el.dataset.prefix);
});

$('#uploadInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !currentBucket) return;

  const overwrite = files.filter((f) => currentFiles.includes(currentPrefix + f.name));
  const ok = await confirmModal({
    title: `${files.length}개 파일을 업로드할까요?`,
    text: `위치: s3://${currentBucket}/${currentPrefix}\n${files.map((f) => `· ${f.name} (${formatSize(f.size)})`).join('\n')}`
      + (overwrite.length ? `\n\n⚠️ 같은 이름의 파일 ${overwrite.length}개는 덮어써져요.` : ''),
    okLabel: '업로드',
    danger: overwrite.length > 0,
  });
  if (!ok) return;

  const progress = $('#uploadProgress');
  progress.classList.remove('hidden');
  let done = 0;
  for (const f of files) {
    progress.textContent = `업로드 중 (${done + 1}/${files.length}) · ${f.name}`;
    try {
      await api(`/api/s3/${encodeURIComponent(currentBucket)}/upload?key=${encodeURIComponent(currentPrefix + f.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f,
      });
      done++;
    } catch (err) {
      toast(`${f.name}: ${err.message}`, true);
    }
  }
  progress.classList.add('hidden');
  if (done) toast(`${done}개 파일을 업로드했어요`);
  loadObjects(currentPrefix);
});

// ---------- 스케줄 ----------
let selectedDays = new Set([0, 1, 2, 3, 4]);

function renderDayPicker() {
  $('#schDays').innerHTML = DAYS.map((d, i) =>
    `<button type="button" class="day ${selectedDays.has(i) ? 'on' : ''} ${i >= 5 ? 'weekend' : ''}" data-day="${i}">${d}</button>`).join('');
}

$('#schDays').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (!b) return;
  const d = Number(b.dataset.day);
  selectedDays.has(d) ? selectedDays.delete(d) : selectedDays.add(d);
  renderDayPicker();
});

document.querySelector('.presets').addEventListener('click', (e) => {
  const p = e.target.dataset.preset;
  if (!p) return;
  selectedDays = new Set({ weekday: [0, 1, 2, 3, 4], weekend: [5, 6], all: [0, 1, 2, 3, 4, 5, 6] }[p]);
  renderDayPicker();
});

async function loadSchedules() {
  renderDayPicker();
  try {
    const [list, schedules] = await Promise.all([api('/api/ec2'), api('/api/schedules')]);
    instances = list;
    const sel = $('#schInstance');
    const prev = sel.value;
    sel.innerHTML = list.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}${i.isSelf ? ' (현재 서버)' : ''}</option>`).join('');
    if (prev) sel.value = prev;

    $('#scheduleBody').innerHTML = schedules.length ? schedules
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((s) => `
        <tr>
          <td><b>${esc(s.instanceName)}</b><div class="mono muted">${esc(s.instanceId)}</div></td>
          <td><span class="pill ${ACTION_PILL[s.action]}">${ACTION_LABEL[s.action]}</span></td>
          <td class="time-big">${esc(s.time)}</td>
          <td><div class="day-list">${DAYS.map((d, i) => `<i class="${s.days.includes(i) ? 'on' : ''}">${d}</i>`).join('')}</div></td>
          <td><label class="switch"><input type="checkbox" data-toggle="${esc(s.id)}" ${s.enabled ? 'checked' : ''}><span></span></label></td>
          <td class="right"><button class="btn btn-ghost btn-sm" data-delete="${esc(s.id)}">삭제</button></td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="muted">아직 등록된 스케줄이 없어요. 위에서 추가해 보세요.</td></tr>';
    markUpdated();
  } catch (e) {
    $('#scheduleBody').innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`;
  }
}

$('#scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await postJson('/api/schedules', {
      instanceId: $('#schInstance').value,
      action: $('#schAction').value,
      time: $('#schTime').value,
      days: [...selectedDays],
    });
    toast('스케줄을 추가했어요');
    loadSchedules();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#scheduleBody').addEventListener('change', async (e) => {
  const id = e.target.dataset.toggle;
  if (!id) return;
  try {
    await postJson(`/api/schedules/${id}/toggle`, { enabled: e.target.checked });
    toast(e.target.checked ? '스케줄을 켰어요' : '스케줄을 껐어요');
  } catch (err) {
    toast(err.message, true);
    e.target.checked = !e.target.checked;
  }
});

$('#scheduleBody').addEventListener('click', async (e) => {
  const id = e.target.dataset.delete;
  if (!id) return;
  const ok = await confirmModal({ title: '스케줄을 삭제할까요?', text: '삭제하면 더 이상 자동으로 실행되지 않아요.', okLabel: '삭제', danger: true });
  if (!ok) return;
  try {
    await api(`/api/schedules/${id}`, { method: 'DELETE' });
    toast('스케줄을 삭제했어요');
    loadSchedules();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- 작업 기록 ----------
const TRAIL_LABEL = {
  StartInstances: ['시작', 'green'], StopInstances: ['중지', 'red'], RebootInstances: ['재부팅', 'slate'],
  RunInstances: ['생성', 'accent'], TerminateInstances: ['종료(삭제)', 'red'],
};

async function loadLogs() {
  const logBody = $('#logBody');
  const trailBody = $('#trailBody');
  logBody.innerHTML = '<tr><td colspan="5" class="muted">불러오는 중…</td></tr>';
  trailBody.innerHTML = '<tr><td colspan="5" class="muted">CloudTrail 조회 중… (몇 초 걸려요)</td></tr>';

  api('/api/logs').then((logs) => {
    logBody.innerHTML = logs.length ? logs.map((l) => `
      <tr>
        <td class="mono">${esc(fmtTime(l.time))}</td>
        <td><span class="pill ${l.source === '스케줄' ? 'accent' : 'slate'}">${esc(l.source)}</span></td>
        <td>${esc(l.instanceName || l.instanceId)}</td>
        <td><span class="pill ${ACTION_PILL[l.action] || 'slate'}">${ACTION_LABEL[l.action] || esc(l.action)}</span></td>
        <td>${l.ok ? '<span class="pill green">✓ 성공</span>' : `<span class="pill red">✕ 실패</span> <span class="muted">${esc(l.message)}</span>`}</td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="muted">아직 기록이 없어요</td></tr>';
    markUpdated();
  }).catch((e) => { logBody.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message)}</td></tr>`; });

  api('/api/cloudtrail').then((events) => {
    trailBody.innerHTML = events.length ? events.map((ev) => {
      const [label, color] = TRAIL_LABEL[ev.event] || [ev.event, 'slate'];
      const user = String(ev.user).split('/').pop();
      return `
      <tr>
        <td class="mono">${esc(fmtTime(ev.time))}</td>
        <td><span class="pill ${color}">${esc(label)}</span>${ev.error ? ` <span class="pill red">${esc(ev.error)}</span>` : ''}</td>
        <td>${esc(ev.instanceName)}</td>
        <td>${esc(user)}</td>
        <td class="mono muted">${esc(ev.sourceIp || '-')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">최근 7일간 기록이 없어요</td></tr>';
  }).catch((e) => { trailBody.innerHTML = `<tr><td colspan="5" class="muted">${esc(e.message)}</td></tr>`; });
}

// ---------- 비용 ----------
async function loadCost() {
  try {
    const c = await api('/api/cost');
    const runningCount = c.rows.filter((r) => r.state === 'running').length;
    $('#costStats').innerHTML =
      stat('시간당', `$${c.hourly}`, 'accent') +
      stat('하루', `$${c.daily}`, 'accent') +
      stat('30일 기준', `$${c.monthly}`, 'amber') +
      stat('과금 중인 인스턴스', runningCount, 'green', `/ ${c.rows.length}대`);

    const max = Math.max(...c.rows.map((r) => r.hourly || 0), 0.0001);
    $('#costBreakdown').innerHTML = c.rows.map((r) => {
      const on = r.state === 'running' && r.known;
      return `
      <div class="bar-row">
        <div class="bar-name">${esc(r.name)}<span class="mono">${esc(r.type)} · ${STATE_LABEL[r.state] || esc(r.state)}</span></div>
        <div class="bar-track"><div class="bar-fill ${on ? '' : 'off'}" style="width:${on ? (r.hourly / max) * 100 : 100}%"></div></div>
        <div class="bar-value">${!r.known ? '<span class="muted">단가 없음</span>' : on ? `$${r.hourly}/h` : '<span class="muted">$0</span>'}</div>
      </div>`;
    }).join('') || '<div class="empty-state">인스턴스가 없어요</div>';

    $('#costNote').textContent = `⚠️ ${c.note} 이 계정은 Cost Explorer 조회 권한이 없어서 실제 청구 금액과 다를 수 있어요. 자동 스케줄로 안 쓰는 시간에 꺼두면 비용을 줄일 수 있어요.`;
    markUpdated();
  } catch (e) {
    $('#costStats').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

// ---------- 시작 ----------
api('/api/info').then((info) => {
  $('#envProfile').textContent = info.profile;
  $('#envRegion').textContent = info.region;
  $('#envKeyword').textContent = info.keyword;
}).catch(() => {});

loadTab();
