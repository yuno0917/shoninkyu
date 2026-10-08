/* 新卒の手取り計算機: 画面の処理（フォーム・描画・保存・共有） */
(function () {
  'use strict';
  const TK = window.TK;
  const D = TK.DATA;

  const STORAGE_KEY = 'shoninkyu:v1';

  const form = document.getElementById('calc-form');
  const errorBox = document.getElementById('form-error');
  const prefSelect = document.getElementById('pref-select');
  const resultSection = document.getElementById('result');
  const summaryMeta = document.getElementById('summary-meta');
  const bigRange = document.getElementById('big-range');
  const factList = document.getElementById('fact-list');
  const firstYear = document.getElementById('first-year');
  const whyBox = document.getElementById('why-box');
  const assumeNote = document.getElementById('assume-note');
  const detailHead = document.querySelector('#detail-table thead');
  const detailBody = document.querySelector('#detail-table tbody');
  const detailNote = document.getElementById('detail-note');
  const prefNote = document.getElementById('pref-note');
  const shareBtn = document.getElementById('share-btn');
  const shareBox = document.getElementById('share-box');
  const shareInput = document.getElementById('share-url');
  const shareStatus = document.getElementById('share-status');

  let current = null;

  // ---- 小さな DOM ヘルパー（文字列は必ず textContent として入れる） ----
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(k => {
        const v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    children.flat(Infinity).forEach(c => {
      if (c == null || c === false) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  const yen = n => n.toLocaleString('ja-JP') + '円';

  prefSelect.replaceChildren(...D.prefectures.map(p => h('option', { value: p.code, text: p.name })));
  prefSelect.value = '13';

  function readForm() {
    const e = form.elements;
    return { pay: e.pay.value, commute: e.commute.value, pref: e.pref.value, year: e.year.value };
  }
  function writeForm(s) {
    const e = form.elements;
    if (s.pay != null) e.pay.value = s.pay;
    if (s.commute != null) e.commute.value = s.commute;
    if (D.prefectures.some(p => p.code === s.pref)) e.pref.value = s.pref;
    if (s.year === '2026' || s.year === '2027') e.year.value = s.year;
  }

  // ---- 保存（使えないブラウザでも動くように try/catch で囲む） ----
  function save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ---- URL での共有 ----
  function toParams(n) {
    const p = new URLSearchParams();
    p.set('p', String(n.pay));
    if (n.commute) p.set('c', String(n.commute));
    p.set('pf', n.prefCode);
    p.set('y', String(n.year));
    return p;
  }
  function fromParams(search) {
    const p = new URLSearchParams(search);
    if (!p.has('p')) return null;
    return { pay: p.get('p'), commute: p.get('c') || '', pref: p.get('pf') || '13', year: p.get('y') || '2027' };
  }
  const baseUrl = () => location.href.split(/[?#]/)[0];
  function updateUrl(n) {
    try { history.replaceState(null, '', '?' + toParams(n).toString() + location.hash); } catch (e) { /* file:// などで失敗しても続行 */ }
  }

  // ---- 描画 ----
  function renderSummary(s) {
    const n = s.input;
    const Y = n.year;
    const [apr, may, , jun, jul] = s.rows;
    summaryMeta.textContent = '月給' + yen(n.pay) + (n.commute ? '＋通勤手当' + yen(n.commute) : '') + '・' + s.pref.name + '・' + Y + '年4月入社';
    bigRange.replaceChildren(
      h('span', { class: 'big-label', text: '5月からの手取り（毎月）' }),
      h('span', { class: 'big-num', text: yen(may.net) }),
      h('span', { class: 'big-gain', text: '給料' + yen(may.gross) + 'から、' + yen(may.deductions) + 'が引かれます' })
    );
    const refundText = s.refund >= 0 ? '年末調整で' + yen(s.refund) + '戻る' : '年末調整で' + yen(-s.refund) + '多く引かれる';
    const facts = [
      ['4月（最初の給料）', apr.net],
      ['12月', s.decemberNet, refundText],
      [(Y + 1) + '年6月', jun.net, '住民税が始まる'],
      [(Y + 1) + '年7月から', jul.net]
    ];
    factList.replaceChildren(...facts.map(([name, val, sub]) => h('li', null,
      h('span', { class: 'fact-name', text: name }),
      h('span', { class: 'fact-val', text: yen(val) }),
      sub ? h('span', { class: 'sum-tm', text: sub }) : null
    )));
    firstYear.textContent = '1年目（4〜12月）の手取りの合計は ' + yen(s.firstYearNet) + ' です（年末調整で戻る分を含みます）。';
  }

  function renderWhy(s) {
    const Y = s.input.year;
    const [, may, jan] = s.rows;
    const rt = s.resident;
    const items = [
      '4月は、健康保険と厚生年金がまだ引かれません。前の月の分を、次の月の給料から引くためです。',
      '5月から、健康保険（子ども・子育て支援金を含む）' + yen(s.health) + 'と厚生年金' + yen(s.pension) + 'が引かれます。'
    ];
    if (s.refund > 0) items.push('1年目は9か月分の収入しかないので、毎月の所得税は引かれすぎになります。12月か1月の給料で' + yen(s.refund) + '戻ります。');
    if (jan.tax < may.tax) items.push((Y + 1) + '年1月から所得税の計算方法が変わり、毎月の所得税が' + yen(may.tax - jan.tax) + '少なくなります。');
    if (rt.total > 0) items.push((Y + 1) + '年6月から、1年目の収入にかかる住民税（1年で' + yen(rt.total) + '）が引かれ始めます。6月は' + yen(rt.june) + '、7月からは' + yen(rt.monthly) + 'です。');
    else items.push('1年目の収入では、2年目の住民税はかかりません。');
    whyBox.replaceChildren(
      h('p', null, h('strong', { text: '手取りが変わる理由' })),
      h('ul', null, items.map(t => h('li', { text: t })))
    );
    const notes = [
      Y === 2026
        ? '2027年3月分からの健康保険料率と、2027年4月からの子ども・子育て支援金率・雇用保険料率はまだ公表されていないため、今の料率で計算しています。'
        : '2027年度の保険料率（健康保険・子ども・子育て支援金・雇用保険）はまだ公表されていないため、2026年度の料率で計算しています。'
    ].concat(s.assumed, ['協会けんぽ・独身・扶養なしで、残業代とボーナスは入れていません。']);
    assumeNote.textContent = notes.join('');
  }

  const DETAIL_ROWS = [
    ['gross', '総支給'],
    ['health', '健康保険'],
    ['pension', '厚生年金'],
    ['employment', '雇用保険'],
    ['tax', '所得税'],
    ['resident', '住民税'],
    ['deductions', '引かれる額'],
    ['net', '手取り']
  ];
  function renderDetail(s) {
    const Y = s.input.year;
    const heads = ['', Y + '年4月', '5〜12月', (Y + 1) + '年1〜5月', '6月', '7月から'];
    detailHead.replaceChildren(h('tr', null, heads.map(t => h('th', { scope: 'col', text: t }))));
    detailBody.replaceChildren(...DETAIL_ROWS.map(([key, label]) => h('tr', { class: key === 'net' ? 'is-main' : null },
      h('th', { scope: 'row', class: 'nowrap', text: label }),
      s.rows.map(r => h('td', { class: 'cell-num', text: yen(r[key]) }))
    )));
    detailNote.textContent = (s.refund > 0 ? '12月（または1月）は、このほかに年末調整で' + yen(s.refund) + '戻ります。' : '') +
      '総支給は、月給と通勤手当の合計です。健康保険には、子ども・子育て支援金を含みます。';

    const list = TK.byPrefecture(s.input);
    const top = list[0];
    const bottom = list[list.length - 1];
    const mine = list.find(r => r.code === s.input.prefCode);
    prefNote.replaceChildren(
      '同じ給料でも、5月からの手取りは、健康保険料率が一番低い' + top.name + 'で' + yen(top.net) + '、一番高い' + bottom.name + 'で' + yen(bottom.net) + 'です。' +
      mine.name + 'は47都道府県で' + mine.rank + '位です。',
      h('a', { href: '#pref', text: '都道府県の表を見る' })
    );
  }

  // ---- 計算 ----
  function calculate(scroll) {
    const s = readForm();
    const n = TK.normalizeInput(s);
    const errors = TK.validate(n);
    if (errors.length) {
      errorBox.replaceChildren(...errors.map(t => h('span', { class: 'error-line', text: t })));
      errorBox.hidden = false;
      return false;
    }
    errorBox.hidden = true;
    const result = TK.simulate(n);
    current = n;
    renderSummary(result);
    renderWhy(result);
    renderDetail(result);
    resultSection.hidden = false;
    shareBox.hidden = true;
    save(s);
    updateUrl(n);
    if (scroll) resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  form.addEventListener('submit', ev => {
    ev.preventDefault();
    calculate(true);
  });

  shareBtn.addEventListener('click', async () => {
    if (!current) return;
    const url = baseUrl() + '?' + toParams(current).toString();
    shareInput.value = url;
    shareBox.hidden = false;
    try {
      await navigator.clipboard.writeText(url);
      shareStatus.textContent = 'リンクをコピーしました。開くと同じ結果が表示されます。';
    } catch (err) {
      shareInput.focus();
      shareInput.select();
      shareStatus.textContent = 'リンクを選択しました。コピーして共有してください。';
    }
  });

  // ---- 起動時: URL のパラメータ → 前回の入力 の順で復元 ----
  const initial = fromParams(location.search) || load();
  if (initial && typeof initial === 'object') {
    writeForm(initial);
    if (initial.pay) calculate(false);
  }
})();
