// Hardcoded Delta Exchange-style system values for BTC option selling.
const CONFIG = Object.freeze({
  btcPrice: 100000,
  lotSizeBtc: 0.001,
  makerFeeRate: 0.0001,
  premiumCapRate: 0.035,
  gstRate: 0.18,
  targetRoi: 0.05,
});

const elements = {
  form: document.getElementById('calculatorForm'),
  sellingPrice: document.getElementById('sellingPrice'),
  buyingPrice: document.getElementById('buyingPrice'),
  lots: document.getElementById('lots'),
  leverage: document.getElementById('leverage'),
  resetBtn: document.getElementById('resetBtn'),
  copyBtn: document.getElementById('copyBtn'),
  statusMessage: document.getElementById('statusMessage'),
  roiBadge: document.getElementById('roiBadge'),
  grossProfit: document.getElementById('grossProfit'),
  entryFee: document.getElementById('entryFee'),
  exitFee: document.getElementById('exitFee'),
  totalCharges: document.getElementById('totalCharges'),
  netProfit: document.getElementById('netProfit'),
  marginUsed: document.getElementById('marginUsed'),
  roiPercent: document.getElementById('roiPercent'),
  targetBuyback: document.getElementById('targetBuyback'),
  entryLogic: document.getElementById('entryLogic'),
  exitLogic: document.getElementById('exitLogic'),
};

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

function parseValue(value) {
  const normalized = String(value ?? '').trim();
  if (normalized === '') {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const absolute = Math.abs(value);
  const digits = absolute >= 1000 ? 2 : 6;
  return formatter.format(Number(value.toFixed(digits)));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  return `${percentFormatter.format(value)}%`;
}

function getFeeBreakdown(price, lots) {
  // The fee model is fixed: standard fee vs premium cap, then GST is added.
  const notionalValue = lots * CONFIG.lotSizeBtc * CONFIG.btcPrice;
  const standardTradingFee = notionalValue * CONFIG.makerFeeRate;
  const premiumCapFee = CONFIG.premiumCapRate * lots * CONFIG.lotSizeBtc * price;
  const effectiveFee = Math.min(standardTradingFee, premiumCapFee);
  const feeBeforeGst = effectiveFee;
  const finalFee = feeBeforeGst * (1 + CONFIG.gstRate);

  return {
    notionalValue,
    standardTradingFee,
    premiumCapFee,
    effectiveFee,
    finalFee,
    capThresholdPrice: CONFIG.btcPrice * CONFIG.makerFeeRate / CONFIG.premiumCapRate,
  };
}

function calculateTrade(sellingPrice, buyingPrice, lots, leverage) {
  const entry = getFeeBreakdown(sellingPrice, lots);
  const exit = buyingPrice == null ? null : getFeeBreakdown(buyingPrice, lots);

  const grossProfit = buyingPrice == null ? null : (sellingPrice - buyingPrice) * lots * CONFIG.lotSizeBtc;
  const entryFee = entry.finalFee;
  const exitFee = exit ? exit.finalFee : null;
  const totalCharges = exitFee == null ? null : entryFee + exitFee;
  const netProfit = grossProfit == null || totalCharges == null ? null : grossProfit - totalCharges;
  const marginUsed = entry.notionalValue / leverage;
  const roiPercent = netProfit == null ? null : (netProfit / marginUsed) * 100;

  return {
    grossProfit,
    entryFee,
    exitFee,
    totalCharges,
    netProfit,
    marginUsed,
    roiPercent,
    entry,
    exit,
  };
}

function netProfitForExitPrice(exitPrice, sellingPrice, lots, leverage) {
  const summary = calculateTrade(sellingPrice, exitPrice, lots, leverage);
  return summary.netProfit;
}

function solveTargetBuybackPrice(sellingPrice, lots, leverage) {
  const entry = getFeeBreakdown(sellingPrice, lots);
  const targetNetProfit = (entry.notionalValue / leverage) * CONFIG.targetRoi;
  const entryFee = entry.finalFee;
  const threshold = entry.capThresholdPrice;

  const solveRegionOne = () => {
    // When the exit premium stays below the cap threshold, the exit fee is linear.
    const numerator = 0.001 * sellingPrice - (entryFee / lots) - (targetNetProfit / lots);
    const denominator = 0.001 + 0.0000413;
    return numerator / denominator;
  };

  const solveRegionTwo = () => {
    // Above the cap threshold, the exit fee becomes a flat standard-fee amount.
    const numerator = 0.001 * sellingPrice - (entryFee / lots) - (targetNetProfit / lots) - 0.0118;
    return numerator / 0.001;
  };

  const regionOnePrice = solveRegionOne();
  if (Number.isFinite(regionOnePrice) && regionOnePrice >= 0 && regionOnePrice <= threshold) {
    return regionOnePrice;
  }

  const regionTwoPrice = solveRegionTwo();
  if (Number.isFinite(regionTwoPrice) && regionTwoPrice > threshold) {
    return regionTwoPrice;
  }

  const maxNetProfit = netProfitForExitPrice(0, sellingPrice, lots, leverage);
  if (maxNetProfit == null || maxNetProfit < targetNetProfit) {
    return null;
  }

  let low = 0;
  let high = Math.max(sellingPrice, threshold * 2, 1);
  let guard = 0;

  while (guard < 60) {
    const value = netProfitForExitPrice(high, sellingPrice, lots, leverage);
    if (value == null || value <= targetNetProfit) {
      break;
    }
    high *= 2;
    guard += 1;
  }

  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const net = netProfitForExitPrice(mid, sellingPrice, lots, leverage);

    if (net == null) {
      return null;
    }

    if (net > targetNetProfit) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

function setValue(element, value, options = {}) {
  element.textContent = value;
  element.classList.remove('positive', 'negative');

  if (options.state === 'positive') {
    element.classList.add('positive');
  }

  if (options.state === 'negative') {
    element.classList.add('negative');
  }
}

function updateUi() {
  const sellingPrice = parseValue(elements.sellingPrice.value);
  const buyingPrice = parseValue(elements.buyingPrice.value);
  const lots = parseValue(elements.lots.value);
  const leverage = parseValue(elements.leverage.value);

  const validInputs = sellingPrice != null && sellingPrice > 0 && lots != null && lots > 0 && leverage != null && leverage > 0;

  if (!validInputs) {
    setValue(elements.grossProfit, '--');
    setValue(elements.entryFee, '--');
    setValue(elements.exitFee, '--');
    setValue(elements.totalCharges, '--');
    setValue(elements.netProfit, '--');
    setValue(elements.marginUsed, '--');
    setValue(elements.roiPercent, '--');
    setValue(elements.targetBuyback, '--');
    elements.entryLogic.textContent = '--';
    elements.exitLogic.textContent = '--';
    elements.statusMessage.textContent = 'Enter selling price, lots, and leverage to calculate live results.';
    elements.roiBadge.textContent = 'Ready';
    elements.roiBadge.className = 'pill pill-positive';
    return;
  }

  const summary = calculateTrade(sellingPrice, buyingPrice, lots, leverage);
  const targetBuyback = solveTargetBuybackPrice(sellingPrice, lots, leverage);

  setValue(elements.grossProfit, summary.grossProfit == null ? 'Enter buyback price' : formatMoney(summary.grossProfit), {
    state: summary.grossProfit >= 0 ? 'positive' : 'negative',
  });
  setValue(elements.entryFee, formatMoney(summary.entryFee), { state: 'negative' });
  setValue(elements.exitFee, summary.exitFee == null ? 'Enter buyback price' : formatMoney(summary.exitFee), { state: 'negative' });
  setValue(elements.totalCharges, summary.totalCharges == null ? 'Enter buyback price' : formatMoney(summary.totalCharges), { state: 'negative' });
  setValue(elements.netProfit, summary.netProfit == null ? 'Enter buyback price' : formatMoney(summary.netProfit), {
    state: summary.netProfit >= 0 ? 'positive' : 'negative',
  });
  setValue(elements.marginUsed, formatMoney(summary.marginUsed));
  setValue(elements.roiPercent, summary.roiPercent == null ? 'Enter buyback price' : formatPercent(summary.roiPercent), {
    state: summary.roiPercent >= 0 ? 'positive' : 'negative',
  });
  setValue(elements.targetBuyback, targetBuyback == null ? 'Not achievable' : formatMoney(targetBuyback));

  elements.entryLogic.textContent = `Notional = ${formatMoney(summary.entry.notionalValue)} | Standard fee = ${formatMoney(summary.entry.standardTradingFee)} | Premium cap fee = ${formatMoney(summary.entry.premiumCapFee)} | Final fee after GST = ${formatMoney(summary.entry.finalFee)}`;

  if (buyingPrice == null) {
    elements.exitLogic.textContent = 'Buyback price is optional. Enter a buyback price to see the exit fee, total charges, net profit, and ROI.';
    elements.statusMessage.textContent = 'Target buyback solved from the live Delta fee model.';
    elements.roiBadge.textContent = targetBuyback == null ? 'Target unavailable' : 'Target ready';
    elements.roiBadge.className = targetBuyback == null ? 'pill' : 'pill pill-positive';
    return;
  }

  elements.exitLogic.textContent = `Notional = ${formatMoney(summary.exit.notionalValue)} | Standard fee = ${formatMoney(summary.exit.standardTradingFee)} | Premium cap fee = ${formatMoney(summary.exit.premiumCapFee)} | Final fee after GST = ${formatMoney(summary.exit.finalFee)}`;
  elements.statusMessage.textContent = 'Live trade results updated from your current inputs.';

  const positive = summary.netProfit != null && summary.netProfit >= 0;
  elements.roiBadge.textContent = positive ? 'Profit' : 'Loss';
  elements.roiBadge.className = positive ? 'pill pill-positive' : 'pill';
}

async function copyResults() {
  const lines = [
    'BTC Option Selling Net Profit Calculator',
    `Gross Profit: ${elements.grossProfit.textContent}`,
    `Entry Fee: ${elements.entryFee.textContent}`,
    `Exit Fee: ${elements.exitFee.textContent}`,
    `Total Charges: ${elements.totalCharges.textContent}`,
    `Net Profit: ${elements.netProfit.textContent}`,
    `Margin Used: ${elements.marginUsed.textContent}`,
    `ROI %: ${elements.roiPercent.textContent}`,
    `Exact Buyback Price for NET +5%: ${elements.targetBuyback.textContent}`,
  ];

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    elements.statusMessage.textContent = 'Results copied to clipboard.';
  } catch (error) {
    elements.statusMessage.textContent = 'Copy failed. Your browser may block clipboard access.';
  }
}

function resetCalculator() {
  elements.form.reset();
  updateUi();
}

elements.form.addEventListener('input', updateUi);
elements.resetBtn.addEventListener('click', resetCalculator);
elements.copyBtn.addEventListener('click', copyResults);

updateUi();