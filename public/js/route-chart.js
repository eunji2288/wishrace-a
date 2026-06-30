(function (global) {
  const cycles = {
    '매일': 1,
    '주 3회': 2.33,
    '주 2회': 3.5,
    '매주': 7,
    '매월': 30,
  };
  const cycleCountPerMonth = {
    '매일': 30,
    '주 3회': 12.9,
    '주 2회': 8.6,
    '매주': 4.3,
    '매월': 1,
  };
  const WISH_DAILY_SIMPLE_INTEREST_RATE = 0.016;
  const SAVING_ANNUAL_INTEREST_RATE = 0.03;

  const state = {
    item: '위시템',
    price: 2000,
    targetDays: 365,
    years: 5,
    cycle: '매주',
    amount: 150,
    extraRoutes: [],
    selectedDay: 365,
  };

  let chartModel = null;
  let pendingRecommendation = null;
  let activeRecommendationMode = null;
  let onUpdate = null;
  let initialized = false;
  let targetDaysUserEdited = false;
  let lastTrackedTargetDays = null;
  let targetDaysInputTrackTimer = null;
  let targetDaysAtFocus = null;
  let lastChartHoverTrackAt = 0;
  let lastChartHoverTrackKey = '';
  const CHART_HOVER_TRACK_MS = 2000;
  let priceUserEdited = false;

  const fmt = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
  const $ = (id) => document.getElementById(id);

  function dailyGrowthRate(routeType) {
    if (routeType === 'wish') return WISH_DAILY_SIMPLE_INTEREST_RATE;
    if (routeType === 'saving') return Math.pow(1 + SAVING_ANNUAL_INTEREST_RATE, 1 / 365) - 1;
    return 0;
  }

  function buildSeriesDays(amount, cycle, maxDays, routeType) {
    const step = cycles[cycle];
    const dailyRate = dailyGrowthRate(routeType);
    let value = 0;
    let principal = 0;
    let interest = 0;
    let nextDepositDay = 0;
    const points = [];

    for (let day = 0; day <= Math.ceil(maxDays); day += 1) {
      while (nextDepositDay <= day) {
        principal += amount;
        if (routeType !== 'wish') value += amount;
        nextDepositDay += step;
      }
      if (routeType === 'wish') {
        if (day > 0) interest += principal * dailyRate;
        value = principal + interest;
      } else if (day > 0) {
        value *= 1 + dailyRate;
      }
      points.push({ day, value, paidTotal: principal });
    }
    return points;
  }

  function buildSeries(amount, cycle, years, routeType) {
    return buildSeriesDays(amount, cycle, years * 365, routeType);
  }

  function amountForCycle(monthlyBudget, cycle) {
    return monthlyBudget / cycleCountPerMonth[cycle];
  }

  function formatPerCycle(amount) {
    const rounded = Math.round(amount * 10) / 10;
    if (rounded >= 100) return fmt.format(Math.round(rounded));
    if (Number.isInteger(rounded)) return fmt.format(rounded);
    return rounded.toLocaleString('en-MY', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  }

  function perCycleAmountForSim(monthlyBudget, cycle) {
    return Math.max(0.01, amountForCycle(monthlyBudget, cycle));
  }

  function roundedAmountForCycle(monthlyBudget, cycle) {
    return Math.max(1, Math.round(amountForCycle(monthlyBudget, cycle)));
  }

  function firstReach(points) {
    return points.find((p) => p.value >= state.price) || null;
  }

  function chancePercent(projected) {
    const A = (projected / state.price) * 100;
    let C;
    if (A >= 100) C = Math.min(95, 90 + (A - 100) * 0.1);
    else if (A >= 85) C = 75 + ((A - 85) / 15) * 14;
    else if (A >= 70) C = 60 + ((A - 70) / 15) * 14;
    else if (A >= 50) C = 40 + ((A - 50) / 20) * 19;
    else C = 20 + (A / 50) * 19;
    return Math.round(C);
  }

  function reachWithin(amount, cycle, days) {
    return firstReach(buildSeriesDays(amount, cycle, days, 'wish'));
  }

  function estimatedReachDays(amount, cycle) {
    const hit = reachWithin(amount, cycle, 365 * 30);
    return hit ? Math.round(hit.day) : null;
  }

  function requiredAmountForTimeline(cycle, days) {
    let low = 0;
    let high = Math.max(1, state.price);
    let guard = 0;
    while (!reachWithin(high, cycle, days) && guard < 24) {
      high *= 2;
      guard += 1;
    }
    for (let i = 0; i < 34; i += 1) {
      const mid = (low + high) / 2;
      if (reachWithin(mid, cycle, days)) high = mid;
      else low = mid;
    }
    return Math.ceil(high);
  }

  function cashflowCycleForBudget(monthlyBudget) {
    if (monthlyBudget < 30) return '매일';
    if (monthlyBudget < 80) return '주 2회';
    if (monthlyBudget < 250) return '매주';
    return '매월';
  }

  function timelineFitRecommendation() {
    const days = Math.max(1, Math.round(state.targetDays));
    const cycle = '매월';
    const perCycleAmount = requiredAmountForTimeline(cycle, days);
    const monthlyBudget = perCycleAmount;
    return {
      mode: 'timeline',
      monthlyBudget,
      perCycleAmount,
      cycle,
      days,
      title: '수익성 우선',
      note: `${fmt.format(days)}일 안에 도달하려면 월초에 RM ${formatPerCycle(perCycleAmount)}를 한 번 넣는 루트가 가장 수익성 중심이에요.`,
    };
  }

  function amountFitRecommendation() {
    const cycle = cashflowCycleForBudget(state.amount);
    const perCycleAmount = perCycleAmountForSim(state.amount, cycle);
    const days = estimatedReachDays(perCycleAmount, cycle);
    return {
      mode: 'amount',
      monthlyBudget: state.amount,
      perCycleAmount,
      cycle,
      days,
      title: '현금흐름 맞춤',
      note: days
        ? `월 RM ${fmt.format(state.amount)} 안에서 ${cycle} RM ${formatPerCycle(perCycleAmount)}로 쪼개면 현금흐름 부담을 줄이면서 약 ${fmt.format(days)}일 뒤 도달해요.`
        : `월 RM ${fmt.format(state.amount)} 안에서는 30년 안에 도달하기 어려워요.`,
    };
  }

  function recommendForCard() {
    if (activeRecommendationMode === 'timeline') return timelineFitRecommendation();
    if (activeRecommendationMode === 'amount') return amountFitRecommendation();
    return amountFitRecommendation();
  }

  function updateTargetDaysLabel() {
    if ($('routeTargetDaysLabel')) {
      $('routeTargetDaysLabel').textContent = `${fmt.format(state.targetDays)}일`;
    }
    syncPrefillMutedUI();
  }

  function syncPrefillMutedUI() {
    $('routePriceInput')?.classList.toggle('route-input-muted', !priceUserEdited);
    $('routeTargetDaysInput')?.classList.toggle('route-input-muted', !targetDaysUserEdited);
  }

  function commitTargetDaysInput(fallback = 365) {
    const el = $('routeTargetDaysInput');
    if (!el) return;
    const raw = el.value.trim();
    if (raw === '') {
      state.targetDays = fallback;
    } else {
      const num = Number(raw);
      state.targetDays = Number.isFinite(num)
        ? Math.min(10950, Math.max(7, Math.round(num)))
        : fallback;
    }
    el.value = String(state.targetDays);
    updateTargetDaysLabel();
  }

  function commitPriceInput(fallback = 2000) {
    const el = $('routePriceInput');
    if (!el) return;
    const raw = el.value.trim();
    if (raw === '') {
      state.price = fallback;
    } else {
      const num = Number(raw);
      state.price = Number.isFinite(num)
        ? Math.min(999999999, Math.max(10, Math.round(num)))
        : fallback;
    }
    el.value = String(state.price);
    syncPrefillMutedUI();
  }

  function commitAmountInput(fallback = 150) {
    const el = $('routeAmountInput');
    if (!el) return;
    const raw = el.value.trim();
    if (raw === '') {
      state.amount = fallback;
    } else {
      const num = Number(raw);
      state.amount = Number.isFinite(num)
        ? Math.min(999999999, Math.max(1, Math.round(num)))
        : fallback;
    }
    el.value = String(state.amount);
  }

  function commitYearsInput(fallback = 5) {
    const el = $('routeYearsInput');
    if (!el) return;
    const raw = el.value.trim();
    if (raw === '') {
      state.years = fallback;
    } else {
      const num = Number(raw);
      state.years = Number.isFinite(num)
        ? Math.min(30, Math.max(1, Math.round(num)))
        : fallback;
    }
    el.value = String(state.years);
  }

  function selectRecommendation(mode) {
    activeRecommendationMode = mode;
    pendingRecommendation = mode === 'timeline' ? timelineFitRecommendation() : amountFitRecommendation();
    $('amountFirstBtn')?.classList.toggle('active', mode === 'amount');
    $('timelineFirstBtn')?.classList.toggle('active', mode === 'timeline');
    const detail = $('recommendDetail');
    if (detail && pendingRecommendation) {
      detail.innerHTML = `<strong>${pendingRecommendation.title}</strong><br>${pendingRecommendation.note}`;
    }
  }

  function pointAtDay(points, day) {
    const idx = Math.min(Math.max(0, Math.round(day)), points.length - 1);
    return points[idx];
  }

  function samplePathPoints(fullPoints, maxDay, includeDay) {
    const maxVerts = 220;
    const step = Math.max(7, Math.ceil(maxDay / maxVerts));
    const days = new Set([0, maxDay]);
    if (includeDay != null) days.add(Math.round(includeDay));
    for (let d = 0; d <= maxDay; d += step) days.add(d);
    return Array.from(days)
      .sort((a, b) => a - b)
      .map((day) => pointAtDay(fullPoints, day));
  }

  function pathFor(points, x, y, includeDay = null) {
    if (!points.length) return '';
    const maxDay = points[points.length - 1].day;
    const plotPoints = samplePathPoints(points, maxDay, includeDay);
    let path = '';
    plotPoints.forEach((p, i) => {
      const px = x(p.day).toFixed(2);
      const py = y(p.value).toFixed(2);
      path += `${i ? 'L' : 'M'} ${px} ${py} `;
    });
    return path.trim();
  }

  function dateFromDay(day) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(day));
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function pointAt(points, day) {
    return points.reduce(
      (best, p) => (Math.abs(p.day - day) < Math.abs(best.day - day) ? p : best),
      points[0]
    );
  }

  function hideTooltip() {
    $('routeTooltip')?.classList.remove('show');
    const marker = $('routeMarker');
    if (marker) marker.innerHTML = '';
  }

  function positionTooltip(viewX, viewY) {
    const tooltip = $('routeTooltip');
    const wrap = document.querySelector('.route-chart-wrap');
    const svg = $('routeChart');
    if (!tooltip || !wrap || !svg) return;
    const wrapRect = wrap.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const tooltipW = tooltip.offsetWidth || 176;
    const tooltipH = tooltip.offsetHeight || 72;
    const svgLeft = svgRect.left - wrapRect.left;
    const svgTop = svgRect.top - wrapRect.top;
    const gap = 14;
    let left = svgLeft + viewX + gap;
    if (left + tooltipW > wrapRect.width - 8) left = svgLeft + viewX - tooltipW - gap;
    let top = svgTop + viewY - tooltipH - gap;
    if (top < 8) top = svgTop + viewY + gap;
    left = Math.max(8, Math.min(left, wrapRect.width - tooltipW - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showTooltipFromPointer(event) {
    if (!chartModel) return;
    const svg = $('routeChart');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const viewX = ((event.clientX - rect.left) / rect.width) * 318;
    const viewY = ((event.clientY - rect.top) / rect.height) * 230;
    const { saving, wish, extra, maxDay, pad, plotH, x, y } = chartModel;
    const plotTop = pad.top;
    const plotBottom = pad.top + plotH;
    const plotLeft = pad.left;
    const plotRight = 318 - pad.right;
    if (viewX < plotLeft || viewX > plotRight || viewY < plotTop || viewY > plotBottom) {
      hideTooltip();
      return;
    }

    const day = Math.min(maxDay, Math.max(0, ((viewX - plotLeft) / (plotRight - plotLeft)) * maxDay));
    const candidates = [
      { label: '일반 저축', kind: 'saving', point: pointAt(saving, day) },
      { label: '위시부스터', kind: 'wish', point: pointAt(wish, day) },
      ...extra.map((route, index) => ({
        label: index === 0 ? '추가 레이스' : `추가 레이스 ${index + 1}`,
        kind: 'extra',
        point: pointAt(route.points, day),
      })),
    ]
      .map((candidate) => {
        const px = x(candidate.point.day);
        const py = y(candidate.point.value);
        return { ...candidate, px, py, distance: Math.hypot(px - viewX, py - viewY) };
      })
      .sort((a, b) => a.distance - b.distance);

    const nearest = candidates[0];
    if (!nearest || nearest.distance > 16) {
      hideTooltip();
      return;
    }

    const savingPoint = pointAt(saving, nearest.point.day);
    const progress = Math.min(100, (nearest.point.value / state.price) * 100);
    const amount = Math.round(nearest.point.value);
    const diff = Math.round(nearest.point.value - savingPoint.value);
    const diffLine = nearest.kind === 'saving' ? '저축 기준선' : `저축보다 RM ${fmt.format(diff)} 더 모음`;
    const marker = $('routeMarker');
    if (marker) {
      marker.innerHTML = `<line class="route-marker-line" x1="${nearest.px}" x2="${nearest.px}" y1="${plotTop}" y2="${plotBottom}"></line>`;
    }
    const tooltip = $('routeTooltip');
    if (tooltip) {
      tooltip.innerHTML = `<strong>${dateFromDay(nearest.point.day)} · ${nearest.label}</strong>도달률 ${progress.toFixed(0)}%<br>${nearest.label} RM ${fmt.format(amount)}<br>${diffLine}`;
      tooltip.classList.add('show');
    }
    positionTooltip(nearest.px, nearest.py);
    trackChartInteraction(event, nearest, nearest.point.day);
  }

  function trackChartInteraction(event, nearest, day) {
    const tracker = window.WishFastTracker;
    if (!tracker || !nearest) return;
    const progress = Math.min(100, (nearest.point.value / state.price) * 100);
    const payload = {
      day,
      line: nearest.kind,
      label: nearest.label,
      progress: Number(progress.toFixed(1)),
      amount: Math.round(nearest.point.value),
      target_days: state.targetDays,
      years: state.years,
      item: state.item,
      price: state.price,
    };
    if (event.type === 'click') {
      tracker.track('click_route_chart', payload);
      return;
    }
    const key = `${day}:${nearest.kind}`;
    const now = Date.now();
    if (key === lastChartHoverTrackKey && now - lastChartHoverTrackAt < CHART_HOVER_TRACK_MS) return;
    lastChartHoverTrackKey = key;
    lastChartHoverTrackAt = now;
    tracker.track('hover_route_chart', payload);
  }

  function closeMenus() {
    document.querySelectorAll('.route-cycle-menu.open').forEach((menu) => menu.classList.remove('open'));
  }

  function emitUpdate(snapshot) {
    if (typeof onUpdate === 'function') onUpdate(snapshot);
  }

  function getSnapshot(currentPerCycleAmount, savingHit, wishHit, saving, wish, fasterDays, chance) {
    return {
      item: state.item,
      price: state.price,
      targetDays: state.targetDays,
      years: state.years,
      cycle: state.cycle,
      monthlyBudget: state.amount,
      perCycleAmount: currentPerCycleAmount,
      savingReachDay: savingHit ? Math.round(savingHit.day) : null,
      wishReachDay: wishHit ? Math.round(wishHit.day) : null,
      fasterDays,
      chancePercent: chance,
      recommendation: recommendForCard(),
    };
  }

  function syncInputsFromDom() {
    commitPriceInput();
    commitTargetDaysInput();
    commitAmountInput();
    commitYearsInput();
  }

  function computeRouteData() {
    syncInputsFromDom();

    const currentPerCycleAmount = perCycleAmountForSim(state.amount, state.cycle);
    const saving = buildSeries(currentPerCycleAmount, state.cycle, state.years, 'saving');
    const wish = buildSeries(currentPerCycleAmount, state.cycle, state.years, 'wish');
    const extra = state.extraRoutes.map((route) => ({
      ...route,
      perCycleAmount: route.perCycleAmount || perCycleAmountForSim(route.monthlyBudget || route.amount, route.cycle),
      points: buildSeries(
        route.perCycleAmount || perCycleAmountForSim(route.monthlyBudget || route.amount, route.cycle),
        route.cycle,
        state.years,
        'wish'
      ),
    }));

    const maxDay = state.years * 365;
    const wishHit = firstReach(wish);
    const savingHit = firstReach(saving);
    const reach = wishHit || wish[wish.length - 1];
    const savingReach = savingHit || saving[saving.length - 1];
    const fasterDays = Math.max(0, Math.round((savingReach.day || maxDay) - reach.day));
    const projected = wish[wish.length - 1].value;
    const chance = chancePercent(projected);

    return {
      currentPerCycleAmount,
      saving,
      wish,
      extra,
      maxDay,
      wishHit,
      savingHit,
      fasterDays,
      chance,
      snapshot: getSnapshot(currentPerCycleAmount, savingHit, wishHit, saving, wish, fasterDays, chance),
    };
  }

  function pinMarkup(kind) {
    if (kind === 'wish') {
      return `<g class="route-pin-target" aria-hidden="true">
        <circle class="route-pin-target-ring" cx="0" cy="0" r="9"></circle>
        <circle class="route-pin-target-mid" cx="0" cy="0" r="5.5"></circle>
        <circle class="route-pin-target-core" cx="0" cy="0" r="2.2"></circle>
      </g>`;
    }
    return `<circle class="route-pin-dot" cx="0" cy="0" r="6" aria-hidden="true"></circle>`;
  }

  function insertReachPin(container, hit, x, y, kind = 'saving') {
    const px = x(hit.day);
    const py = y(hit.value);
    const pinClass = kind === 'wish' ? 'route-arrival-pin wish' : 'route-arrival-pin saving';
    container.insertAdjacentHTML(
      'beforeend',
      `<g class="${pinClass}" transform="translate(${px.toFixed(2)}, ${py.toFixed(2)})">
        ${pinMarkup(kind)}
      </g>`
    );
  }

  function render(options = {}) {
    const cycleBtn = $('routeCycleBtn');
    if (cycleBtn) cycleBtn.textContent = state.cycle;
    if ($('routeYearsInput') && document.activeElement !== $('routeYearsInput') && !options.preserveYearsInput) {
      $('routeYearsInput').value = state.years;
    }
    if ($('routeAmountInput') && document.activeElement !== $('routeAmountInput') && !options.preserveAmountInput) {
      $('routeAmountInput').value = state.amount;
    }
    const priceInput = $('routePriceInput');
    if (priceInput && document.activeElement !== priceInput && !options.preservePriceInput) {
      priceInput.value = String(state.price);
    }
    const targetDaysInput = $('routeTargetDaysInput');
    if (targetDaysInput && document.activeElement !== targetDaysInput && !options.preserveTargetDaysInput) {
      targetDaysInput.value = String(state.targetDays);
    }
    updateTargetDaysLabel();
    if ($('routeItemName')) $('routeItemName').textContent = state.item;

    const {
      saving,
      wish,
      extra,
      maxDay,
      wishHit,
      savingHit,
      chance,
      snapshot,
    } = computeRouteData();
    const allPoints = [...saving, ...wish, ...extra.flatMap((route) => route.points)];
    const maxValue = Math.max(state.price * 1.18, ...allPoints.map((p) => p.value)) * 1.08;
    const pad = { left: 34, right: 12, top: 16, bottom: 26 };
    const w = 318;
    const h = 230;
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const maxScale = Math.log1p(maxValue);
    const x = (day) => pad.left + (day / maxDay) * plotW;
    const y = (value) => pad.top + plotH - (Math.log1p(Math.max(0, value)) / maxScale) * plotH;
    chartModel = { saving, wish, extra, maxDay, pad, plotH, x, y };

    const grid = $('routeGrid');
    if (grid) {
      grid.innerHTML = '';
      [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
        const yy = pad.top + plotH * t;
        grid.insertAdjacentHTML('beforeend', `<line class="route-grid-line" x1="${pad.left}" x2="${w - pad.right}" y1="${yy}" y2="${yy}"></line>`);
      });
      [0, 0.5, 1].forEach((t) => {
        const value = Math.round(Math.expm1(maxScale * (1 - t)));
        const yy = pad.top + plotH * t + 4;
        grid.insertAdjacentHTML('beforeend', `<text class="route-axis-label" x="0" y="${yy}">RM ${fmt.format(value)}</text>`);
      });
      grid.insertAdjacentHTML('beforeend', `<text class="route-axis-label" x="${pad.left}" y="${h - 4}">오늘</text>`);
      grid.insertAdjacentHTML('beforeend', `<text class="route-axis-label" x="${w - 42}" y="${h - 4}">${state.years}년</text>`);
    }

    const lines = $('routeLines');
    if (lines) {
      lines.innerHTML = `
        <path class="route-line saving" d="${pathFor(saving, x, y, savingHit?.day ?? null)}"></path>
        <path class="route-line wish" d="${pathFor(wish, x, y, wishHit?.day ?? null)}"></path>
      `;
      extra.forEach((route) => {
        const hit = firstReach(route.points);
        lines.insertAdjacentHTML('beforeend', `<path class="route-line extra" d="${pathFor(route.points, x, y, hit?.day ?? null)}"></path>`);
      });
    }

    const pins = $('routePins');
    if (pins) {
      pins.innerHTML = '';
      if (savingHit) insertReachPin(pins, savingHit, x, y, 'saving');
      if (wishHit) insertReachPin(pins, wishHit, x, y, 'wish');
    }

    hideTooltip();

    if ($('routeChanceMain')) $('routeChanceMain').textContent = `${chance}%`;
    const cardRecommendation = recommendForCard();
    if ($('routeRecommend')) {
      $('routeRecommend').textContent = `RM ${formatPerCycle(cardRecommendation.perCycleAmount)}`;
    }
    if ($('routeRecommendMeta')) {
      $('routeRecommendMeta').textContent = `${cardRecommendation.cycle} · 월 RM ${fmt.format(cardRecommendation.monthlyBudget)}`;
    }

    const legend = $('routeLegend');
    if (legend) {
      legend.innerHTML = `
        <span><i class="route-dot"></i>일반 저축</span>
        <span><i class="route-dot orange"></i>위시부스터</span>
        ${state.extraRoutes.length ? '<span><i class="route-dot blue"></i>추가 레이스</span>' : ''}
      `;
    }

    if ($('recommendModal')?.classList.contains('open') && activeRecommendationMode) {
      selectRecommendation(activeRecommendationMode);
    }

    emitUpdate(snapshot);
  }

  function bindEvents() {
    if (initialized) return;
    initialized = true;

    const cycleMenu = $('routeCycleMenu');
    if (cycleMenu) {
      cycleMenu.innerHTML = Object.keys(cycles)
        .map((cycle) => `<button type="button" data-cycle="${cycle}">${cycle}</button>`)
        .join('');
      cycleMenu.addEventListener('click', (event) => {
        const cycle = event.target.dataset?.cycle;
        if (!cycle) return;
        window.WishFastTracker?.track('click_route_cycle', { cycle });
        state.cycle = cycle;
        activeRecommendationMode = null;
        pendingRecommendation = null;
        closeMenus();
        render();
      });
    }

    $('routePriceInput')?.addEventListener('focus', () => {
      priceUserEdited = true;
      syncPrefillMutedUI();
    });
    $('routePriceInput')?.addEventListener('input', () => {
      priceUserEdited = true;
      syncPrefillMutedUI();
      const el = $('routePriceInput');
      const raw = el?.value.trim() ?? '';
      if (raw === '') return;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return;
      state.price = Math.min(999999999, Math.round(num));
      render({ preservePriceInput: true });
    });
    $('routePriceInput')?.addEventListener('blur', () => {
      commitPriceInput();
      render();
    });
    $('routeTargetDaysInput')?.addEventListener('focus', () => {
      targetDaysUserEdited = true;
      targetDaysAtFocus = state.targetDays;
      syncPrefillMutedUI();
    });
    $('routeTargetDaysInput')?.addEventListener('input', () => {
      targetDaysUserEdited = true;
      syncPrefillMutedUI();
      const el = $('routeTargetDaysInput');
      const raw = el?.value.trim() ?? '';
      if (raw === '') return;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return;
      state.targetDays = Math.min(10950, Math.round(num));
      updateTargetDaysLabel();
      render({ preserveTargetDaysInput: true });
      clearTimeout(targetDaysInputTrackTimer);
      targetDaysInputTrackTimer = setTimeout(() => {
        window.WishFastTracker?.track('input_route_target_days', {
          target_days: state.targetDays,
          item: state.item,
          price: state.price,
        });
      }, 800);
    });
    $('routeTargetDaysInput')?.addEventListener('blur', () => {
      const previousTargetDays = targetDaysAtFocus ?? state.targetDays;
      commitTargetDaysInput();
      if (state.targetDays !== previousTargetDays) {
        window.WishFastTracker?.track('change_route_target_days', {
          target_days: state.targetDays,
          previous_target_days: previousTargetDays,
          item: state.item,
          price: state.price,
        });
      }
      lastTrackedTargetDays = state.targetDays;
      targetDaysAtFocus = null;
      render();
    });
    $('routeYearsInput')?.addEventListener('input', () => {
      const el = $('routeYearsInput');
      const raw = el?.value.trim() ?? '';
      if (raw === '') return;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return;
      state.years = Math.min(30, Math.round(num));
      state.selectedDay = Math.min(state.selectedDay, state.years * 365);
      render({ preserveYearsInput: true });
    });
    $('routeYearsInput')?.addEventListener('blur', () => {
      commitYearsInput();
      state.selectedDay = Math.min(state.selectedDay, state.years * 365);
      render();
    });
    $('routeAmountInput')?.addEventListener('input', () => {
      activeRecommendationMode = null;
      pendingRecommendation = null;
      closeMenus();
      const el = $('routeAmountInput');
      const raw = el?.value.trim() ?? '';
      if (raw === '') return;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) return;
      state.amount = Math.min(999999999, Math.round(num));
      render({ preserveAmountInput: true });
    });
    $('routeAmountInput')?.addEventListener('blur', () => {
      commitAmountInput();
      render();
    });

    $('routeCycleBtn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = $('routeCycleMenu');
      if (!menu) return;
      const wasOpen = menu.classList.contains('open');
      closeMenus();
      if (!wasOpen) menu.classList.add('open');
    });

    document.addEventListener('click', closeMenus);

    $('routeChart')?.addEventListener('pointermove', showTooltipFromPointer);
    $('routeChart')?.addEventListener('click', showTooltipFromPointer);
    $('routeChart')?.addEventListener('pointerleave', hideTooltip);

    $('routeAddRoute')?.addEventListener('click', () => {
      window.WishFastTracker?.track('click_route_compare', {});
      state.extraRoutes = [{
        monthlyBudget: state.amount,
        perCycleAmount: perCycleAmountForSim(state.amount, state.cycle),
        cycle: state.cycle,
      }];
      state.amount = Math.round(state.amount * 1.25);
      if ($('routeAmountInput')) $('routeAmountInput').value = state.amount;
      render();
    });

    $('routeRecommendCard')?.addEventListener('click', () => {
      window.WishFastTracker?.track('click_recommend_open', {});
      $('recommendModal')?.classList.add('open');
      $('recommendModal')?.setAttribute('aria-hidden', 'false');
      selectRecommendation(activeRecommendationMode || 'amount');
    });

    $('closeRecommend')?.addEventListener('click', () => {
      window.WishFastTracker?.track('click_recommend_close', {});
      $('recommendModal')?.classList.remove('open');
      $('recommendModal')?.setAttribute('aria-hidden', 'true');
    });

    $('recommendModal')?.addEventListener('click', (event) => {
      if (event.target !== $('recommendModal')) return;
      $('recommendModal').classList.remove('open');
      $('recommendModal').setAttribute('aria-hidden', 'true');
    });

    $('amountFirstBtn')?.addEventListener('click', () => {
      window.WishFastTracker?.track('click_recommend_mode', { mode: 'amount' });
      selectRecommendation('amount');
    });
    $('timelineFirstBtn')?.addEventListener('click', () => {
      window.WishFastTracker?.track('click_recommend_mode', { mode: 'timeline' });
      selectRecommendation('timeline');
    });

    $('applyRecommend')?.addEventListener('click', () => {
      if (!pendingRecommendation) return;
      window.WishFastTracker?.track('click_recommend_apply', {
        mode: pendingRecommendation.mode,
        cycle: pendingRecommendation.cycle || null,
        monthly_budget: pendingRecommendation.monthlyBudget || null,
      });
      if (pendingRecommendation.mode === 'amount') {
        state.cycle = pendingRecommendation.cycle;
      } else {
        state.cycle = '매월';
        state.amount = Math.max(1, Math.ceil(pendingRecommendation.monthlyBudget));
        if ($('routeAmountInput')) $('routeAmountInput').value = state.amount;
      }
      if ($('routeCycleBtn')) $('routeCycleBtn').textContent = state.cycle;
      activeRecommendationMode = pendingRecommendation.mode;
      pendingRecommendation = pendingRecommendation.mode === 'timeline'
        ? timelineFitRecommendation()
        : amountFitRecommendation();
      $('recommendModal')?.classList.remove('open');
      $('recommendModal')?.setAttribute('aria-hidden', 'true');
      render();
    });
  }

  global.WishRouteChart = {
    init(options) {
      onUpdate = options?.onUpdate || null;
      bindEvents();
    },
    setFromInputs(input) {
      state.item = input.item || state.item;
      state.price = Math.max(10, Number(input.price) || state.price);
      state.targetDays = Math.max(7, Number(input.targetDays) || state.targetDays);
      state.amount = Math.max(1, Number(input.amount) || state.amount);
      state.years = Math.max(1, Math.min(30, Number(input.years) || state.years));
      if (input.cycle && cycles[input.cycle]) state.cycle = input.cycle;
      state.extraRoutes = [];
      targetDaysUserEdited = false;
      priceUserEdited = false;
      activeRecommendationMode = null;
      pendingRecommendation = null;
      render();
    },
    getState() {
      return { ...state };
    },
    getCurrentSnapshot() {
      return computeRouteData().snapshot;
    },
    syncInputsFromDom,
    render,
  };
})(window);
