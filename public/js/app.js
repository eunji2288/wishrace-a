(function () {
  const F = window.WishFastFinance;
  let current = 's1';
  let viewResultsTimer = null;

  function trackScreenView(screenId) {
    if (!window.WishFastTracker) return;
    WishFastTracker.track(`view_${screenId}`, {
      screen: screenId,
      item: state.itemName || null,
    });
    if (viewResultsTimer) {
      clearTimeout(viewResultsTimer);
      viewResultsTimer = null;
    }
    if (screenId === 's3') {
      viewResultsTimer = setTimeout(() => {
        WishFastTracker.track('view_results', {
          item: state.itemName,
          target_amount: state.targetAmount,
          dwell_ms: 2500,
        });
        viewResultsTimer = null;
      }, 2500);
    }
  }
  let simResult = null;
  let routeSnapshot = null;

  const ROUTE_CYCLE_TO_KEY = {
    '매일': 'daily',
    '주 3회': 'twice_week',
    '주 2회': 'twice_week',
    '매주': 'weekly',
    '매월': 'monthly',
  };

  const KEY_TO_ROUTE_CYCLE = {
    daily: '매일',
    twice_week: '주 2회',
    weekly: '매주',
    monthly: '매월',
  };

  const state = {
    itemName: 'iPad',
    targetAmount: 2000,
    targetMonths: 12,
    depositAmount: 150,
    wage: F.DEFAULT_WAGE,
    cycleKey: 'monthly',
  };

  const $ = (id) => document.getElementById(id);

  function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = val;
  }

  function parseRmField(id, fallback) {
    const raw = $(id)?.value?.trim() ?? '';
    if (!raw) return fallback;
    const num = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }

  function captureInputs() {
    state.itemName = $('itemInput').value.trim() || 'iPad';
    state.targetAmount = parseRmField('amountInput', 2000);
    const selectedPeriod = document.querySelector('.period-btn.selected');
    state.targetMonths = Math.max(1, Number(selectedPeriod?.dataset.months) || 12);
    state.depositAmount = parseRmField('depositInput', 150);
    state.cycleKey = 'monthly';
  }

  function setPeriodMonths(months) {
    document.querySelectorAll('.period-btn').forEach((btn) => {
      btn.classList.toggle('selected', Number(btn.dataset.months) === months);
    });
    state.targetMonths = months;
  }

  function runSimulation() {
    simResult = F.buildSimulation({
      itemName: state.itemName,
      targetAmount: state.targetAmount,
      depositAmount: state.depositAmount,
      wage: state.wage,
      horizonMonths: state.targetMonths,
      cycleKey: state.cycleKey,
    });
    return simResult;
  }

  function reachMonths(reach, horizonDays) {
    if (!reach) return null;
    return Math.max(1, Math.round(reach.day / 30));
  }

  function formatReachMonths(reach, horizonDays) {
    const m = reachMonths(reach, horizonDays);
    return m ? `${m}개월 도착` : '미도달';
  }

  const LOADING_LINES = [
    '현재 저축 속도 분석 중',
    '위시템 도착선 계산 중',
    '더 빠른 루트 찾는 중',
    '알바 시간으로 바꿔보는 중',
    '도착일 나왔어요',
  ];

  function runLoadingSequence(onDone) {
    const caption = $('loadingCaption');
    let step = 0;
    caption.textContent = LOADING_LINES[0];
    const interval = setInterval(() => {
      step += 1;
      if (step < LOADING_LINES.length) {
        caption.style.opacity = '0.4';
        setTimeout(() => {
          caption.textContent = LOADING_LINES[step];
          caption.style.opacity = '1';
        }, 80);
      }
    }, 420);

    setTimeout(() => {
      clearInterval(interval);
      onDone();
    }, 2100);
  }

  function showResultScreen() {
    const loadingEl = $('loading');
    const resultEl = $('s3');
    loadingEl.classList.remove('active');
    loadingEl.style.transform = 'translateX(-100%)';
    resultEl.style.transition = 'none';
    resultEl.style.transform = 'translateX(0)';
    resultEl.classList.add('active', 'result-fade-in');
    current = 's3';
    trackScreenView('s3');
    requestAnimationFrame(() => {
      renderResults();
      const body = $('resultBody');
      if (body) body.scrollTop = 0;
      setTimeout(() => {
        if (routeSnapshot) renderLegacySections(routeSnapshot);
      }, 350);
    });
  }

  function formatReachDays(days) {
    if (days == null) return '미도달';
    const months = Math.max(1, Math.round(days / 30));
    return `${months}개월 도착`;
  }

  function syncRouteChartFromState() {
    if (!window.WishRouteChart) return;
    WishRouteChart.setFromInputs({
      item: state.itemName,
      price: state.targetAmount,
      targetDays: state.targetMonths * 30,
      amount: state.depositAmount,
      years: Math.max(5, Math.ceil(state.targetMonths / 12)),
      cycle: KEY_TO_ROUTE_CYCLE[state.cycleKey] || '매주',
    });
  }

  function onRouteChartUpdate(route) {
    routeSnapshot = route;
    state.itemName = route.item;
    state.targetAmount = route.price;
    state.targetMonths = Math.max(1, Math.round(route.targetDays / 30));
    state.depositAmount = route.perCycleAmount;
    state.cycleKey = ROUTE_CYCLE_TO_KEY[route.cycle] || 'weekly';
    runSimulation();
    renderLegacySections(route);
  }

  function renderLegacySections(route) {
    const r = simResult;
    if (!r || !route) return;

    try {
    const savingDays = route.savingReachDay;
    const wishDays = route.wishReachDay;
    const savingM = savingDays ? Math.max(1, Math.round(savingDays / 30)) : null;
    const growthM = wishDays ? Math.max(1, Math.round(wishDays / 30)) : null;
    const monthsSaved = savingM && growthM ? Math.max(0, savingM - growthM) : 0;

    setText('resultHeroSub', `${state.itemName}, 생각보다 가까워`);
    setText(
      'resultHeroBig',
      monthsSaved > 0 ? `${monthsSaved}개월 먼저` : route.fasterDays > 0 ? `${Math.max(1, Math.round(route.fasterDays / 30))}개월 먼저` : '더 빨리 도착'
    );
    setText(
      'resultHeroMeta',
      `지금 속도는 ${savingM != null ? savingM + '개월' : '미도달'}, 위시부스터는 ${growthM != null ? growthM + '개월' : '미도달'}`
    );

    setText('miniGoal', F.fmtRM(route.price));
    setText('miniSaved', monthsSaved > 0 ? `${monthsSaved}개월` : route.fasterDays > 0 ? `${Math.max(1, Math.round(route.fasterDays / 30))}개월` : '—');
    setText('miniLabor', `${F.fmtOne(r.laborDays)}일`);
    setText('raceGoalAmount', F.fmtRM(route.price));

    setText('savingReachLabel', formatReachDays(savingDays));
    setText('growthReachLabel', formatReachDays(wishDays));
    setText('wageDisplay', r.wage.toFixed(2));

    animatePurchaseRace(savingDays, wishDays);

    if (savingM != null && growthM != null) {
      setText(
        'raceInsight',
        `목표선 ${F.fmtRM(route.price)}까지 일반저축은 ${savingM}개월, 위시부스터는 ${growthM}개월 도착이에요. 같은 화면에서 구매 가능선에 얼마나 가까워졌는지 바로 비교할 수 있어요.`
      );
    }

    const savedPct = Math.min(99, Math.round((F.SEED_FUND / route.price) * 100 + 20));
    setText('dashItemName', state.itemName);
    setText('dashGoalAmt', F.fmtRM(route.price));
    setText('dashSavedAmt', F.fmtRM(route.price * (savedPct / 100)));
    setText('dashRemainAmt', F.fmtRM(route.price * (1 - savedPct / 100)));
    setText('s8GoalAmt', F.fmtRM(route.price));
    setText('s8ItemName', state.itemName);
    const progressFill = $('progressFill');
    if (progressFill) progressFill.style.width = `${savedPct}%`;
    } catch (err) {
      console.warn('[WishRace] legacy section render skipped', err);
    }
  }

  function renderResults() {
    captureInputs();
    runSimulation();
    syncRouteChartFromState();

    if (!routeSnapshot && simResult) {
      renderLegacySections({
        item: state.itemName,
        price: state.targetAmount,
        targetDays: state.targetMonths * 30,
        monthlyBudget: state.depositAmount,
        perCycleAmount: state.depositAmount,
        cycle: KEY_TO_ROUTE_CYCLE[state.cycleKey] || '매주',
        savingReachDay: simResult.savingReach?.day ?? null,
        wishReachDay: simResult.growthReach?.day ?? null,
        fasterDays: simResult.fasterDays ?? 0,
      });
    }
  }

  function purchaseRaceWidths(savingDays, wishDays) {
    const savingM = savingDays ? Math.max(1, Math.round(savingDays / 30)) : 1;
    const wishM = wishDays ? Math.max(1, Math.round(wishDays / 30)) : 1;
    const diff = Math.max(0, savingM - wishM);
    const normalWidth = Math.max(62, Math.min(82, 78 - diff * 3));
    const fastWidth = Math.max(normalWidth + 8, Math.min(92, 84 + diff * 3));
    return { saving: normalWidth, growth: fastWidth };
  }

  function animatePurchaseRace(savingDays, wishDays) {
    const widths = purchaseRaceWidths(savingDays, wishDays);
    [
      ['saving', widths.saving, 120],
      ['growth', widths.growth, 280],
    ].forEach(([prefix, width, delay]) => {
      const fill = $(`${prefix}Fill`);
      if (!fill) return;
      fill.style.transitionDuration = '3200ms';
      fill.style.transitionTimingFunction = 'linear';
      fill.style.width = '0%';
      setTimeout(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            fill.style.width = `${width}%`;
          });
        });
      }, delay);
    });
  }

  function goTo(target, direction) {
    const curEl = $(current);
    const nextEl = $(target);
    if (!curEl || !nextEl || curEl === nextEl) return;

    if (direction === 'back') {
      nextEl.style.transition = 'none';
      nextEl.style.transform = 'translateX(-100%)';
      nextEl.classList.add('active');
      requestAnimationFrame(() => {
        nextEl.style.transition = '';
        nextEl.style.transform = 'translateX(0%)';
        curEl.style.transform = 'translateX(100%)';
        curEl.classList.remove('active');
      });
    } else {
      nextEl.style.transition = 'none';
      nextEl.style.transform = 'translateX(100%)';
      nextEl.classList.add('active');
      requestAnimationFrame(() => {
        nextEl.style.transition = '';
        nextEl.style.transform = 'translateX(0%)';
        curEl.style.transform = 'translateX(-100%)';
        curEl.classList.remove('active');
      });
    }
    current = target;
    trackScreenView(target);
  }

  function syncLatestRouteState() {
    if (window.WishRouteChart?.getCurrentSnapshot) {
      const route = WishRouteChart.getCurrentSnapshot();
      routeSnapshot = route;
      state.itemName = route.item;
      state.targetAmount = route.price;
      state.targetMonths = Math.max(1, Math.round(route.targetDays / 30));
      state.depositAmount = route.monthlyBudget;
      state.cycleKey = ROUTE_CYCLE_TO_KEY[route.cycle] || 'weekly';
      runSimulation();
      return route;
    }
    captureInputs();
    runSimulation();
    return routeSnapshot;
  }

  function buildChallengeShareText(route) {
    const r = route || routeSnapshot;
    const item = r?.item || state.itemName || '위시템';
    const url = location.href;

    if (!r) {
      return `내 위시템: ${item} · 너도 네 위시템 털어봐. ${url}`;
    }

    const savingDays = r.savingReachDay ?? simResult?.savingReach?.day ?? null;
    const wishRaceDays = r.wishReachDay ?? simResult?.growthReach?.day ?? null;
    const daysSaved =
      savingDays != null && wishRaceDays != null
        ? Math.max(0, savingDays - wishRaceDays)
        : null;
    const survivalPct = r.chancePercent ?? simResult?.probabilityC ?? null;
    const goalAmount = F.fmtRM(r.price ?? state.targetAmount);
    const monthlyBudget = F.fmtRM(r.monthlyBudget ?? state.depositAmount);
    const cycleLabel = r.cycle || KEY_TO_ROUTE_CYCLE[state.cycleKey] || '매주';

    const segments = [
      `내 위시템: ${item}`,
      `목표 ${goalAmount}`,
      `월 ${monthlyBudget} · ${cycleLabel}`,
      savingDays != null ? `그냥 모으면 ${savingDays}일` : '그냥 모으면 —',
      wishRaceDays != null ? `위시부스터면 ${wishRaceDays}일` : '위시부스터면 —',
      daysSaved != null ? `${daysSaved}일 단축 가능` : '단축 —',
      survivalPct != null ? `통장 생존 가능성 ${survivalPct}%` : '통장 생존 가능성 —',
      '너도 네 위시템 털어봐.',
    ];

    return `${segments.join(' · ')} ${url}`;
  }

  function trackShare(source, extra) {
    WishFastTracker.track('click_share', {
      source,
      item: state.itemName,
      ...(extra || {}),
    });
  }

  function handleShare(source) {
    syncLatestRouteState();
    trackShare(source);
    const text = `위시레이스로 ${state.itemName} ${F.fmtRM(state.targetAmount)} 목표! 🎯`;
    if (navigator.share) {
      navigator.share({ title: '위시레이스', text, url: location.href }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text + '\n' + location.href);
      alert('공유 문구가 복사되었습니다!');
    }
  }

  function editWage() {
    WishFastTracker.track('click_edit_wage', { wage: state.wage });
    const raw = prompt('시급을 입력하세요 (RM)', state.wage.toFixed(2));
    if (raw == null) return;
    const val = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(val) || val <= 0) return alert('올바른 시급을 입력해주세요.');
    state.wage = val;
    runSimulation();
    if (routeSnapshot) renderLegacySections(routeSnapshot);
  }

  WishRouteChart.init({ onUpdate: onRouteChartUpdate });

  $('toS2').addEventListener('click', () => {
    WishFastTracker.track('click_start', { entry: 'cta_button' });
    goTo('s2');
  });
  $('s1Circle').addEventListener('click', () => {
    WishFastTracker.track('click_start', { entry: 'hero_circle' });
    goTo('s2');
  });

  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const months = Number(btn.dataset.months);
      WishFastTracker.track('click_period', { months });
      setPeriodMonths(months);
    });
  });

  $('toS3').addEventListener('click', () => {
    captureInputs();
    WishFastTracker.track('submit_inputs', {
      item: state.itemName,
      target_amount: state.targetAmount,
      target_months: state.targetMonths,
      deposit_amount: state.depositAmount,
    });
    routeSnapshot = null;
    runSimulation();
    $('loadingCaption').textContent = LOADING_LINES[0];
    $('loadingCaption').style.opacity = '1';
    $('s3').classList.remove('result-fade-in');
    goTo('loading');
    runLoadingSequence(showResultScreen);
  });

  $('btnSeedMoney').addEventListener('click', () => {
    WishFastTracker.track('click_seed_money', {
      item: state.itemName,
      target_amount: state.targetAmount,
    });
    goTo('s5');
  });

  $('toContact').addEventListener('click', () => {
    WishFastTracker.track('click_contact_cta', {
      item: state.itemName,
      target_amount: state.targetAmount,
    });
    goTo('sContact');
  });

  $('btnShareS8').addEventListener('click', () => handleShare('friend_brag'));
  $('wageRow').addEventListener('click', editWage);

  let shareToastTimer = null;
  function showShareToast() {
    const toast = $('shareToast');
    if (!toast) return;
    toast.classList.add('show');
    clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  $('btnShareChallenge').addEventListener('click', async () => {
    const route = syncLatestRouteState();
    const text = buildChallengeShareText(route);
    const r = route || routeSnapshot;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    trackShare('challenge_complete', {
      timestamp: new Date().toISOString(),
      saving_days: r?.savingReachDay ?? simResult?.savingReach?.day ?? null,
      wishrace_days: r?.wishReachDay ?? simResult?.growthReach?.day ?? null,
      days_saved:
        r?.savingReachDay != null && r?.wishReachDay != null
          ? Math.max(0, r.savingReachDay - r.wishReachDay)
          : simResult?.savingReach?.day != null && simResult?.growthReach?.day != null
            ? Math.max(0, simResult.savingReach.day - simResult.growthReach.day)
            : null,
      survival_pct: r?.chancePercent ?? simResult?.probabilityC ?? null,
    });
    showShareToast();
  });

  document.querySelectorAll('[data-back]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-back');
      const target = id === 'contact' ? 'sContact' : 's' + id;
      WishFastTracker.track('click_back', { from: current, to: target });
      goTo(target, 'back');
    });
  });

  const emailInput = $('emailInput');
  const phoneInput = $('phoneInput');
  const btnSubmitContact = $('btnSubmitContact');

  function validateContact() {
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();
    btnSubmitContact.disabled = !(email.length > 3 || phone.length >= 8);
  }
  emailInput.addEventListener('input', validateContact);
  phoneInput.addEventListener('input', validateContact);

  btnSubmitContact.addEventListener('click', async () => {
    btnSubmitContact.disabled = true;
    btnSubmitContact.textContent = '신청 중...';
    await WishFastTracker.submitContact({
      email: emailInput.value.trim() || null,
      phone: phoneInput.value.trim() || null,
      wish_item: state.itemName,
      goal_amount: F.fmtRM(state.targetAmount),
    });
    btnSubmitContact.textContent = '최대 RM 50 혜택 선점하고 사전 예약하기';
    btnSubmitContact.disabled = false;
    goTo('sComplete');
  });

  const riskBox = $('riskCheckBox');
  const toSafetyConfirmBtn = $('toSafetyConfirm');
  $('riskCheckRow')?.addEventListener('click', () => {
    if (!riskBox || !toSafetyConfirmBtn) return;
    const checked = riskBox.classList.toggle('checked');
    toSafetyConfirmBtn.disabled = !checked;
    if (checked) {
      WishFastTracker.track('check_s5_ack', { item: state.itemName });
    }
  });
  toSafetyConfirmBtn?.addEventListener('click', () => {
    if (toSafetyConfirmBtn.disabled) return;
    WishFastTracker.track('click_s5_confirm', {
      item: state.itemName,
      target_amount: state.targetAmount,
    });
    goTo('s4');
  });
  $('toS8').addEventListener('click', () => {
    WishFastTracker.track('click_goal_preview', { item: state.itemName });
    goTo('s8');
  });

  $('toRestart').addEventListener('click', () => {
    WishFastTracker.track('click_restart', { item: state.itemName });
    goTo('s1', 'back');
    setTimeout(() => {
      emailInput.value = '';
      phoneInput.value = '';
      $('itemInput').value = '';
      $('amountInput').value = '';
      $('depositInput').value = '';
      setPeriodMonths(12);
      $('s3').classList.remove('result-fade-in');
      $('loading').classList.remove('active');
      riskBox?.classList.remove('checked');
      toSafetyConfirmBtn.disabled = true;
      btnSubmitContact.disabled = true;
      btnSubmitContact.textContent = '최대 RM 50 혜택 선점하고 사전 예약하기';
      routeSnapshot = null;
      if (viewResultsTimer) {
        clearTimeout(viewResultsTimer);
        viewResultsTimer = null;
      }
    }, 400);
  });

  document.querySelector('.calc-accordion')?.addEventListener('toggle', (event) => {
    if (event.target.open) {
      WishFastTracker.track('click_calc_accordion', { open: true });
    }
  });

  runSimulation();
  trackScreenView('s1');
})();
