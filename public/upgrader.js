/* SICO Upgrader — ставка слева, желаемая сумма справа, шанс в центре колеса.
   Все броски делает сервер (/api/upgrader/play). Клиент только рисует и анимирует.
   Математика шанса должна совпадать с сервером: bp = floor(amount * 9500 / target). */
(function () {
  const RTP_BP = 9500, MIN_BP = 100, MAX_BP = 9000, MAX_AMOUNT = 100000, MAX_PAYOUT = 5000000;
  const R = 128, CIRC = 2 * Math.PI * R, CX = 160;
  const U = window.upg = { amount: 100, target: 200, mult: 2, busy: false, angle: 0, last: [], init: false };

  const num = n => Number(n || 0).toLocaleString();
  const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));
  const digits = s => String(s || '').replace(/\D/g, '').slice(0, 9);
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = id => document.getElementById(id);

  /* ── Источники ставки. Сейчас только баланс; «Предметы» подключим позже без перестройки экрана. ── */
  const SOURCES = [
    { key: 'balance', label: 'Баланс', enabled: true },
    { key: 'items', label: 'Предметы', enabled: false, note: 'скоро' }
  ];

  /* ── расчёт ── */
  function info() {
    const amount = U.amount, target = U.target;
    const bp = target > 0 ? Math.floor(amount * RTP_BP / target) : 0;
    let msg = '';
    if (amount < 1 || amount > MAX_AMOUNT) msg = 'Ставка: от 1 до 100 000 SC';
    else if (amount > me.balance) msg = 'Недостаточно SC';
    else if (target <= amount) msg = 'Желаемая сумма должна быть больше ставки';
    else if (target > MAX_PAYOUT) msg = 'Максимальный выигрыш — 5 000 000 SC';
    else if (bp < MIN_BP) msg = 'Шанс меньше 1% — уменьши желаемую сумму';
    else if (bp > MAX_BP) msg = 'Шанс не больше 90% — подними желаемую сумму';
    return { bp, chance: bp / 100, mult: amount ? target / amount : 0, profit: target - amount, msg };
  }

  function setAmount(v) { U.amount = clampInt(v, 0, 999999999); U.target = Math.max(U.amount + 1, Math.round(U.amount * U.mult)); }
  function setTarget(v) { U.target = clampInt(v, 0, 999999999); U.mult = U.target / Math.max(1, U.amount); }
  function setMult(m) { U.mult = m; U.target = Math.max(U.amount + 1, Math.round(U.amount * m)); }
  function setChance(c) { U.target = Math.max(U.amount + 1, Math.ceil(U.amount * RTP_BP / (c * 100))); U.mult = U.target / Math.max(1, U.amount); }

  /* ── обновление интерфейса без перерисовки (чтобы поля не теряли фокус) ── */
  function update(opts = {}) {
    if (!el('upg')) return;
    const i = info(), active = document.activeElement;
    if (active !== el('upgAmount')) el('upgAmount').value = U.amount ? num(U.amount) : '';
    if (active !== el('upgTarget')) el('upgTarget').value = U.target ? num(U.target) : '';
    const bp = Math.max(0, Math.min(10000, i.bp));
    const dash = `${(CIRC * bp / 10000).toFixed(2)} ${CIRC.toFixed(2)}`;
    el('upgWin').setAttribute('stroke-dasharray', dash);
    el('upgWinGlow').setAttribute('stroke-dasharray', dash);
    el('upgAmount').readOnly = el('upgTarget').readOnly = U.busy;
    el('upgSlider').disabled = U.busy;
    el('upgPct').textContent = i.chance.toFixed(i.chance >= 10 ? 1 : 2) + '%';
    el('upgMult').textContent = '×' + (i.mult >= 100 ? i.mult.toFixed(0) : i.mult.toFixed(2));
    el('upgProfit').textContent = (i.profit > 0 ? '+' : '') + num(i.profit) + ' SC';
    el('upgChanceStat').textContent = i.chance.toFixed(2) + '%';
    el('upgMultStat').textContent = '×' + i.mult.toFixed(2);
    el('upgAvail').textContent = num(me.balance) + ' SC';
    const sl = el('upgSlider');
    if (active !== sl) sl.value = Math.max(1, Math.min(90, i.chance || 1));
    sl.style.setProperty('--p', ((Math.max(1, Math.min(90, i.chance || 1)) - 1) / 89 * 100) + '%');
    document.querySelectorAll('[data-mult]').forEach(b => b.classList.toggle('on', Math.abs(U.mult - Number(b.dataset.mult)) < 0.0005));
    const btn = el('upgGo'), hint = el('upgHint');
    btn.disabled = U.busy || !!i.msg;
    hint.textContent = U.busy ? 'Крутим…' : i.msg || `Выигрыш ${num(U.target)} SC, шанс ${i.chance.toFixed(2)}%`;
    hint.classList.toggle('bad', !U.busy && !!i.msg);
    if (!opts.keepResult) clearResult();
  }

  function clearResult() {
    const w = el('upgWheel'); if (!w || U.busy) return;
    w.classList.remove('win', 'lose');
    el('upgCenter').classList.remove('res', 'win', 'lose');
  }

  /* ── анимация ── */
  function setNeedle(a) { el('upgNeedle')?.setAttribute('transform', `rotate(${a} ${CX} ${CX})`); }

  function spinTo(finalDeg) {
    return new Promise(done => {
      const start = U.angle % 360, dur = reduced() ? 900 : 5400;
      const dist = ((finalDeg - start) % 360 + 360) % 360 + 360 * (reduced() ? 1 : 6);
      const t0 = performance.now();
      let lastTick = Math.floor(start / 9), lastSnd = 0;
      const ease = t => 1 - Math.pow(1 - t, 4);
      function frame(now) {
        const t = Math.min(1, (now - t0) / dur), a = start + dist * ease(t);
        U.angle = a % 360; setNeedle(a);
        const k = Math.floor(a / 9);
        if (k !== lastTick) { lastTick = k; if (now - lastSnd > 55) { lastSnd = now; sicoSound('spin'); } }
        if (t < 1) requestAnimationFrame(frame); else done();
      }
      requestAnimationFrame(frame);
    });
  }

  function burst() {
    const w = el('upgWheel'); if (!w || reduced()) return;
    for (let n = 0; n < 30; n++) {
      const s = document.createElement('i');
      s.className = 'upg-spark';
      s.style.setProperty('--a', (n / 30 * 360 + Math.random() * 12) + 'deg');
      s.style.setProperty('--d', (90 + Math.random() * 110) + 'px');
      s.style.setProperty('--s', (3 + Math.random() * 4) + 'px');
      s.style.animationDelay = (Math.random() * 90) + 'ms';
      w.appendChild(s);
      setTimeout(() => s.remove(), 1300);
    }
  }

  function showResult(d) {
    const w = el('upgWheel'), c = el('upgCenter');
    if (!w || !c) return;
    w.classList.add(d.win ? 'win' : 'lose');
    c.classList.add('res', d.win ? 'win' : 'lose');
    el('upgResTitle').textContent = d.win ? 'Апгрейд!' : 'Не вышло';
    el('upgResVal').textContent = d.win ? '+' + num(d.payout) + ' SC' : '−' + num(d.amount) + ' SC';
    if (d.win) burst();
    sicoSound(d.win ? 'win' : 'lose');
    U.last.unshift({ win: d.win, chance: d.chance });
    U.last = U.last.slice(0, 14);
    renderLast();
  }

  function renderLast() {
    const box = el('upgLast'); if (!box) return;
    box.innerHTML = U.last.length
      ? U.last.map(x => `<i class="${x.win ? 'w' : 'l'}" title="${x.chance}%"></i>`).join('')
      : '<span class="muted">Пока пусто</span>';
  }

  async function play() {
    if (U.busy) return;
    const i = info();
    if (i.msg) { toast(i.msg); sicoSound('error'); return; }
    U.busy = true; window.upgHold = true;           // не показываем новый баланс до конца анимации
    el('upgWheel').classList.remove('win', 'lose');
    el('upgCenter').classList.remove('res', 'win', 'lose');
    el('upgWheel').classList.add('spinning');
    update({ keepResult: true });
    sicoSound('bet');
    try {
      const d = await api('/api/upgrader/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': rid() },
        body: JSON.stringify({ amount: U.amount, target: U.target })
      });
      me = d.user;
      await spinTo(d.roll / 10000 * 360);
      showResult(d);
    } catch (e) { toast(e.message); sicoSound('error'); }
    finally {
      U.busy = false; window.upgHold = false;
      const b = document.querySelector('.balance'); if (b) b.textContent = '◉ ' + Number(me.balance).toLocaleString() + ' SC';
      el('upgWheel')?.classList.remove('spinning');
      if (el('upg')) { update({ keepResult: true }); loadFeed(); }
    }
  }

  async function loadFeed() {
    try {
      const d = await api('/api/upgrader/feed');
      const box = el('upgFeed'); if (!box) return;
      box.innerHTML = d.rows.length ? d.rows.map(r => `<div class="upg-row ${r.win ? 'w' : 'l'}"><b>${esc(r.login)}</b><span>${num(r.amount)} → ${num(r.target)} SC</span><em>${r.chance}%</em><strong>${r.win ? '✓ +' + num(r.target - r.amount) : '✕ −' + num(r.amount)}</strong></div>`).join('') : '<p class="muted">Пока никто не апгрейдился — будь первым.</p>';
    } catch { }
  }

  /* ── экран ── */
  function view() {
    if (!U.init) { U.amount = Math.max(1, Math.min(100, me.balance)); U.target = Math.max(U.amount + 1, Math.round(U.amount * U.mult)); U.init = true; }
    const ticks = `<circle cx="${CX}" cy="${CX}" r="152" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="7" stroke-dasharray="1.6 ${(2 * Math.PI * 152 / 72 - 1.6).toFixed(3)}"/>`;
    shell(`
<section class="upg" id="upg">
  <div class="card upg-card">
    <div class="upg-tabs">${SOURCES.map(s => `<button class="${s.key === 'balance' ? 'on' : ''}" ${s.enabled ? '' : 'disabled title="Появится позже"'}>${s.label}${s.note ? `<em>${s.note}</em>` : ''}</button>`).join('')}</div>
    <div class="upg-label">Моя ставка</div>
    <div class="upg-input"><input id="upgAmount" inputmode="numeric" autocomplete="off" aria-label="Ставка"><b>SC</b></div>
    <div class="upg-chips" id="upgAmtChips">
      <button data-a="10">10</button><button data-a="100">100</button><button data-a="1000">1 000</button>
      <button data-a="half">½</button><button data-a="x2">×2</button><button data-a="max">Макс</button>
    </div>
    <div class="upg-avail"><span>Доступно</span><b id="upgAvail">—</b></div>
    <div class="upg-last-wrap"><span>Мои последние</span><div class="upg-last" id="upgLast"></div></div>
  </div>

  <div class="upg-center">
    <div class="upg-wheel" id="upgWheel">
      <svg viewBox="-20 -20 360 360" aria-label="Колесо апгрейда">
        <defs>
          <linearGradient id="upgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset=".55" stop-color="#ff9a1f"/><stop offset="1" stop-color="#ff4b3e"/></linearGradient>
          <radialGradient id="upgCore" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#1d2028"/><stop offset="1" stop-color="#0d0f14"/></radialGradient>
          <filter id="upgGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
        </defs>
        ${ticks}
        <circle cx="${CX}" cy="${CX}" r="${R}" fill="url(#upgCore)" stroke="rgba(255,255,255,.07)" stroke-width="18"/>
        <circle cx="${CX}" cy="${CX}" r="${R}" fill="none" stroke="rgba(255,75,62,.22)" stroke-width="18"/>
        <g transform="rotate(-90 ${CX} ${CX})">
          <circle class="upg-glow" cx="${CX}" cy="${CX}" r="${R}" fill="none" stroke="#ffb02e" stroke-width="18" opacity=".0" filter="url(#upgGlow)" id="upgWinGlow" stroke-dasharray="0 ${CIRC}"/>
          <circle id="upgWin" cx="${CX}" cy="${CX}" r="${R}" fill="none" stroke="url(#upgGrad)" stroke-width="18" stroke-dasharray="0 ${CIRC.toFixed(2)}"/>
        </g>
        <circle cx="${CX}" cy="${CX}" r="104" fill="none" stroke="rgba(255,255,255,.06)"/>
        <g id="upgNeedle" transform="rotate(0 ${CX} ${CX})">
          <path d="M${CX - 9} 2 L${CX + 9} 2 L${CX} 30 Z" fill="#fff"/>
          <rect x="${CX - 1.5}" y="26" width="3" height="34" rx="1.5" fill="#fff" opacity=".9"/>
        </g>
      </svg>
      <div class="upg-centertext" id="upgCenter">
        <div class="upg-idle"><div class="upg-pct" id="upgPct">—</div><div class="upg-sub">шанс</div><div class="upg-mult" id="upgMult">×2.00</div></div>
        <div class="upg-resbox"><div class="upg-restitle" id="upgResTitle"></div><div class="upg-resval" id="upgResVal"></div></div>
      </div>
    </div>
    <button class="upg-go" id="upgGo">Прокачать</button>
    <div class="upg-hint" id="upgHint"></div>
  </div>

  <div class="card upg-card">
    <div class="upg-tabs"><button class="on">Желаемая сумма</button></div>
    <div class="upg-label">Хочу получить</div>
    <div class="upg-input"><input id="upgTarget" inputmode="numeric" autocomplete="off" aria-label="Желаемая сумма"><b>SC</b></div>
    <div class="upg-chips" id="upgMultChips">
      ${[1.5, 2, 3, 5, 10, 25].map(m => `<button data-mult="${m}">×${m}</button>`).join('')}
    </div>
    <div class="upg-slider-wrap">
      <div class="upg-slider-head"><span>Шанс</span><b id="upgChanceStat">—</b></div>
      <input type="range" id="upgSlider" min="1" max="90" step="0.5" aria-label="Шанс успеха">
      <div class="upg-slider-scale"><span>1%</span><span>×95</span><span>90%</span></div>
    </div>
    <div class="upg-stats">
      <div><span>Множитель</span><b id="upgMultStat">—</b></div>
      <div><span>Прибыль</span><b id="upgProfit" class="positive">—</b></div>
    </div>
  </div>
</section>

<section class="card upg-feed-card">
  <div class="section-head"><div><div class="eyebrow">LIVE FEED</div><h3>Последние апгрейды</h3></div><span class="muted">Шанс = ставка ÷ цель × 95%</span></div>
  <div class="upg-feed" id="upgFeed"><p class="muted">Загрузка…</p></div>
</section>

<section class="card crystal-card" id="upgCrystals">
  <div class="section-head"><div><div class="eyebrow">INVENTORY · ITEMS</div><h3>Кристаллы</h3><p class="muted">Покупай, продавай или объединяй 3 одинаковых кристалла в следующий уровень.</p></div><div class="crystal-balance" id="crystalBalance">— SC</div></div>
  <div class="crystal-shop"><div class="crystal-shop-copy"><b>Обычный кристалл</b><span>Common · продажа за 100 SC</span></div><button class="crystal-buy" id="crystalBuy">Купить за 150 SC</button></div>
  <div class="crystal-grid" id="crystalGrid"><p class="muted">Загрузка кристаллов…</p></div>
  <div class="crystal-note">Улучшение гарантированное: 3 одинаковых → 1 следующей редкости. Mythic — максимальный уровень.</div>
</section>

<section class="card item-market-card" id="itemMarket">
  <div class="section-head"><div><div class="eyebrow">PLAYER MARKET · 06</div><h3>🛒 Маркетплейс предметов</h3><p class="muted">Выставляй кристаллы и артефакты за свою цену или покупай предметы у других игроков.</p></div><div class="market-fee-pill">Комиссия 5%</div></div>
  <div class="item-market-columns"><div><h4>Предметы для продажи</h4><div id="marketSellInventory" class="item-list"><p class="muted">Загрузка инвентаря…</p></div><h4 class="item-subhead">Мои объявления</h4><div id="marketMine" class="item-list"><p class="muted">Загрузка…</p></div></div><div><h4>Объявления игроков</h4><div id="marketListings" class="item-list"><p class="muted">Загрузка рынка…</p></div></div></div>
  <div class="crystal-note">При продаже предмета через рынок продавец получает 95% цены. Выставленный предмет временно хранится в объявлении и возвращается, если отменить его.</div>
</section>

<section class="card item-craft-card" id="itemCrafting">
  <div class="section-head"><div><div class="eyebrow">CRAFTING · 07</div><h3>⚒️ Крафт артефактов</h3><p class="muted">Обменивай кристаллы разных редкостей на уникальные предметы. Артефакты можно выставлять на маркетплейс.</p></div></div>
  <div id="craftRecipes" class="craft-grid"><p class="muted">Загрузка рецептов…</p></div>
  <h4 class="item-subhead">Мои артефакты</h4><div id="craftArtifacts" class="item-list"><p class="muted">Загрузка коллекции…</p></div>
</section>`, 'Upgrader', 'NEW GAME');

    setNeedle(U.angle);
    bind(); renderLast(); update(); loadFeed(); loadCrystals(); bindCrystals(); loadItemMarket(); loadCrafting(); bindItemSystems();
  }

  function bind() {
    const amt = el('upgAmount'), tgt = el('upgTarget'), sl = el('upgSlider');
    amt.addEventListener('input', () => { const v = digits(amt.value); amt.value = v ? num(v) : ''; setAmount(v); update(); });
    tgt.addEventListener('input', () => { const v = digits(tgt.value); tgt.value = v ? num(v) : ''; setTarget(v); update(); });
    amt.addEventListener('blur', update); tgt.addEventListener('blur', update);
    [amt, tgt].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { i.blur(); play(); } }));
    sl.addEventListener('input', () => { setChance(Number(sl.value)); update(); });
    el('upgAmtChips').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || U.busy) return; sicoSound('click');
      const a = b.dataset.a;
      if (a === 'half') setAmount(Math.max(1, Math.floor(U.amount / 2)));
      else if (a === 'x2') setAmount(Math.min(MAX_AMOUNT, U.amount * 2));
      else if (a === 'max') setAmount(Math.max(1, Math.min(MAX_AMOUNT, me.balance)));
      else setAmount(Number(a));
      update();
    });
    el('upgMultChips').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || U.busy) return; sicoSound('click');
      setMult(Number(b.dataset.mult)); update();
    });
    el('upgGo').addEventListener('click', play);
  }

  let crystalRows = [];
  const crystalOrder = ['common','rare','epic','legendary','mythic'];
  const crystalMeta = {
    common:{name:'Common',icon:'💠',color:'#62d9ff',sell:100},
    rare:{name:'Rare',icon:'💚',color:'#55e6a5',sell:300},
    epic:{name:'Epic',icon:'🔮',color:'#bb83ff',sell:900},
    legendary:{name:'Legendary',icon:'💛',color:'#ffc857',sell:2700},
    mythic:{name:'Mythic',icon:'❤️',color:'#ff6584',sell:8100}
  };
  async function loadCrystals(){
    const box=el('crystalGrid'); if(!box)return;
    try{const d=await api('/api/upgrader/crystals');crystalRows=d.crystals||[];if(me&&Number.isFinite(Number(d.balance)))me.balance=Number(d.balance);renderCrystals(d.balance)}
    catch(e){box.innerHTML=`<p class="muted">Не удалось загрузить кристаллы: ${esc(e.message)}</p>`}
  }
  function renderCrystals(balance=me.balance){
    const box=el('crystalGrid');if(!box)return;
    el('crystalBalance').textContent=num(balance)+' SC';
    const counts=Object.fromEntries(crystalOrder.map(r=>[r,crystalRows.filter(c=>c.rarity===r).length]));
    box.innerHTML=crystalOrder.map((r,idx)=>{
      const m=crystalMeta[r],items=crystalRows.filter(c=>c.rarity===r),canUpgrade=idx<crystalOrder.length-1&&items.length>=3;
      return `<article class="crystal-item" style="--crystal:${m.color}"><div class="crystal-gem">${m.icon}</div><div class="crystal-info"><b>${m.name}</b><span>${counts[r]} шт. · продажа ${num(m.sell)} SC</span></div><div class="crystal-actions">${items.length?`<button data-crystal-sell="${items[0].id}">Продать</button>`:''}${idx<crystalOrder.length-1?`<button data-crystal-upgrade="${r}" ${canUpgrade?'':'disabled'}>Улучшить ${counts[r]}/3</button>`:'<span class="crystal-max">MAX</span>'}</div></article>`;
    }).join('');
    if(!crystalRows.length)box.innerHTML='<div class="crystal-empty">💎<b>Пока нет кристаллов</b><span>Купи первый кристалл и начни собирать коллекцию.</span></div>';
    const b=document.querySelector('.balance');if(b)b.textContent='◉ '+num(me.balance)+' SC';
  }
  function bindCrystals(){
    const buy=el('crystalBuy');if(!buy||buy.dataset.bound)return;buy.dataset.bound='1';
    buy.addEventListener('click',async()=>{if(U.busy)return;buy.disabled=true;try{const d=await api('/api/upgrader/crystals/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});me=d.user;if(me&&Number.isFinite(Number(d.balance)))me.balance=Number(d.balance);crystalRows=d.crystals;renderCrystals(me.balance);toast('Кристалл добавлен в инвентарь');sicoSound('win')}catch(e){toast(e.message);sicoSound('error')}finally{buy.disabled=false}});
    const box=el('crystalGrid');box.addEventListener('click',async e=>{
      const sell=e.target.closest('[data-crystal-sell]'),upgrade=e.target.closest('[data-crystal-upgrade]');if(!sell&&!upgrade)return;
      const action=sell?'Продать этот кристалл?':'Объединить 3 кристалла в следующий уровень?';if(!confirm(action))return;
      const buttons=box.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
      try{const endpoint=sell?'/api/upgrader/crystals/sell':'/api/upgrader/crystals/upgrade';const body=sell?{crystalId:sell.dataset.crystalSell}:{rarity:upgrade.dataset.crystalUpgrade};const d=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});me=d.user;if(me&&Number.isFinite(Number(d.balance)))me.balance=Number(d.balance);crystalRows=d.crystals;renderCrystals(me.balance);toast(sell?`Продано за ${num(d.price)} SC · баланс ${num(me.balance)} SC`:'Кристалл улучшен!');sicoSound('win')}
      catch(err){toast(err.message);sicoSound('error');buttons.forEach(b=>b.disabled=false)}
    });
  }

  let marketData = {listings:[],mine:[],crystals:[],artifacts:[]};
  let craftData = {recipes:[],crystals:[],artifacts:[]};
  const rarityColor = r => ({Common:'#62d9ff',Rare:'#55e6a5',Epic:'#bb83ff',Legendary:'#ffc857',Mythic:'#ff6584',common:'#62d9ff',rare:'#55e6a5',epic:'#bb83ff',legendary:'#ffc857',mythic:'#ff6584'}[r]||'#b9c0d0');
  const itemTitle = item => item?.name || item?.label || 'Предмет';
  const itemIcon = item => item?.icon || '💎';
  const itemRarity = item => item?.label || item?.rarity || 'Предмет';
  async function loadItemMarket(){
    if(!el('itemMarket'))return;
    try{marketData=await api('/api/items/market');if(me&&Number.isFinite(Number(marketData.balance)))me.balance=Number(marketData.balance);renderItemMarket();}
    catch(e){el('marketListings').innerHTML=`<p class="muted">Не удалось загрузить рынок: ${esc(e.message)}</p>`;}
  }
  function renderItemMarket(){
    const inv=el('marketSellInventory'),list=el('marketListings'),mine=el('marketMine');if(!inv||!list||!mine)return;
    const items=[...(marketData.crystals||[]).map(x=>({...x,kind:'crystal'})),...(marketData.artifacts||[]).map(x=>({...x,kind:'artifact'}))];
    inv.innerHTML=items.length?items.map(x=>`<div class="market-item-row"><span class="market-item-icon" style="--item-color:${rarityColor(x.label||x.rarity)}">${itemIcon(x)}</span><span class="market-item-main"><b>${esc(itemTitle(x))}</b><small>${esc(itemRarity(x))}</small></span><button class="item-action" data-market-list="${x.kind}" data-item-id="${esc(x.id)}">Выставить</button></div>`).join(''):'<div class="item-empty">Нет свободных предметов. Создай артефакт или купи кристалл.</div>';
    list.innerHTML=(marketData.listings||[]).length?marketData.listings.map(x=>`<div class="market-item-row"><span class="market-item-icon" style="--item-color:${rarityColor(x.item?.label||x.item?.rarity)}">${itemIcon(x.item)}</span><span class="market-item-main"><b>${esc(itemTitle(x.item))}</b><small>${esc(itemRarity(x.item))} · от ${esc(x.sellerLogin)}</small><strong>${num(x.price)} SC</strong></span><button class="item-action primary" data-market-buy="${esc(x.id)}">Купить</button></div>`).join(''):'<div class="item-empty">Пока нет объявлений. Выставь первый предмет!</div>';
    mine.innerHTML=(marketData.mine||[]).length?marketData.mine.map(x=>`<div class="market-item-row"><span class="market-item-icon" style="--item-color:${rarityColor(x.item?.label||x.item?.rarity)}">${itemIcon(x.item)}</span><span class="market-item-main"><b>${esc(itemTitle(x.item))}</b><small>${num(x.price)} SC · ожидает покупателя</small></span><button class="item-action" data-market-cancel="${esc(x.id)}">Снять</button></div>`).join(''):'<div class="item-empty">У тебя пока нет активных объявлений.</div>';
  }
  async function loadCrafting(){
    if(!el('itemCrafting'))return;
    try{craftData=await api('/api/items/crafting');if(me&&Number.isFinite(Number(craftData.balance)))me.balance=Number(craftData.balance);renderCrafting();}
    catch(e){el('craftRecipes').innerHTML=`<p class="muted">Не удалось загрузить крафт: ${esc(e.message)}</p>`;}
  }
  function renderCrafting(){
    const recipes=el('craftRecipes'),artifacts=el('craftArtifacts');if(!recipes||!artifacts)return;
    const counts=Object.fromEntries(crystalOrder.map(r=>[r,(craftData.crystals||[]).filter(c=>c.rarity===r).length]));
    recipes.innerHTML=(craftData.recipes||[]).map(r=>{const mats=Object.entries(r.materials).map(([rarity,count])=>`${count} × ${rarity} (${counts[rarity]||0}/${count})`).join(' + ');const enough=Object.entries(r.materials).every(([rarity,count])=>(counts[rarity]||0)>=count);return `<article class="craft-recipe" style="--item-color:${rarityColor(r.rarity)}"><div class="craft-icon">${r.icon}</div><div class="craft-main"><div class="craft-rarity">${esc(r.rarity)}</div><h4>${esc(r.name)}</h4><p>${esc(r.desc)}</p><small>Материалы: ${esc(mats)}</small></div><button class="item-action primary" data-craft="${esc(r.id)}" ${enough?'':'disabled'}>Создать</button></article>`;}).join('');
    artifacts.innerHTML=(craftData.artifacts||[]).length?craftData.artifacts.map(a=>`<div class="market-item-row"><span class="market-item-icon" style="--item-color:${rarityColor(a.rarity)}">${itemIcon(a)}</span><span class="market-item-main"><b>${esc(a.name)}</b><small>${esc(a.rarity)} · ${esc(a.desc||'Артефакт')}</small></span><button class="item-action" data-market-list="artifact" data-item-id="${esc(a.id)}">Выставить</button></div>`).join(''):'<div class="item-empty">Артефактов пока нет. Создай первый по рецепту выше.</div>';
  }
  function bindItemSystems(){
    const market=el('itemMarket'),craft=el('itemCrafting');if(!market||market.dataset.bound)return;market.dataset.bound='1';craft.dataset.bound='1';
    market.addEventListener('click',async e=>{
      const list=e.target.closest('[data-market-list]'),buy=e.target.closest('[data-market-buy]'),cancel=e.target.closest('[data-market-cancel]');if(!list&&!buy&&!cancel)return;
      try{
        if(list){const price=Number(prompt('За сколько SC выставить предмет?','500'));if(!Number.isSafeInteger(price)||price<1||price>1000000){toast('Укажи цену от 1 до 1 000 000 SC');return;}await api('/api/items/market/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:list.dataset.marketList,itemId:list.dataset.itemId,price})});toast('Предмет выставлен на маркетплейс');}
        else if(buy){const target=(marketData.listings||[]).find(x=>x.id===buy.dataset.marketBuy);if(!target||!confirm(`Купить ${itemTitle(target.item)} за ${num(target.price)} SC?`))return;const d=await api('/api/items/market/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId:target.id})});if(d.user)me=d.user;toast(`Покупка успешна · списано ${num(d.price)} SC`);}
        else if(cancel){if(!confirm('Снять объявление и вернуть предмет в инвентарь?'))return;await api('/api/items/market/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listingId:cancel.dataset.marketCancel})});toast('Объявление снято, предмет возвращён');}
        await Promise.all([loadItemMarket(),loadCrafting(),loadCrystals()]);
      }catch(err){toast(err.message);sicoSound('error');}
    });
    craft.addEventListener('click',async e=>{const b=e.target.closest('[data-craft]');if(!b)return;if(!confirm('Создать артефакт? Использованные кристаллы будут потрачены.'))return;b.disabled=true;try{const d=await api('/api/items/crafting/craft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipeId:b.dataset.craft})});if(d.artifacts)craftData.artifacts=d.artifacts;if(d.crystals)craftData.crystals=d.crystals;crystalRows=d.crystals||crystalRows;renderCrafting();renderCrystals(d.balance??me.balance);toast(`Создан артефакт: ${d.artifact.name}`);sicoSound('win');await loadItemMarket();}catch(err){toast(err.message);sicoSound('error');b.disabled=false;}}
    );
  }

  window.upgraderView = view;
})();
