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

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}

// ---------- 탭 ----------
let currentTab = 'ec2';
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${currentTab}`));
    loadTab();
  });
});
$('#refreshBtn').addEventListener('click', () => loadTab());

function loadTab() {
  if (currentTab === 'ec2') loadEc2();
  if (currentTab === 's3') loadBuckets();
  if (currentTab === 'cost') loadCost();
}

// ---------- EC2 ----------
let pollTimer;
async function loadEc2() {
  const body = $('#ec2Body');
  try {
    const list = await api('/api/ec2');
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">내 인스턴스가 없어요</td></tr>';
      return;
    }
    body.innerHTML = list.map((i) => {
      const lockStop = i.isSelf ? 'disabled title="이 페이지가 실행 중인 서버예요"' : '';
      return `
      <tr>
        <td>${esc(i.name)}${i.isSelf ? '<span class="self-tag">● 현재 서버</span>' : ''}
          <div class="mono muted">${esc(i.id)}</div></td>
        <td><span class="badge ${esc(i.state)}">${esc(i.state)}</span></td>
        <td class="mono">${esc(i.type)}</td>
        <td class="mono">${esc(i.privateIp || '-')}</td>
        <td class="mono">${esc(i.publicIp || '-')}</td>
        <td>
          <button class="btn start" data-id="${esc(i.id)}" data-action="start" ${i.state !== 'stopped' ? 'disabled' : ''}>시작</button>
          <button class="btn stop" data-id="${esc(i.id)}" data-action="stop" ${i.state !== 'running' ? 'disabled' : lockStop}>중지</button>
          <button class="btn" data-id="${esc(i.id)}" data-action="reboot" ${i.state !== 'running' ? 'disabled' : lockStop}>재부팅</button>
        </td>
      </tr>`;
    }).join('');

    // 상태가 바뀌는 중이면 5초마다 자동 갱신
    clearTimeout(pollTimer);
    if (list.some((i) => ['pending', 'stopping'].includes(i.state)) && currentTab === 'ec2') {
      pollTimer = setTimeout(loadEc2, 5000);
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${esc(e.message)}</td></tr>`;
  }
}

const ACTION_LABEL = { start: '시작', stop: '중지', reboot: '재부팅' };
$('#ec2Body').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { id, action } = btn.dataset;
  const name = btn.closest('tr').querySelector('td').firstChild.textContent.trim();
  if (action !== 'start' && !confirm(`${name} (${id}) 인스턴스를 ${ACTION_LABEL[action]}할까요?`)) return;

  btn.disabled = true;
  try {
    await api(`/api/ec2/${id}/${action}`, { method: 'POST' });
    toast(`${name} ${ACTION_LABEL[action]} 요청을 보냈어요`);
    setTimeout(loadEc2, 1500);
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

// ---------- S3 ----------
let currentBucket = null;
async function loadBuckets() {
  const ul = $('#bucketList');
  try {
    const buckets = await api('/api/s3');
    if (!buckets.length) { ul.innerHTML = '<li class="muted">내 버킷이 없어요</li>'; return; }
    ul.innerHTML = buckets.map((b) =>
      `<li data-bucket="${esc(b.name)}" class="${b.name === currentBucket ? 'active' : ''}">${esc(b.name)}</li>`).join('');
  } catch (e) {
    ul.innerHTML = `<li class="muted">${esc(e.message)}</li>`;
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
  const body = $('#objBody');
  const parts = prefix.split('/').filter(Boolean);
  const crumbs = [`<a data-prefix="">${esc(currentBucket)}</a>`];
  parts.forEach((p, idx) => {
    crumbs.push(`<a data-prefix="${esc(parts.slice(0, idx + 1).join('/') + '/')}">${esc(p)}</a>`);
  });
  $('#objPath').innerHTML = crumbs.join(' / ');
  body.innerHTML = '<tr><td colspan="3" class="muted">불러오는 중…</td></tr>';

  try {
    const data = await api(`/api/s3/${encodeURIComponent(currentBucket)}?prefix=${encodeURIComponent(prefix)}`);
    const rows = [
      ...data.folders.map((f) => `<tr><td class="folder" data-prefix="${esc(f)}">📁 ${esc(f.slice(prefix.length))}</td><td>-</td><td>-</td></tr>`),
      ...data.files.map((f) => `<tr><td>${esc(f.key.slice(prefix.length))}</td><td>${formatSize(f.size)}</td><td class="muted">${esc(new Date(f.modified).toLocaleString('ko-KR'))}</td></tr>`),
    ];
    body.innerHTML = rows.join('') || '<tr><td colspan="3" class="muted">비어 있어요</td></tr>';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="3" class="muted">${esc(e.message)}</td></tr>`;
  }
}

document.querySelector('.objects').addEventListener('click', (e) => {
  const el = e.target.closest('[data-prefix]');
  if (el) loadObjects(el.dataset.prefix);
});

// ---------- 비용 ----------
async function loadCost() {
  try {
    const c = await api('/api/cost');
    $('#costCards').innerHTML = [
      ['시간당', c.hourly], ['하루', c.daily], ['30일 기준', c.monthly],
    ].map(([label, v]) => `<div class="card"><div class="label">${label}</div><div class="value">$${v}</div></div>`).join('');
    $('#costBody').innerHTML = c.rows.map((r) => `
      <tr><td>${esc(r.name)}</td><td class="mono">${esc(r.type)}</td>
      <td><span class="badge ${esc(r.state)}">${esc(r.state)}</span></td>
      <td>${r.known ? '$' + r.hourly : '<span class="muted">단가 정보 없음</span>'}</td></tr>`).join('');
    $('#costNote').textContent = c.note;
  } catch (e) {
    $('#costCards').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

loadTab();
