const express = require('express');
const fs = require('fs');
const path = require('path');
const sheets = require('./lib/google-sheets');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const INDEX_EN_HTML = path.join(PUBLIC_DIR, 'index-en.html');
const ADMIN_HTML = path.join(PUBLIC_DIR, 'admin.html');
const DATA_DIR = path.join(__dirname, 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function sendPublicHtml(res, filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`[Static] Missing ${label}: ${filePath}`);
    return res.status(404).type('text/plain').send(`Not Found: ${label} is missing on the server`);
  }
  return res.sendFile(filePath);
}

function logPublicDirStatus() {
  console.log('[Static] PUBLIC_DIR =', PUBLIC_DIR);
  for (const [name, filePath] of [
    ['index.html (B)', INDEX_HTML],
    ['index-en.html (A)', INDEX_EN_HTML],
    ['admin.html', ADMIN_HTML],
  ]) {
    const ok = fs.existsSync(filePath);
    const size = ok ? fs.statSync(filePath).size : 0;
    console.log(`[Static] ${name}: ${ok ? 'OK' : 'MISSING'}${ok ? ` (${size} bytes)` : ''}`);
  }
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function nowLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace('T', ' ');
}

const VALID_EVENTS = new Set([
  'page_view',
  'submit_inputs',
  'view_results',
  'click_rate_tab',
  'click_seed_money',
  'click_share',
  'submit_contact',
  'click_start',
  'view_s1',
  'view_s2',
  'view_loading',
  'view_s3',
  'view_s4',
  'view_s5',
  'view_s6',
  'view_s8',
  'view_sContact',
  'view_sComplete',
  'check_s5_ack',
  'click_s5_confirm',
  'click_contact_cta',
  'click_recommend_open',
  'click_recommend_mode',
  'click_recommend_apply',
  'click_recommend_close',
  'click_back',
  'click_period',
  'click_route_compare',
  'click_route_cycle',
  'click_calc_accordion',
  'click_edit_wage',
  'click_goal_preview',
  'click_restart',
  'hover_route_chart',
  'click_route_chart',
  'input_route_target_days',
  'change_route_target_days',
  's3_stay_duration',
  'input_amount_changed',
  'preregistration_complete',
]);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    public_dir: PUBLIC_DIR,
    files: {
      index: fs.existsSync(INDEX_HTML),
      index_en: fs.existsSync(INDEX_EN_HTML),
      admin: fs.existsSync(ADMIN_HTML),
    },
  });
});

app.get('/', (_req, res) => sendPublicHtml(res, INDEX_HTML, 'index.html (B variant)'));
app.get('/index-en.html', (_req, res) => sendPublicHtml(res, INDEX_EN_HTML, 'index-en.html (A variant)'));

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    extensions: ['html'],
    fallthrough: true,
  })
);

app.post('/api/events', (req, res) => {
  const { event_type, session_id, visitor_id, payload, source } = req.body || {};

  if (!event_type || !VALID_EVENTS.has(event_type)) {
    return res.status(400).json({ error: 'invalid event_type' });
  }
  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }

  const events = readJson(EVENTS_FILE);
  const record = {
    id: events.length + 1,
    event_type,
    session_id,
    visitor_id: visitor_id || null,
    source: source || payload?.source || null,
    payload: payload || null,
    created_at: nowLocal(),
  };
  events.push(record);
  writeJson(EVENTS_FILE, events);
  sheets.syncEvent(record);

  res.json({ ok: true });
});

app.post('/api/contacts', (req, res) => {
  const { session_id, visitor_id, email, phone, wish_item, goal_amount, source } =
    req.body || {};

  if (!session_id) {
    return res.status(400).json({ error: 'session_id required' });
  }
  if (!email && !phone) {
    return res.status(400).json({ error: 'email or phone required' });
  }

  const contacts = readJson(CONTACTS_FILE);
  const record = {
    id: contacts.length + 1,
    session_id,
    visitor_id: visitor_id || null,
    source: source || null,
    email: email || null,
    phone: phone || null,
    wish_item: wish_item || null,
    goal_amount: goal_amount || null,
    created_at: nowLocal(),
  };
  contacts.push(record);
  writeJson(CONTACTS_FILE, contacts);
  sheets.syncContact(record);

  res.json({ ok: true });
});

app.get('/api/stats/funnel', (_req, res) => {
  const events = readJson(EVENTS_FILE);

  const counts = {};
  for (const type of VALID_EVENTS) {
    counts[type] = events.filter((e) => e.event_type === type).length;
  }

  const uniqueSessions = new Set(events.map((e) => e.session_id)).size;
  const uniqueVisitors = new Set(events.map((e) => e.visitor_id).filter(Boolean)).size;

  const coreFunnelSteps = [
    { step: 1, label: '웹사이트 총 유입', event: 'page_view', count: counts.page_view },
    { step: 2, label: '비교하기 클릭', event: 'submit_inputs', count: counts.submit_inputs },
    { step: 3, label: '결과 페이지 완료 (2.5초)', event: 'view_results', count: counts.view_results },
  ];

  const coreFunnel = coreFunnelSteps.map((step, i) => {
    const prev = i === 0 ? step.count : coreFunnelSteps[i - 1].count;
    const conversion = prev > 0 ? ((step.count / prev) * 100).toFixed(1) : '0.0';
    const fromTop = counts.page_view > 0 ? ((step.count / counts.page_view) * 100).toFixed(1) : '0.0';
    const dropOff = i === 0 ? 0 : Math.max(0, prev - step.count);
    return {
      ...step,
      conversion_from_prev: conversion + '%',
      conversion_from_top: fromTop + '%',
      drop_off: dropOff,
    };
  });

  const coreSix = [
    { event: 'page_view', label: '웹사이트 최초 접속 (유입)', count: counts.page_view },
    { event: 'submit_inputs', label: '위시템/금액 입력 후 비교하기', count: counts.submit_inputs },
    { event: 'click_rate_tab', label: '수익률 탭 클릭 (UI 제거·과거 데이터만)', count: counts.click_rate_tab },
    { event: 'click_seed_money', label: '레이스 지원금 받기 CTA', count: counts.click_seed_money },
    { event: 'click_share', label: '공유하기 (바이럴 지수)', count: counts.click_share },
    { event: 'submit_contact', label: '이메일/연락처 저장 (CPA)', count: counts.submit_contact },
  ];

  const funnelSteps = [
    { step: 1, label: '웹사이트 유입', event: 'page_view', count: counts.page_view },
    { step: 2, label: 's1 시작 화면', event: 'view_s1', count: counts.view_s1 },
    { step: 3, label: '입력 후 비교하기', event: 'submit_inputs', count: counts.submit_inputs },
    { step: 4, label: '결과(s3) 진입', event: 'view_s3', count: counts.view_s3 },
    { step: 5, label: '결과 2.5초 체류', event: 'view_results', count: counts.view_results },
    { step: 6, label: '레이스 지원금 CTA', event: 'click_seed_money', count: counts.click_seed_money },
    { step: 7, label: '안전 확인(s5)', event: 'view_s5', count: counts.view_s5 },
    { step: 8, label: 's5 확인 완료', event: 'click_s5_confirm', count: counts.click_s5_confirm },
    { step: 9, label: '연락처 CTA', event: 'click_contact_cta', count: counts.click_contact_cta },
    { step: 10, label: '연락처 제출', event: 'submit_contact', count: counts.submit_contact },
    { step: 11, label: '완료(sComplete)', event: 'view_sComplete', count: counts.view_sComplete },
  ];

  const rates = funnelSteps.map((step, i) => {
    const prev = i === 0 ? step.count : funnelSteps[i - 1].count;
    const conversion = prev > 0 ? ((step.count / prev) * 100).toFixed(1) : '0.0';
    const fromTop = counts.page_view > 0 ? ((step.count / counts.page_view) * 100).toFixed(1) : '0.0';
    return { ...step, conversion_from_prev: conversion + '%', conversion_from_top: fromTop + '%' };
  });

  const tabMap = {};
  for (const e of events) {
    if (e.event_type === 'click_rate_tab') {
      const key = e.payload?.label || e.payload?.tab || 'unknown';
      tabMap[key] = (tabMap[key] || 0) + 1;
    }
  }
  const rateTabs = Object.entries(tabMap)
    .map(([tab, cnt]) => ({ tab, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const shareMap = {};
  for (const e of events) {
    if (e.event_type === 'click_share' && e.payload?.source) {
      const src = e.payload.source;
      shareMap[src] = (shareMap[src] || 0) + 1;
    }
  }
  const shareBreakdown = Object.entries(shareMap)
    .map(([source, cnt]) => ({ source, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const channelMap = {};
  for (const e of events) {
    if (e.event_type === 'page_view' && e.source) {
      channelMap[e.source] = (channelMap[e.source] || 0) + 1;
    }
  }
  const channelBreakdown = Object.entries(channelMap)
    .map(([channel, cnt]) => ({ channel, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const contactChannelMap = {};
  for (const c of readJson(CONTACTS_FILE)) {
    if (c.source) {
      contactChannelMap[c.source] = (contactChannelMap[c.source] || 0) + 1;
    }
  }
  const contactChannelBreakdown = Object.entries(contactChannelMap)
    .map(([channel, cnt]) => ({ channel, cnt }))
    .sort((a, b) => b.cnt - a.cnt);

  const allEvents = Object.entries(counts)
    .filter(([, cnt]) => cnt > 0)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count);

  const cpa =
    counts.page_view > 0
      ? ((counts.submit_contact / counts.page_view) * 100).toFixed(2)
      : '0.00';

  res.json({
    unique_sessions: uniqueSessions,
    unique_visitors: uniqueVisitors,
    core_funnel: coreFunnel,
    core_six: coreSix,
    all_events: allEvents,
    funnel: rates,
    events: counts,
    rate_tab_breakdown: rateTabs,
    share_breakdown: shareBreakdown,
    channel_breakdown: channelBreakdown,
    contact_channel_breakdown: contactChannelBreakdown,
    metrics: {
      cpa_signup_rate: cpa + '%',
      seed_money_clicks: counts.click_seed_money,
      share_clicks: counts.click_share,
      contact_submissions: counts.submit_contact,
      s5_confirm_clicks: counts.click_s5_confirm,
      recommend_opens: counts.click_recommend_open,
      recommend_applies: counts.click_recommend_apply,
      result_completion_rate:
        counts.page_view > 0
          ? ((counts.view_results / counts.page_view) * 100).toFixed(1) + '%'
          : '0.0%',
    },
  });
});

app.get('/api/stats/recent', (_req, res) => {
  const events = readJson(EVENTS_FILE).slice(-50).reverse();
  const contacts = readJson(CONTACTS_FILE).slice(-20).reverse();
  res.json({ events, contacts });
});

app.get('/admin', (_req, res) => sendPublicHtml(res, ADMIN_HTML, 'admin.html'));

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, '0.0.0.0', () => {
  logPublicDirStatus();
  console.log(`Wishtem running at http://0.0.0.0:${PORT}`);
  console.log(`B variant:  http://0.0.0.0:${PORT}/`);
  console.log(`A variant:  http://0.0.0.0:${PORT}/index-en.html`);
  console.log(`Admin dashboard: http://0.0.0.0:${PORT}/admin`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`Tracking API: ${VALID_EVENTS.size} accepted event types`);
  sheets.logStartupStatus();
});
