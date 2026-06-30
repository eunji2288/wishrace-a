(function (global) {
  const SEED_FUND = 50;
  const DEFAULT_WAGE = 8.72;
  const RM_PER_USD = 4.47;
  const SAVING_RATE = 0.007;
  const STABLE_RATE = 0.0365;

  const PERIOD_YEARS = { '1Y': 1, '3Y': 3, '5Y': 5, '10Y': 10, '20Y': 20 };

  const CYCLES = {
    daily: { key: 'daily', label: 'Daily', labelKo: '매일', intervalDays: 1 },
    weekly: { key: 'weekly', label: 'Weekly', labelKo: '매주', intervalDays: 7 },
    twice_week: { key: 'twice_week', label: '2×/week', labelKo: '일주일에 2회', intervalDays: 3.5 },
    monthly: { key: 'monthly', label: 'Monthly', labelKo: '매월', intervalDays: 30 },
  };

  const INVESTMENT_TIERS = [
    { minUsd: 500, rate: 0.108, label: '10.8%', tier: '500_plus' },
    { minUsd: 100, rate: 0.096, label: '9.6%', tier: '100_plus' },
    { minUsd: 50, rate: 0.084, label: '8.4%', tier: '50_plus' },
    { minUsd: 0, rate: 0.016, label: '1.6%', tier: 'under_50' },
  ];

  function fmtRM(value) {
    return `RM ${Math.round(value).toLocaleString('en-MY')}`;
  }

  function fmtOne(value) {
    return Number(value).toFixed(1).replace(/\.0$/, '');
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Math.round(days));
    return d;
  }

  function fmtDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${day}`;
  }

  function balanceToUsd(balanceRM) {
    return balanceRM / RM_PER_USD;
  }

  function getInvestmentRate(balanceRM) {
    const usd = balanceToUsd(balanceRM);
    for (const tier of INVESTMENT_TIERS) {
      if (usd >= tier.minUsd) return tier.rate;
    }
    return 0.016;
  }

  function getTierInfo(balanceRM) {
    const usd = balanceToUsd(balanceRM);
    for (const tier of INVESTMENT_TIERS) {
      if (usd >= tier.minUsd) {
        return { ...tier, annualPct: tier.rate * 100, balanceUsd: usd };
      }
    }
    return { ...INVESTMENT_TIERS[3], annualPct: 1.6, balanceUsd: usd };
  }

  /** 일복리 + 주기별 납입 */
  function simulatePath(opts) {
    const {
      tiered = false,
      flatRate = SAVING_RATE,
      horizonDays,
      depositAmount,
      intervalDays,
      seedFund = SEED_FUND,
      startDate = new Date(),
    } = opts;

    let balance = seedFund;
    let nextDeposit = intervalDays;
    const points = [{
      day: 0,
      month: 0,
      balance,
      date: new Date(startDate),
      tier: getTierInfo(balance),
    }];

    for (let day = 1; day <= horizonDays; day++) {
      const rate = tiered ? getInvestmentRate(balance) : flatRate;
      balance *= 1 + rate / 365;

      if (day >= nextDeposit - 0.001) {
        balance += depositAmount;
        nextDeposit += intervalDays;
      }

      if (day % 30 === 0 || day === horizonDays) {
        points.push({
          day,
          month: day / 30,
          balance,
          date: addDays(startDate, day),
          tier: getTierInfo(balance),
        });
      }
    }
    return points;
  }

  function findReachDay(opts, target, maxDays = 365 * 20) {
    const {
      tiered = false,
      flatRate = SAVING_RATE,
      depositAmount,
      intervalDays,
      seedFund = SEED_FUND,
      startDate = new Date(),
    } = opts;

    let balance = seedFund;
    let nextDeposit = intervalDays;

    for (let day = 1; day <= maxDays; day++) {
      const rate = tiered ? getInvestmentRate(balance) : flatRate;
      balance *= 1 + rate / 365;

      if (day >= nextDeposit - 0.001) {
        balance += depositAmount;
        nextDeposit += intervalDays;
      }

      if (balance >= target) {
        return {
          day,
          month: day / 30,
          balance,
          date: addDays(startDate, day),
          tier: getTierInfo(balance),
        };
      }
    }
    return null;
  }

  function reachDay(points, target) {
    for (const p of points) {
      if (p.balance >= target) return p;
    }
    return null;
  }

  function interpolateAtMonth(points, monthFloat) {
    if (!points.length) return 0;
    const m = Math.max(0, monthFloat);
    let lo = points[0];
    let hi = points[points.length - 1];
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].month <= m && points[i + 1].month >= m) {
        lo = points[i];
        hi = points[i + 1];
        break;
      }
    }
    if (lo.month === hi.month) return lo.balance;
    const t = (m - lo.month) / (hi.month - lo.month);
    return lo.balance + (hi.balance - lo.balance) * t;
  }

  function calcProbability(projectedAmount, itemPrice) {
    const R = projectedAmount / itemPrice;
    const A = R * 100;
    let C;
    if (A >= 100) C = Math.min(95.9, 90.0 + (A - 100) * 0.1);
    else if (A >= 85) C = 75 + ((A - 85) / 15) * 14;
    else if (A >= 70) C = 60 + ((A - 70) / 15) * 14;
    else if (A >= 50) C = 40 + ((A - 50) / 20) * 19;
    else C = 20 + (A / 50) * 19;
    return Math.round(C);
  }

  function recommendCycle(perDeposit) {
    const x = perDeposit;
    if (x >= 1 && x <= 5) {
      return { ...CYCLES.daily, hint: '추천 주기: Daily', warn: false };
    }
    if (x >= 6 && x <= 40) {
      return { ...CYCLES.weekly, hint: '추천 주기: Weekly', warn: false };
    }
    if (x >= 41 && x <= 120) {
      return {
        ...CYCLES.twice_week,
        hint: '추천 주기: Weekly 또는 일주일에 2회',
        warn: false,
      };
    }
    return {
      ...CYCLES.monthly,
      hint: '추천 주기: Monthly (금액 부담 경고)',
      warn: true,
    };
  }

  function buildSimulation(input) {
    const targetAmount = Math.max(1, Number(input.targetAmount) || 1);
    const itemName = input.itemName || '위시템';
    const wage = Math.max(0.01, Number(input.wage) || DEFAULT_WAGE);
    const cycleKey = input.cycleKey || 'monthly';
    const depositAmount = Math.max(1, Number(input.depositAmount) || 150);
    const periodKey = input.periodKey || '5Y';
    const horizonMonths = Math.max(
      1,
      Number(input.horizonMonths) || (PERIOD_YEARS[periodKey] || 5) * 12
    );
    const horizonDays = horizonMonths * 30;
    const startDate = new Date();
    const cycle = CYCLES[cycleKey] || CYCLES.weekly;
    const recommended = recommendCycle(depositAmount);

    const savingPoints = simulatePath({
      tiered: false,
      flatRate: SAVING_RATE,
      horizonDays,
      depositAmount,
      intervalDays: cycle.intervalDays,
    });

    const growthPoints = simulatePath({
      tiered: true,
      horizonDays,
      depositAmount,
      intervalDays: cycle.intervalDays,
    });

    const stablePoints = simulatePath({
      tiered: false,
      flatRate: STABLE_RATE,
      horizonDays,
      depositAmount,
      intervalDays: cycle.intervalDays,
    });

    const savingReach = findReachDay({
      tiered: false,
      flatRate: SAVING_RATE,
      depositAmount,
      intervalDays: cycle.intervalDays,
      startDate,
    }, targetAmount);

    const growthReach = findReachDay({
      tiered: true,
      depositAmount,
      intervalDays: cycle.intervalDays,
      startDate,
    }, targetAmount);

    const stableReach = findReachDay({
      tiered: false,
      flatRate: STABLE_RATE,
      depositAmount,
      intervalDays: cycle.intervalDays,
      startDate,
    }, targetAmount);

    const growthAtEnd = growthPoints[growthPoints.length - 1]?.balance || SEED_FUND;
    const savingAtEnd = savingPoints[savingPoints.length - 1]?.balance || SEED_FUND;
    const projectedAmount = growthAtEnd;

    const probabilityC = calcProbability(projectedAmount, targetAmount);
    const extraMoney = Math.max(0, growthAtEnd - savingAtEnd);
    const laborHours = extraMoney / wage;
    const laborDays = laborHours / 8;

    const fasterDays = savingReach && growthReach
      ? Math.max(0, savingReach.day - growthReach.day)
      : 0;

    const growthDaysToGoal = growthReach?.day || null;
    const endTier = growthReach?.tier || getTierInfo(SEED_FUND);

    const maxReachDay = Math.max(
      savingReach?.day || horizonDays,
      stableReach?.day || horizonDays,
      growthReach?.day || horizonDays
    );

    return {
      itemName,
      targetAmount,
      depositAmount,
      periodKey,
      horizonMonths,
      horizonYears: horizonMonths / 12,
      horizonDays,
      cycle,
      cycleKey,
      recommended,
      wage,
      startDate,
      savingPoints,
      stablePoints,
      growthPoints,
      savingReach,
      stableReach,
      growthReach,
      growthDaysToGoal,
      fasterDays,
      projectedAmount,
      probabilityC,
      extraMoney,
      laborHours,
      laborDays,
      endTier,
      maxReachDay,
      growth: {
        label: '스마트 챌린지 (구간별 수익)',
        tab: endTier.tier,
        tierLabel: endTier.label,
        annualPct: endTier.annualPct,
      },
    };
  }

  function simulateCustomPath(input) {
    const depositAmount = Math.max(1, Number(input.depositAmount) || 100);
    const cycleKey = input.cycleKey || 'weekly';
    const horizonYears = PERIOD_YEARS[input.periodKey || '5Y'] || 5;
    const cycle = CYCLES[cycleKey] || CYCLES.weekly;
    const tiered = input.tiered !== false;
    return simulatePath({
      tiered,
      flatRate: input.flatRate || SAVING_RATE,
      horizonDays: horizonYears * 365,
      depositAmount,
      intervalDays: cycle.intervalDays,
    });
  }

  function racePercent(reachDayVal, maxDay) {
    if (!reachDayVal) return 8;
    return Math.max(8, Math.min(96, (1 - (reachDayVal - 1) / Math.max(1, maxDay)) * 92));
  }

  function progressAtPoint(points, monthFloat, target) {
    const balance = interpolateAtMonth(points, monthFloat);
    const progress = Math.min(100, (balance / target) * 100);
    const left = Math.max(0, target - balance);
    return { balance, progress, left };
  }

  function getDateAtMonth(points, monthFloat) {
    if (!points.length) return new Date();
    const m = Math.max(0, monthFloat);
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].month <= m && points[i + 1].month >= m) {
        const t = (m - points[i].month) / (points[i + 1].month - points[i].month || 1);
        const dayOffset = points[i].day + (points[i + 1].day - points[i].day) * t;
        return addDays(points[0].date, dayOffset);
      }
    }
    return points[points.length - 1].date;
  }

  global.WishFastFinance = {
    SEED_FUND,
    DEFAULT_WAGE,
    RM_PER_USD,
    SAVING_RATE,
    STABLE_RATE,
    PERIOD_YEARS,
    CYCLES,
    INVESTMENT_TIERS,
    fmtRM,
    fmtOne,
    fmtDate,
    addDays,
    getInvestmentRate,
    getTierInfo,
    simulatePath,
    simulateCustomPath,
    buildSimulation,
    calcProbability,
    recommendCycle,
    racePercent,
    progressAtPoint,
    interpolateAtMonth,
    getDateAtMonth,
    reachDay,
    findReachDay,
  };
})(window);
