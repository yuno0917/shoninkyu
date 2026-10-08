/* 新卒の手取り計算機: 計算（DOM に触れない純粋な関数）
   前提: 独身・扶養0人（甲欄）、4月入社、給与は当月払い、社会保険料は翌月の給与から、賞与・残業代なし */
(function (root) {
  'use strict';
  const TK = root.TK = root.TK || {};
  const D = TK.DATA;

  // 給与から引く保険料の端数: 50銭以下は切り捨て、50銭を超えると切り上げ（numer / denom 円）
  function cashRound(numer, denom) {
    const q = Math.floor(numer / denom);
    const r = numer - q * denom;
    return 2 * r > denom ? q + 1 : q;
  }

  // ---- 社会保険 ----
  // 報酬月額（通勤手当を含む）から、健康保険の標準報酬月額を決める
  function standardPay(pay) {
    let std = D.healthGrades[0][1];
    for (const g of D.healthGrades) if (pay >= g[2]) std = g[1];
    return std;
  }
  const pensionStandard = std => Math.min(D.pensionMax, Math.max(D.pensionMin, std));
  const bp = pct => Math.round(pct * 100);   // 9.85% → 985（1万分の1単位）

  // 健康保険と子ども・子育て支援金は、合わせた率で計算してから端数を処理する
  function healthShare(std, prefRate) {
    return cashRound(std * (bp(prefRate) + bp(D.supportRate)), 20000);
  }
  function pensionShare(std) {
    return cashRound(pensionStandard(std) * bp(D.pensionRate), 20000);
  }
  function employmentShare(gross) {
    return cashRound(gross * Math.round(D.employmentRate * 1000), 1000);
  }

  // ---- 源泉徴収（電子計算機等による特例、甲欄・扶養0人） ----
  const whParams = year => D.withholding[Math.min(Math.max(year, 2026), D.knownYear.withholding)];
  function salaryDeductionMonthly(A, p) {
    if (A <= p.lowA) return p.lowDeduction;
    if (A <= 299999) return Math.ceil(A * 3 / 10) + 6667;
    if (A <= 549999) return Math.ceil(A * 2 / 10) + 36667;
    if (A <= 708330) return Math.ceil(A / 10) + 91667;
    return 162500;
  }
  function basicMonthly(A, p) {
    if (A <= 2120833) return p.basic;
    if (A <= 2162499) return 40000;
    if (A <= 2204166) return 26667;
    if (A <= 2245833) return 13334;
    return 0;
  }
  // 税率は復興特別所得税などを含めた 102.1%。[上限, 率（10万分の1）, 引く額]
  const WH_RATES = [
    [162500, 5105, 0], [275000, 10210, 8296], [579166, 20420, 36374], [750000, 23483, 54113],
    [1500000, 33693, 130688], [3333333, 40840, 237893], [Infinity, 45945, 408061]
  ];
  // A: その月の給与から非課税の通勤手当と社会保険料を引いた額。10円未満は四捨五入
  function withholding(year, A) {
    const p = whParams(year);
    const B = A - salaryDeductionMonthly(A, p) - basicMonthly(A, p);
    if (B <= 0) return 0;
    const row = WH_RATES.find(r => B <= r[0]);
    const t = B * row[1] - row[2] * 100000;   // 10万分の1円
    return t <= 0 ? 0 : Math.floor((t + 500000) / 1000000) * 10;
  }

  // ---- 年末調整・住民税で使う給与所得（令和8・9年分、所得税法 別表第五） ----
  function salaryIncome(S) {
    if (S < 741000) return 0;
    if (S < 2191000) return S - 740000;
    if (S < 2193000) return 1451000;
    if (S < 2196000) return 1453000;
    if (S < 2200000) return 1456000;
    const a = Math.floor(S / 4000) * 4000;
    if (S < 3600000) return a * 7 / 10 - 80000;
    if (S < 6600000) return a * 8 / 10 - 440000;
    if (S < 8500000) return Math.floor(S * 9 / 10 - 1100000);
    return S - 1950000;
  }
  function basicIncomeTax(income) {
    if (income <= 4890000) return 1040000;
    if (income <= 6550000) return 670000;
    if (income <= 23500000) return 620000;
    return 0;
  }
  // 年税額: 課税所得は1,000円未満切り捨て、102.1%をかけて100円未満切り捨て
  const YEAR_RATES = [[1950000, 5, 0], [3300000, 10, 97500], [6950000, 20, 427500], [9000000, 23, 636000], [18000000, 33, 1536000], [Infinity, 40, 2796000]];
  function yearEndTax(S, social) {
    const income = salaryIncome(S);
    const taxable = Math.floor(Math.max(0, income - social - basicIncomeTax(income)) / 1000) * 1000;
    const row = YEAR_RATES.find(r => taxable <= r[0]);
    const tax = Math.max(0, taxable * row[1] / 100 - row[2]);
    return { income, taxable, tax: Math.floor(tax * 1021 / 100000) * 100 };
  }

  // 住民税（前の年の収入で決まり、6月から翌年5月まで給与から引かれる）
  function residentTax(S, social) {
    const income = salaryIncome(S);
    if (income <= D.residentNonTaxable) return { income, taxable: 0, city: 0, pref: 0, forest: 0, total: 0, june: 0, monthly: 0 };
    const X = Math.floor(Math.max(0, income - social - D.residentBasic) / 1000) * 1000;
    let adjCity = 0;
    let adjPref = 0;
    if (X > 0 && X <= 2000000) {
      adjCity = Math.min(50000, X) * 3 / 100;
      adjPref = Math.min(50000, X) * 2 / 100;
    } else if (X > 2000000) {
      adjCity = 1500;
      adjPref = 1000;
    }
    const city = Math.floor((Math.max(0, X * 6 / 100 - adjCity) + 3000) / 100) * 100;
    const pref = Math.floor((Math.max(0, X * 4 / 100 - adjPref) + 1000) / 100) * 100;
    const total = city + pref + 1000;
    const monthly = Math.floor(total / 12 / 100) * 100;
    return { income, taxable: X, city, pref, forest: 1000, total, june: total - monthly * 11, monthly };
  }

  // ---- 月ごとの手取り ----
  function row(key, label, gross, health, pension, employment, tax, resident) {
    return { key, label, gross, health, pension, employment, tax, resident, deductions: health + pension + employment + tax + resident, net: gross - health - pension - employment - tax - resident };
  }

  // input: { pay: 月給（通勤手当を除く）, commute: 通勤手当, prefCode, year: 入社する年 }
  function simulate(input) {
    const pref = D.prefectures.find(p => p.code === input.prefCode);
    const Y = input.year;
    const pay = input.pay;
    const commute = input.commute;
    const gross = pay + commute;
    const nonTaxCommute = Math.min(commute, 150000);
    const std = standardPay(gross);
    const health = healthShare(std, pref.rate);
    const pension = pensionShare(std);
    const employment = employmentShare(gross);

    // 1年目4月: 社会保険料はまだ引かれない
    const aprA = gross - nonTaxCommute - employment;
    const aprTax = withholding(Y, aprA);
    // 1年目5月〜12月
    const regA = gross - nonTaxCommute - health - pension - employment;
    const regTax = withholding(Y, regA);
    // 年末調整（4〜12月の9回分）
    const S = 9 * (gross - nonTaxCommute);
    const social1 = 8 * (health + pension) + 9 * employment;
    const withheld = aprTax + 8 * regTax;
    const ye = yearEndTax(S, social1);
    // 2年目1月から: 次の年の源泉徴収税額表
    const tax2 = withholding(Y + 1, regA);
    // 2年目6月から: 1年目の収入にかかる住民税
    const rt = residentTax(S, social1);

    const rows = [
      row('apr', Y + '年4月', gross, 0, 0, employment, aprTax, 0),
      row('may', Y + '年5月〜12月（毎月）', gross, health, pension, employment, regTax, 0),
      row('jan', (Y + 1) + '年1月〜5月（毎月）', gross, health, pension, employment, tax2, 0),
      row('jun', (Y + 1) + '年6月', gross, health, pension, employment, tax2, rt.june),
      row('jul', (Y + 1) + '年7月から', gross, health, pension, employment, tax2, rt.monthly)
    ];
    const refund = withheld - ye.tax;
    const firstYearNet = rows[0].net + 8 * rows[1].net + refund;

    const assumed = [];
    if (Y + 1 > D.knownYear.withholding) assumed.push((Y + 1) + '年の源泉徴収税額表はまだ公表されていないため、' + D.knownYear.withholding + '年の表で計算しています。');
    return {
      input, pref, std, pensionStd: pensionStandard(std), health, pension, employment,
      rows, refund, withheld, yearEnd: ye, resident: rt, firstYearNet, S, social1,
      decemberNet: rows[1].net + refund, assumed
    };
  }

  // 同じ給料での、都道府県ごとの5月からの手取り。手取りの多い順（同じ額は同じ順位）
  function byPrefecture(input) {
    const list = D.prefectures.map(p => {
      const s = simulate(Object.assign({}, input, { prefCode: p.code }));
      return { code: p.code, name: p.name, rate: p.rate, net: s.rows[1].net, firstYearNet: s.firstYearNet };
    });
    list.sort((a, b) => b.net - a.net || a.code.localeCompare(b.code));
    list.forEach((r, i) => { r.rank = i > 0 && r.net === list[i - 1].net ? list[i - 1].rank : i + 1; });
    return list;
  }

  function normalizeInput(i) {
    const num = v => (v === '' || v == null ? NaN : Number(v));
    // 「22」「22.5」のように万円で入れたときは、円に直す
    const yen = v => (v > 0 && v < 1000 ? v * 10000 : v);
    const year = Number(i.year) === 2026 ? 2026 : 2027;
    const prefCode = D.prefectures.some(p => p.code === i.pref) ? i.pref : '13';
    const commute = i.commute === '' || i.commute == null ? 0 : num(i.commute);
    return { pay: Math.round(yen(num(i.pay))), commute: Math.round(commute), prefCode, year };
  }

  function validate(n) {
    const errors = [];
    if (!(n.pay >= 150000 && n.pay <= 1000000)) errors.push('月給を150,000〜1,000,000円の範囲で入れてください。');
    if (!(n.commute >= 0 && n.commute <= 150000)) errors.push('通勤手当を0〜150,000円の範囲で入れてください。');
    return errors;
  }

  Object.assign(TK, {
    cashRound, standardPay, pensionStandard, healthShare, pensionShare, employmentShare,
    withholding, salaryIncome, basicIncomeTax, yearEndTax, residentTax, simulate, byPrefecture, normalizeInput, validate
  });
})(typeof window !== 'undefined' ? window : globalThis);
