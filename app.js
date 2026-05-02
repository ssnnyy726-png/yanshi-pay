import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (id) => document.getElementById(id);
const root = $('app');

// ======= 状態 =======
const state = {
  user: null,
  profile: null,
  members: [],
  transactions: [],
  view: 'home',
  scanner: null,
};

// ======= ユーティリティ =======
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `今日 ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function showAlert(message, type = 'info') {
  const div = document.createElement('div');
  div.className = `alert alert-${type}`;
  div.textContent = message;
  root.prepend(div);
  setTimeout(() => div.remove(), 4000);
}

async function stopScanner() {
  if (state.scanner) {
    try { await state.scanner.stop(); } catch {}
    try { state.scanner.clear(); } catch {}
    state.scanner = null;
  }
}

// ======= データ読込 =======
async function loadAll() {
  const { data: { user } } = await sb.auth.getUser();
  state.user = user;
  if (!user) return;

  const [profileRes, membersRes, txRes] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).single(),
    sb.from('profiles').select('id, display_name, balance, is_admin').order('created_at'),
    sb.from('transactions').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  state.profile = profileRes.data;
  state.members = membersRes.data || [];
  state.transactions = txRes.data || [];
}

// ======= ビュー: 認証 =======
function renderAuth() {
  root.innerHTML = `
    <div class="brand">
      <div class="brand-logo">ヤンシーペイ</div>
      <div class="brand-sub">家庭内ポイント送金</div>
    </div>
    <div class="card">
      <h2>ログイン / 新規登録</h2>
      <label class="label">メールアドレス</label>
      <input class="input" id="auth-email" type="email" placeholder="you@example.com" autocomplete="email" />
      <label class="label">パスワード（6文字以上）</label>
      <input class="input" id="auth-password" type="password" placeholder="••••••••" autocomplete="current-password" />
      <label class="label">表示名（新規登録時のみ）</label>
      <input class="input" id="auth-name" type="text" placeholder="例: パパ" maxlength="20" />
      <div class="btn-row">
        <button class="btn" id="btn-login">ログイン</button>
        <button class="btn btn-secondary" id="btn-signup">新規登録</button>
      </div>
      <p class="muted center">最初に登録したユーザーが管理者になります</p>
    </div>
  `;

  $('btn-login').onclick = async () => {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    if (!email || !password) return showAlert('メールとパスワードを入力', 'error');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return showAlert(error.message, 'error');
    await refresh();
  };

  $('btn-signup').onclick = async () => {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const name = $('auth-name').value.trim();
    if (!email || !password || !name) return showAlert('全項目を入力', 'error');
    const { error } = await sb.auth.signUp({
      email, password,
      options: { data: { display_name: name } }
    });
    if (error) return showAlert(error.message, 'error');
    showAlert('登録完了。確認メールが届く場合があります', 'success');
    await refresh();
  };
}

// ======= ビュー: ホーム =======
function renderHome() {
  const p = state.profile;
  const txs = state.transactions.slice(0, 10);
  root.innerHTML = `
    <div class="brand">
      <div class="brand-logo">ヤンシーペイ</div>
      <div class="brand-sub">こんにちは、${escapeHtml(p.display_name)}さん${p.is_admin ? ' 👑' : ''}</div>
    </div>

    <div class="card balance-card">
      <div class="balance-label">残高</div>
      <div><span class="balance-amount">${p.balance.toLocaleString()}</span><span class="balance-unit">pt</span></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-big" id="btn-receive">
        <span class="icon">📥</span><span>受け取る</span>
      </button>
      <button class="btn btn-big" id="btn-pay">
        <span class="icon">📷</span><span>支払う</span>
      </button>
    </div>

    <div class="card">
      <div class="row">
        <h2 style="margin:0">取引履歴</h2>
        <div class="spacer"></div>
        <button class="btn btn-ghost" id="btn-all-tx" style="width:auto;padding:6px 10px;">すべて</button>
      </div>
      <div class="tx-list mt">
        ${txs.length === 0 ? '<p class="muted center">取引履歴はまだありません</p>' :
          txs.map(t => renderTxItem(t)).join('')}
      </div>
    </div>
  `;
  $('btn-receive').onclick = () => switchView('receive');
  $('btn-pay').onclick = () => switchView('pay');
  $('btn-all-tx').onclick = () => switchView('history');
}

function renderTxItem(t) {
  const isIn = t.to_user_id === state.user.id;
  const otherId = isIn ? t.from_user_id : t.to_user_id;
  const other = state.members.find(m => m.id === otherId);
  const name = other ? other.display_name : '不明';
  const sign = isIn ? '+' : '−';
  return `
    <div class="tx-item">
      <div class="tx-info">
        <div class="tx-name">${escapeHtml(name)}</div>
        <div class="tx-meta">${formatTime(t.created_at)}${t.memo ? ' ・ ' + escapeHtml(t.memo) : ''}</div>
      </div>
      <div class="tx-amount ${isIn ? 'in' : 'out'}">${sign}${t.amount.toLocaleString()}pt</div>
    </div>
  `;
}

// ======= ビュー: 受け取り（QR生成）=======
function renderReceive() {
  root.innerHTML = `
    <div class="brand"><div class="brand-logo">受け取る</div></div>
    <div class="card">
      <label class="label">金額（pt）</label>
      <input class="input" id="r-amount" type="number" inputmode="numeric" min="1" placeholder="100" />
      <label class="label">メモ（任意）</label>
      <input class="input" id="r-memo" type="text" maxlength="50" placeholder="お駄賃 / お小遣いなど" />
      <label class="label">有効時間</label>
      <select class="select" id="r-expiry">
        <option value="5">5分</option>
        <option value="15" selected>15分</option>
        <option value="60">1時間</option>
        <option value="1440">24時間</option>
      </select>
      <button class="btn" id="btn-gen">QRコードを生成</button>
    </div>
    <div id="qr-area"></div>
  `;
  $('btn-gen').onclick = generateQR;
}

async function generateQR() {
  const amount = parseInt($('r-amount').value, 10);
  const memo = $('r-memo').value.trim() || null;
  const expiryMin = parseInt($('r-expiry').value, 10);
  if (!amount || amount <= 0) return showAlert('金額を入力', 'error');

  const expiresAt = new Date(Date.now() + expiryMin * 60 * 1000).toISOString();
  const { data, error } = await sb.from('qr_tokens').insert({
    to_user_id: state.user.id, amount, memo, expires_at: expiresAt,
  }).select().single();

  if (error) return showAlert(error.message, 'error');

  const payload = JSON.stringify({ v: 1, t: data.id });
  const area = $('qr-area');
  area.innerHTML = `
    <div class="card qr-display">
      <canvas id="qr-canvas"></canvas>
      <div class="qr-info">
        <div class="amt">${amount.toLocaleString()} pt</div>
        ${memo ? `<div class="memo">${escapeHtml(memo)}</div>` : ''}
        <div class="memo">${expiryMin}分以内に読み取り</div>
      </div>
    </div>
    <p class="muted center">家族にこのQRをスキャンしてもらってください</p>
  `;
  await window.QRCode.toCanvas($('qr-canvas'), payload, { width: 280, margin: 1 });
}

// ======= ビュー: 支払い（QR読み取り）=======
function renderPay() {
  root.innerHTML = `
    <div class="brand"><div class="brand-logo">支払う</div></div>
    <div class="card">
      <p class="muted center">受け取り側のQRコードをカメラに向けてください</p>
      <div id="scanner-container" class="mt"></div>
      <p class="muted center mt">※ 初回はカメラ許可を求められます</p>
    </div>
  `;
  startScanner();
}

async function startScanner() {
  await stopScanner();
  const id = 'scanner-container';
  state.scanner = new window.Html5Qrcode(id);
  try {
    await state.scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      onQrScanned,
      () => {}
    );
  } catch (e) {
    showAlert('カメラを起動できません: ' + e.message, 'error');
  }
}

let scanInProgress = false;
async function onQrScanned(text) {
  if (scanInProgress) return;
  scanInProgress = true;
  try {
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('QRが認識できません'); }
    if (!payload || payload.v !== 1 || !payload.t) throw new Error('ヤンシーペイのQRではありません');

    const { data: token, error } = await sb.from('qr_tokens').select('*').eq('id', payload.t).single();
    if (error || !token) throw new Error('QRが無効です');
    if (token.used) throw new Error('このQRは使用済みです');
    if (new Date(token.expires_at) < new Date()) throw new Error('QRの有効期限切れ');

    const receiver = state.members.find(m => m.id === token.to_user_id);
    await stopScanner();
    showConfirm(token, receiver);
  } catch (e) {
    showAlert(e.message, 'error');
    setTimeout(() => { scanInProgress = false; }, 1500);
  }
}

function showConfirm(token, receiver) {
  const ok = state.profile.balance >= token.amount;
  const html = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <h2 class="center">支払い確認</h2>
        <p class="center muted mt">送り先</p>
        <p class="center" style="font-size:20px;font-weight:600">${escapeHtml(receiver?.display_name || '不明')}</p>
        <p class="center muted mt">金額</p>
        <p class="center" style="font-size:36px;font-weight:800;color:var(--accent)">${token.amount.toLocaleString()} pt</p>
        ${token.memo ? `<p class="center muted">${escapeHtml(token.memo)}</p>` : ''}
        ${!ok ? '<div class="alert alert-error mt">残高が不足しています</div>' : ''}
        <div class="btn-row mt">
          <button class="btn btn-secondary" id="m-cancel">キャンセル</button>
          <button class="btn" id="m-ok" ${ok ? '' : 'disabled'}>支払う</button>
        </div>
      </div>
    </div>
  `;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  document.body.appendChild(tmp.firstElementChild);

  $('m-cancel').onclick = () => {
    document.getElementById('modal-backdrop').remove();
    scanInProgress = false;
    startScanner();
  };
  $('m-ok').onclick = async () => {
    $('m-ok').innerHTML = '<span class="spinner"></span>';
    $('m-ok').disabled = true;
    const { error } = await sb.rpc('transfer_via_qr', { token_id: token.id });
    document.getElementById('modal-backdrop').remove();
    if (error) {
      showAlert(error.message, 'error');
      scanInProgress = false;
      startScanner();
    } else {
      showAlert(`${token.amount}ptを支払いました`, 'success');
      await refresh('home');
    }
  };
}

// ======= ビュー: 取引履歴 =======
function renderHistory() {
  root.innerHTML = `
    <div class="brand"><div class="brand-logo">取引履歴</div></div>
    <div class="card">
      <div class="tx-list">
        ${state.transactions.length === 0 ? '<p class="muted center">取引履歴はまだありません</p>' :
          state.transactions.map(t => renderTxItem(t)).join('')}
      </div>
    </div>
  `;
}

// ======= ビュー: 家族 / 設定 =======
function renderSettings() {
  const isAdmin = state.profile.is_admin;
  root.innerHTML = `
    <div class="brand"><div class="brand-logo">設定</div></div>

    <div class="card">
      <h2>家族メンバー</h2>
      <div class="member-list mt">
        ${state.members.map(m => `
          <div class="member-item">
            <div>
              <div class="member-name">${escapeHtml(m.display_name)}${m.is_admin ? ' 👑' : ''}${m.id === state.user.id ? '（あなた）' : ''}</div>
            </div>
            <div class="member-balance">${m.balance.toLocaleString()}pt</div>
          </div>
        `).join('')}
      </div>
    </div>

    ${isAdmin ? `
    <div class="card">
      <h2>👑 ポイントをチャージ</h2>
      <label class="label">対象メンバー</label>
      <select class="select" id="c-target">
        ${state.members.map(m => `<option value="${m.id}">${escapeHtml(m.display_name)}</option>`).join('')}
      </select>
      <label class="label">金額（pt）</label>
      <input class="input" id="c-amount" type="number" inputmode="numeric" min="1" placeholder="1000" />
      <button class="btn" id="btn-charge">チャージ実行</button>
    </div>
    ` : ''}

    <div class="card">
      <h2>表示名を変更</h2>
      <input class="input" id="d-name" type="text" maxlength="20" value="${escapeHtml(state.profile.display_name)}" />
      <button class="btn btn-secondary" id="btn-rename">変更</button>
    </div>

    <div class="card">
      <button class="btn btn-danger" id="btn-logout">ログアウト</button>
    </div>
  `;

  if (isAdmin) {
    $('btn-charge').onclick = async () => {
      const target = $('c-target').value;
      const amount = parseInt($('c-amount').value, 10);
      if (!amount || amount <= 0) return showAlert('金額を入力', 'error');
      const { error } = await sb.rpc('admin_charge', { target_user_id: target, amount });
      if (error) return showAlert(error.message, 'error');
      showAlert(`${amount}ptをチャージしました`, 'success');
      await refresh();
    };
  }

  $('btn-rename').onclick = async () => {
    const name = $('d-name').value.trim();
    if (!name) return;
    const { error } = await sb.rpc('update_display_name', { new_name: name });
    if (error) return showAlert(error.message, 'error');
    showAlert('表示名を変更しました', 'success');
    await refresh();
  };

  $('btn-logout').onclick = async () => {
    await sb.auth.signOut();
    location.reload();
  };
}

// ======= タブバー =======
function renderTabBar() {
  const existing = document.querySelector('.tab-bar');
  if (existing) existing.remove();
  const bar = document.createElement('div');
  bar.className = 'tab-bar';
  const tabs = [
    { id: 'home', icon: '🏠', label: 'ホーム' },
    { id: 'receive', icon: '📥', label: '受け取る' },
    { id: 'pay', icon: '📷', label: '支払う' },
    { id: 'settings', icon: '⚙️', label: '設定' },
  ];
  bar.innerHTML = tabs.map(t => `
    <button class="tab ${state.view === t.id ? 'active' : ''}" data-view="${t.id}">
      <span class="icon">${t.icon}</span>
      <span>${t.label}</span>
    </button>
  `).join('');
  bar.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });
  document.body.appendChild(bar);
}

// ======= ルーティング =======
async function switchView(view) {
  await stopScanner();
  scanInProgress = false;
  state.view = view;
  await render();
}

async function render() {
  if (!state.user) {
    document.querySelector('.tab-bar')?.remove();
    return renderAuth();
  }
  switch (state.view) {
    case 'home': renderHome(); break;
    case 'receive': renderReceive(); break;
    case 'pay': renderPay(); break;
    case 'history': renderHistory(); break;
    case 'settings': renderSettings(); break;
    default: renderHome();
  }
  renderTabBar();
}

async function refresh(view) {
  if (view) state.view = view;
  await loadAll();
  await render();
}

// ======= 起動 =======
sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    state.user = null; state.profile = null;
    render();
  }
});

(async () => {
  await loadAll();
  await render();
})();
