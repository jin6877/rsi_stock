const express = require('express');
const path = require('path');
const webpush = require('web-push');
const app = express();
const PORT = 9090;

// ─── VAPID 키 (웹 푸시) ───
const VAPID_PUBLIC = 'BO8ueEL63Yj9I3HHI-IlA1hGH3sV1eFIr-pWlfufKnLwCypC5wkS6PQQlEvUP1F9UcDOUBFJ-bDDY3ad2iazFPo';
const VAPID_PRIVATE = 'vFeyMgRduA7Qh-FulqSLygBZbU5RPrY0Sdc41BtY5RQ';
webpush.setVapidDetails('mailto:stock@local.dev', VAPID_PUBLIC, VAPID_PRIVATE);

// 푸시 구독 저장 (메모리 + 파일)
const SUBS_FILE = path.join(__dirname, 'push_subscriptions.json');
let pushSubscriptions = [];
try { pushSubscriptions = JSON.parse(require('fs').readFileSync(SUBS_FILE, 'utf8')); } catch {}
function saveSubs() { require('fs').writeFileSync(SUBS_FILE, JSON.stringify(pushSubscriptions, null, 2)); }

// ─── Yahoo Finance 데이터 fetch ───
async function fetchYahooData(ticker, period = '6mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${period}&interval=${interval}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Yahoo API ${res.status}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error('No data');
  const quotes = result.indicators?.quote?.[0];
  const timestamps = result.timestamp;
  if (!quotes || !timestamps || timestamps.length < 30) {
    throw new Error('INSUFFICIENT_DATA');
  }
  const name = koreanNameMap[ticker] || result.meta?.shortName || result.meta?.symbol || ticker;
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = quotes.open?.[i];
    const h = quotes.high?.[i];
    const l = quotes.low?.[i];
    const c = quotes.close?.[i];
    const v = quotes.volume?.[i];
    if (o != null && h != null && l != null && c != null) {
      candles.push({ time: timestamps[i] * 1000, open: o, high: h, low: l, close: c, volume: v || 0 });
    }
  }
  if (candles.length < 30) throw new Error('INSUFFICIENT_DATA');
  return { name, candles };
}

// ─── 한글 종목명 매핑 ───
const koreanNameMap = {};  // ticker -> 한글명

function parseKRXHtml(html, suffix) {
  const tickers = [];
  // <tr> 안에서 회사명과 종목코드 추출
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim());
    if (cells.length >= 2) {
      // 종목코드 찾기
      const codeCell = cells.find(c => /^\d{6}$/.test(c));
      if (codeCell) {
        const ticker = codeCell + suffix;
        tickers.push(ticker);
        // 첫 번째 셀이 보통 회사명 (코드가 아닌 셀)
        const nameCell = cells.find(c => c && !/^\d{6}$/.test(c) && !/^\d/.test(c) && c.length > 0);
        if (nameCell) {
          koreanNameMap[ticker] = nameCell;
        }
      }
    }
  }
  return tickers;
}

// ─── KRX 전체 종목 리스트 가져오기 ───
const iconv = require('iconv-lite');

async function fetchKRXHtmlDecoded(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buffer = Buffer.from(await res.arrayBuffer());
  return iconv.decode(buffer, 'euc-kr');
}

async function fetchKRXStockList() {
  const stocks = { kospi: [], kosdaq: [] };
  try {
    // 코스피
    const kospiHtml = await fetchKRXHtmlDecoded('http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=stockMkt');
    stocks.kospi = parseKRXHtml(kospiHtml, '.KS');
    if (stocks.kospi.length === 0) {
      const kospiMatches = [...kospiHtml.matchAll(/<td[^>]*>(\d{6})<\/td>/g)];
      for (const m of kospiMatches) {
        stocks.kospi.push(m[1] + '.KS');
      }
    }
    // 코스닥
    const kosdaqHtml = await fetchKRXHtmlDecoded('http://kind.krx.co.kr/corpgeneral/corpList.do?method=download&marketType=kosdaqMkt');
    stocks.kosdaq = parseKRXHtml(kosdaqHtml, '.KQ');
    if (stocks.kosdaq.length === 0) {
      const kosdaqMatches = [...kosdaqHtml.matchAll(/<td[^>]*>(\d{6})<\/td>/g)];
      for (const m of kosdaqMatches) {
        stocks.kosdaq.push(m[1] + '.KQ');
      }
    }
  } catch (e) {
    console.error('KRX 목록 로드 실패, 폴백 사용:', e.message);
  }

  // 폴백: KRX에서 못 가져오면 하드코딩 목록 사용
  if (stocks.kospi.length < 10) {
    stocks.kospi = [
      '005930.KS','000660.KS','035420.KS','005380.KS','035720.KS',
      '051910.KS','006400.KS','207940.KS','000270.KS','105560.KS',
      '005490.KS','055550.KS','003670.KS','006800.KS','034730.KS',
      '032830.KS','003550.KS','012330.KS','066570.KS','028260.KS',
      '009150.KS','017670.KS','030200.KS','033780.KS','018260.KS',
      '034020.KS','010130.KS','011200.KS','096770.KS','086790.KS',
      '010950.KS','036570.KS','015760.KS','003490.KS','024110.KS',
      '316140.KS','259960.KS','000720.KS','004020.KS','021240.KS',
      '004990.KS','009540.KS','010140.KS','011170.KS','016360.KS',
      '018880.KS','020150.KS','023530.KS','029780.KS','033920.KS',
      '034220.KS','036460.KS','042660.KS','047050.KS','047810.KS',
      '052690.KS','055660.KS','064350.KS','066970.KS','069500.KS',
      '071050.KS','078930.KS','086280.KS','088350.KS','090430.KS',
      '097950.KS','100250.KS','112610.KS','138040.KS','161390.KS',
      '180640.KS','241560.KS','251270.KS','267250.KS','271560.KS',
      '282330.KS','293480.KS','302440.KS','326030.KS','352820.KS',
      '361610.KS','373220.KS','383220.KS','402340.KS','450080.KS',
    ];
  }
  if (stocks.kosdaq.length < 10) {
    stocks.kosdaq = [
      '247540.KQ','196170.KQ','068270.KQ','035760.KQ','036930.KQ',
      '005290.KQ','041510.KQ','145020.KQ','112040.KQ','263750.KQ',
      '328130.KQ','357780.KQ','403870.KQ','377300.KQ','058470.KQ',
      '293490.KQ','086520.KQ','039030.KQ','095340.KQ','214150.KQ',
      '048410.KQ','060310.KQ','067160.KQ','078600.KQ','091990.KQ',
      '098460.KQ','108860.KQ','131970.KQ','137310.KQ','141080.KQ',
      '143240.KQ','178320.KQ','195990.KQ','214370.KQ','222160.KQ',
      '226330.KQ','237690.KQ','240810.KQ','253840.KQ','256840.KQ',
      '268600.KQ','278280.KQ','285130.KQ','298380.KQ','323410.KQ',
      '330860.KQ','336260.KQ','348210.KQ','352480.KQ','376300.KQ',
      '383310.KQ','389030.KQ','394280.KQ','399720.KQ','417310.KQ',
    ];
  }

  // 폴백 한글명 매핑 (KRX에서 못 가져온 경우)
  const fallbackNames = {
    '005930.KS':'삼성전자','000660.KS':'SK하이닉스','035420.KS':'NAVER','005380.KS':'현대차',
    '035720.KS':'카카오','051910.KS':'LG화학','006400.KS':'삼성SDI','207940.KS':'삼성바이오로직스',
    '000270.KS':'기아','105560.KS':'KB금융','005490.KS':'POSCO홀딩스','055550.KS':'신한지주',
    '003670.KS':'포스코퓨처엠','006800.KS':'미래에셋증권','034730.KS':'SK','032830.KS':'삼성생명',
    '003550.KS':'LG','012330.KS':'현대모비스','066570.KS':'LG전자','028260.KS':'삼성물산',
    '009150.KS':'삼성전기','017670.KS':'SK텔레콤','030200.KS':'KT','033780.KS':'KT&G',
    '018260.KS':'삼성에스디에스','034020.KS':'두산에너빌리티','010130.KS':'고려아연','011200.KS':'HMM',
    '096770.KS':'SK이노베이션','086790.KS':'하나금융지주','010950.KS':'S-Oil','036570.KS':'엔씨소프트',
    '015760.KS':'한국전력','003490.KS':'대한항공','024110.KS':'기업은행','316140.KS':'우리금융지주',
    '259960.KS':'크래프톤','000720.KS':'현대건설','004020.KS':'현대제철','021240.KS':'코웨이',
    '004990.KS':'롯데지주','009540.KS':'한국조선해양','010140.KS':'삼성중공업','011170.KS':'롯데케미칼',
    '016360.KS':'삼성증권','018880.KS':'한온시스템','020150.KS':'일진머티리얼즈','023530.KS':'롯데쇼핑',
    '029780.KS':'삼성카드','033920.KS':'무학','034220.KS':'LG디스플레이','036460.KS':'한국가스공사',
    '042660.KS':'한화오션','047050.KS':'포스코인터내셔널','047810.KS':'한국항공우주',
    '052690.KS':'한전기술','055660.KS':'한국단자','064350.KS':'현대로템','066970.KS':'엘앤에프',
    '069500.KS':'KODEX200','071050.KS':'한국금융지주','078930.KS':'GS','086280.KS':'현대글로비스',
    '088350.KS':'한화생명','090430.KS':'아모레퍼시픽','097950.KS':'CJ제일제당',
    '100250.KS':'삼성SDI우','112610.KS':'씨에스윈드','138040.KS':'메리츠금융지주',
    '161390.KS':'한국타이어앤테크놀로지','180640.KS':'한진칼','241560.KS':'두산밥캣',
    '251270.KS':'넷마블','267250.KS':'HD현대','271560.KS':'오리온','282330.KS':'BGF리테일',
    '293480.KS':'하이브','302440.KS':'SK바이오사이언스','326030.KS':'SK바이오팜',
    '352820.KS':'하이브','361610.KS':'SK아이이테크놀로지','373220.KS':'LG에너지솔루션',
    '383220.KS':'F&F','402340.KS':'SK스퀘어','450080.KS':'HLB',
    '247540.KQ':'에코프로비엠','196170.KQ':'알테오젠','068270.KQ':'셀트리온','035760.KQ':'CJ ENM',
    '036930.KQ':'주성엔지니어링','005290.KQ':'동진쎄미켐','041510.KQ':'에스엠','145020.KQ':'휴젤',
    '112040.KQ':'위메이드','263750.KQ':'펄어비스','328130.KQ':'루닛','357780.KQ':'솔브레인',
    '403870.KQ':'HPSP','377300.KQ':'카카오페이','058470.KQ':'리노공업',
    '293490.KQ':'카카오게임즈','086520.KQ':'에코프로','039030.KQ':'이오테크닉스',
    '095340.KQ':'ISC','214150.KQ':'클래시스','048410.KQ':'현대바이오','060310.KQ':'3S',
    '067160.KQ':'아프리카TV','078600.KQ':'대주전자재료','091990.KQ':'셀트리온헬스케어',
    '098460.KQ':'고영','108860.KQ':'셀바스AI','131970.KQ':'테스나','137310.KQ':'에스디바이오센서',
    '141080.KQ':'리가켐바이오','178320.KQ':'서진시스템','195990.KQ':'에이비프로바이오',
    '214370.KQ':'케어젠','222160.KQ':'NPX반도체','226330.KQ':'신테카바이오',
    '237690.KQ':'에스티팜','240810.KQ':'원익IPS','253840.KQ':'수젠텍','256840.KQ':'한국비엔씨',
    '268600.KQ':'셀리버리','278280.KQ':'천보','285130.KQ':'SK케미칼','298380.KQ':'에이비엘바이오',
    '323410.KQ':'카카오뱅크','330860.KQ':'네패스','336260.KQ':'두산퓨얼셀',
    '348210.KQ':'넥스틴','352480.KQ':'씨이랩','376300.KQ':'디어유',
    '383310.KQ':'에코프로에이치엔','389030.KQ':'지놈앤컴퍼니','394280.KQ':'오픈엣지테크놀로지',
    '399720.KQ':'가온칩스','417310.KQ':'소마젠',
    '005870.KS':'휴니드테크놀로지스','377740.KS':'바이오노트','139480.KS':'이마트','002710.KS':'TCC스틸',
  };
  for (const [ticker, name] of Object.entries(fallbackNames)) {
    if (!koreanNameMap[ticker]) koreanNameMap[ticker] = name;
  }

  console.log(`종목 로드: 코스피 ${stocks.kospi.length}개, 코스닥 ${stocks.kosdaq.length}개, 한글명 ${Object.keys(koreanNameMap).length}개`);
  return stocks;
}

// ─── 기술 지표 계산 ───

function calcRSI(candles, period = 14) {
  const closes = candles.map(c => c.close);
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;

  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff; else lossSum += Math.abs(diff);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function calcBollingerBands(candles, period = 20, mult = 2) {
  const closes = candles.map(c => c.close);
  const upper = new Array(closes.length).fill(null);
  const middle = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { upper, middle, lower };
}

function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  const closes = candles.map(c => c.close);
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );

  const macdValues = macdLine.filter(v => v != null);
  const signalEma = calcEMA(macdValues, signal);
  const signalLine = new Array(closes.length).fill(null);
  let idx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] != null) {
      signalLine[i] = signalEma[idx] ?? null;
      idx++;
    }
  }

  const histogram = closes.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  );

  return { macdLine, signalLine, histogram };
}

function calcEMA(data, period) {
  const ema = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let startIdx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] != null) { startIdx = i; break; }
  }
  if (startIdx < 0 || data.length - startIdx < period) return ema;

  let sum = 0;
  for (let i = startIdx; i < startIdx + period; i++) sum += data[i];
  ema[startIdx + period - 1] = sum / period;

  for (let i = startIdx + period; i < data.length; i++) {
    ema[i] = data[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

// ─── 캔들 패턴 감지 ───

function isBearishEngulfing(prev, curr) {
  return prev.close > prev.open && curr.open >= prev.close && curr.close <= prev.open;
}

function isBullishEngulfing(prev, curr) {
  return prev.close < prev.open && curr.open <= prev.close && curr.close >= prev.open;
}

function isConsecutiveBearish(candles, idx, count = 3) {
  if (idx < count - 1) return false;
  for (let i = idx - count + 1; i <= idx; i++) {
    if (candles[i].close >= candles[i].open) return false;
  }
  return true;
}

// ─── 전략 1: RSI + 캔들 + 볼린저밴드 ───

function analyzeStrategy1(candles, rsi, bb) {
  const n = candles.length;
  const last = n - 1;
  const conditions = {
    rsi_triggered: false,
    band_touch: false,
    engulfing_candle: false,
    double_pattern: false,
  };
  let signal = 'WAIT';
  let stopLoss = null;
  let takeProfit = null;

  const currentRSI = rsi[last];
  if (currentRSI == null) return { signal, conditions, stopLoss, takeProfit, strategy: '전략1' };

  // ── 매수 분석 ──
  let buyScore = 0;

  // 1) RSI가 최근 10봉 내 30 이하로 내려간 적 있는지
  let rsiBelow30 = false;
  for (let i = Math.max(0, last - 10); i <= last; i++) {
    if (rsi[i] != null && rsi[i] <= 30) { rsiBelow30 = true; break; }
  }
  if (rsiBelow30) { conditions.rsi_triggered = true; buyScore++; }

  // 2) 볼린저밴드 하단 터치/이탈 + 음봉 패턴
  let bandTouchIdx = -1;
  for (let i = Math.max(0, last - 10); i <= last; i++) {
    if (bb.lower[i] == null) continue;
    const bearish = candles[i].close < candles[i].open;
    const touchLower = candles[i].low <= bb.lower[i];
    if (bearish && touchLower) { bandTouchIdx = i; break; }
    if (isConsecutiveBearish(candles, i, 3) && touchLower) { bandTouchIdx = i; break; }
  }
  if (bandTouchIdx >= 0) { conditions.band_touch = true; buyScore++; }

  // 3) 장악형 양봉
  let engulfIdx = -1;
  for (let i = Math.max(bandTouchIdx + 1, last - 5); i <= last; i++) {
    if (i < 1) continue;
    if (isBullishEngulfing(candles[i - 1], candles[i])) { engulfIdx = i; break; }
  }
  if (engulfIdx >= 0) { conditions.engulfing_candle = true; buyScore++; }

  // 4) 쌍바닥 (최근 20봉 내 저점 2개)
  const lookback = Math.max(0, last - 20);
  const lows = [];
  for (let i = lookback; i <= last; i++) {
    if (i > 0 && i < last) {
      if (candles[i].low <= candles[i - 1].low && candles[i].low <= candles[i + 1]?.low) {
        lows.push({ idx: i, val: candles[i].low });
      }
    }
  }
  if (lows.length >= 2) {
    const bottom1 = lows[lows.length - 2];
    const bottom2 = lows[lows.length - 1];
    const threshold = Math.abs(bottom1.val - bottom2.val) / bottom1.val;
    if (threshold < 0.03) {
      if (bb.lower[bottom2.idx] != null && bottom2.val >= bb.lower[bottom2.idx]) {
        conditions.double_pattern = true;
        buyScore++;
      }
    }
  }

  // 5) 매수 신호 판정
  if (buyScore >= 4) {
    signal = 'BUY';
    stopLoss = bb.lower[last] != null ? Math.round(bb.lower[last]) : null;
    if (stopLoss) {
      takeProfit = Math.round(candles[last].close + (candles[last].close - stopLoss) * 2);
    }
  } else if (buyScore >= 2 && rsiBelow30) {
    signal = 'WATCH';
    stopLoss = bb.lower[last] != null ? Math.round(bb.lower[last]) : null;
    if (stopLoss) {
      takeProfit = Math.round(candles[last].close + (candles[last].close - stopLoss) * 2);
    }
  }

  // ── 매도 분석 ──
  let sellScore = 0;
  const sellConditions = {
    rsi_triggered: false,
    band_touch: false,
    engulfing_candle: false,
    double_pattern: false,
  };

  let rsiAbove70 = false;
  for (let i = Math.max(0, last - 10); i <= last; i++) {
    if (rsi[i] != null && rsi[i] >= 70) { rsiAbove70 = true; break; }
  }
  if (rsiAbove70) { sellConditions.rsi_triggered = true; sellScore++; }

  let upperTouchIdx = -1;
  for (let i = Math.max(0, last - 10); i <= last; i++) {
    if (bb.upper[i] == null) continue;
    if (candles[i].close > candles[i].open && candles[i].high >= bb.upper[i]) {
      upperTouchIdx = i; break;
    }
  }
  if (upperTouchIdx >= 0) { sellConditions.band_touch = true; sellScore++; }

  let bearEngulfIdx = -1;
  for (let i = Math.max(upperTouchIdx + 1, last - 5); i <= last; i++) {
    if (i < 1) continue;
    if (isBearishEngulfing(candles[i - 1], candles[i])) { bearEngulfIdx = i; break; }
  }
  if (bearEngulfIdx >= 0) { sellConditions.engulfing_candle = true; sellScore++; }

  const highs = [];
  for (let i = lookback; i <= last; i++) {
    if (i > 0 && i < last) {
      if (candles[i].high >= candles[i - 1].high && candles[i].high >= candles[i + 1]?.high) {
        highs.push({ idx: i, val: candles[i].high });
      }
    }
  }
  if (highs.length >= 2) {
    const top2 = highs[highs.length - 1];
    if (bb.upper[top2.idx] != null && top2.val <= bb.upper[top2.idx]) {
      sellConditions.double_pattern = true;
      sellScore++;
    }
  }

  if (sellScore >= 4 && sellScore > buyScore) {
    signal = 'SELL';
    const recent5High = candles.slice(Math.max(0, last - 4), last + 1).reduce((mx, c) => Math.max(mx, c.high), 0);
    stopLoss = Math.round(recent5High);
    takeProfit = Math.round(candles[last].close - (stopLoss - candles[last].close));
    Object.assign(conditions, sellConditions);
  } else if (sellScore >= 2 && rsiAbove70 && signal === 'WAIT') {
    signal = 'WATCH';
    const recent5High = candles.slice(Math.max(0, last - 4), last + 1).reduce((mx, c) => Math.max(mx, c.high), 0);
    stopLoss = Math.round(recent5High);
    takeProfit = Math.round(candles[last].close - (stopLoss - candles[last].close));
    if (sellScore > buyScore) Object.assign(conditions, sellConditions);
  }

  return { signal, conditions, stopLoss, takeProfit, strategy: '전략1' };
}

// ─── 전략 2: RSI 다이버전스 + MACD ───

function findDivergence(candles, rsi, direction = 'bullish') {
  const n = candles.length;
  const lookback = 30;
  const start = Math.max(20, n - lookback);

  const pivots = [];
  for (let i = start; i < n - 1; i++) {
    if (rsi[i] == null) continue;
    if (direction === 'bullish') {
      if (i > 0 && candles[i].low <= candles[i - 1].low && candles[i].low <= candles[i + 1]?.low) {
        pivots.push({ idx: i, price: candles[i].low, rsiVal: rsi[i] });
      }
    } else {
      if (i > 0 && candles[i].high >= candles[i - 1].high && candles[i].high >= candles[i + 1]?.high) {
        pivots.push({ idx: i, price: candles[i].high, rsiVal: rsi[i] });
      }
    }
  }

  if (pivots.length < 2) return null;

  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];

  if (direction === 'bullish') {
    if (p2.price < p1.price && p2.rsiVal > p1.rsiVal) return '상승 다이버전스';
  } else {
    if (p2.price > p1.price && p2.rsiVal < p1.rsiVal) return '하락 다이버전스';
  }
  return null;
}

function analyzeStrategy2(candles, rsi, macd) {
  const n = candles.length;
  const last = n - 1;
  const conditions = { divergence_detected: false, macd_confirm: false };
  let signal = null;
  let divergence = '없음';
  let macdCross = 'none';
  let stopLoss = null;
  let takeProfit = null;

  const bullDiv = findDivergence(candles, rsi, 'bullish');
  const bearDiv = findDivergence(candles, rsi, 'bearish');

  if (bullDiv) { divergence = bullDiv; conditions.divergence_detected = true; }
  else if (bearDiv) { divergence = bearDiv; conditions.divergence_detected = true; }

  for (let i = Math.max(0, last - 2); i <= last; i++) {
    if (i < 1 || macd.macdLine[i] == null || macd.signalLine[i] == null) continue;
    if (macd.macdLine[i - 1] == null || macd.signalLine[i - 1] == null) continue;
    const prevAbove = macd.macdLine[i - 1] > macd.signalLine[i - 1];
    const currAbove = macd.macdLine[i] > macd.signalLine[i];
    if (!prevAbove && currAbove) { macdCross = 'golden'; conditions.macd_confirm = true; }
    else if (prevAbove && !currAbove) { macdCross = 'dead'; conditions.macd_confirm = true; }
  }

  if (macdCross === 'none' && macd.macdLine[last] != null && macd.signalLine[last] != null) {
    macdCross = macd.macdLine[last] > macd.signalLine[last] ? 'bull' : 'bear';
  }

  if (bullDiv && macdCross === 'golden') {
    for (let i = Math.max(0, last - 3); i <= last; i++) {
      if (i < 1) continue;
      if (isBullishEngulfing(candles[i - 1], candles[i])) {
        signal = 'BUY';
        const recentLow = candles.slice(Math.max(0, last - 10), last + 1).reduce((mn, c) => Math.min(mn, c.low), Infinity);
        stopLoss = Math.round(recentLow);
        takeProfit = Math.round(candles[last].close + (candles[last].close - stopLoss) * 2);
        break;
      }
    }
    if (!signal) signal = 'WATCH';
  }

  if (bearDiv && macdCross === 'dead') {
    signal = 'SELL';
    const recentHigh = candles.slice(Math.max(0, last - 10), last + 1).reduce((mx, c) => Math.max(mx, c.high), 0);
    stopLoss = Math.round(recentHigh);
    takeProfit = Math.round(candles[last].close - (stopLoss - candles[last].close));
  }

  if (!signal && (conditions.divergence_detected || conditions.macd_confirm)) {
    signal = 'WATCH';
  }

  return { signal, conditions, divergence, macdCross, stopLoss, takeProfit, strategy: '전략2' };
}

// ─── 종합 분석 ───

function analyze(candles) {
  const rsi = calcRSI(candles);
  const bb = calcBollingerBands(candles);
  const macd = calcMACD(candles);
  const last = candles.length - 1;

  const s1 = analyzeStrategy1(candles, rsi, bb);
  const s2 = analyzeStrategy2(candles, rsi, macd);

  let signal, strategy, stopLoss, takeProfit;
  const conditions = {
    rsi_triggered: s1.conditions.rsi_triggered,
    band_touch: s1.conditions.band_touch,
    engulfing_candle: s1.conditions.engulfing_candle,
    double_pattern: s1.conditions.double_pattern,
    macd_confirm: s2.conditions.macd_confirm,
    divergence_detected: s2.conditions.divergence_detected,
  };

  if (s1.signal === 'BUY' || s1.signal === 'SELL') {
    signal = s1.signal;
    strategy = '전략1';
    stopLoss = s1.stopLoss;
    takeProfit = s1.takeProfit;
  }
  if (s2.signal === 'BUY' || s2.signal === 'SELL') {
    if (signal === s2.signal) {
      strategy = '혼합';
    } else if (!signal || signal === 'WATCH' || signal === 'WAIT') {
      signal = s2.signal;
      strategy = '전략2';
      stopLoss = s2.stopLoss;
      takeProfit = s2.takeProfit;
    }
  }

  if (!signal) {
    signal = s1.signal !== 'WAIT' ? s1.signal : s2.signal || 'WAIT';
    strategy = signal === 'WAIT' ? '-' : (s1.signal !== 'WAIT' ? '전략1' : '전략2');
    stopLoss = s1.stopLoss || s2.stopLoss;
    takeProfit = s1.takeProfit || s2.takeProfit;
  }

  const currentRSI = rsi[last];
  const totalCondsMet = Object.values(conditions).filter(Boolean).length;
  if (!signal || (signal !== 'BUY' && signal !== 'SELL' && signal !== 'WATCH')) {
    signal = totalCondsMet > 0 ? 'WATCH' : 'WAIT';
  }

  // 항상 손절가/목표가 계산 (신호가 없어도)
  if (!stopLoss && bb.lower[last] != null) {
    stopLoss = Math.round(bb.lower[last]);
  }
  if (!takeProfit && stopLoss && candles[last]) {
    takeProfit = Math.round(candles[last].close + (candles[last].close - stopLoss) * 2);
  }

  const price = candles[last].close;
  const prevPrice = candles[last - 1]?.close || price;
  const changePct = ((price - prevPrice) / prevPrice * 100);

  const bbPct = bb.lower[last] != null && bb.upper[last] != null
    ? ((price - bb.lower[last]) / (bb.upper[last] - bb.lower[last]) * 100)
    : null;

  const rsiHistory = rsi.slice(Math.max(0, rsi.length - 60)).map(v => v != null ? Math.round(v * 100) / 100 : null);

  return {
    price: Math.round(price),
    change_pct: Math.round(changePct * 100) / 100,
    rsi: currentRSI != null ? Math.round(currentRSI * 10) / 10 : null,
    bb_pct: bbPct != null ? Math.round(bbPct * 10) / 10 : null,
    bb_lower: bb.lower[last] != null ? Math.round(bb.lower[last]) : null,
    bb_upper: bb.upper[last] != null ? Math.round(bb.upper[last]) : null,
    macd_cross: s2.macdCross,
    divergence: s2.divergence,
    signal,
    strategy,
    conditions,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    rsi_history: rsiHistory,
    data_date: new Date(candles[last].time).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }),
  };
}

// ─── 백그라운드 스캔 시스템 ───

let stockList = { kospi: [], kosdaq: [] };
let scanCache = { kospi: [], kosdaq: [], lastScan: null, scanning: false, progress: { done: 0, total: 0 } };

const sortFn = (a, b) => {
  const order = { BUY: 0, SELL: 1, WATCH: 2 };
  const oa = order[a.signal] ?? 3;
  const ob = order[b.signal] ?? 3;
  if (oa !== ob) return oa - ob;
  return Object.values(b.conditions).filter(Boolean).length - Object.values(a.conditions).filter(Boolean).length;
};

async function runBackgroundScan() {
  if (scanCache.scanning) {
    console.log('스캔 이미 진행 중, 건너뜀');
    return;
  }
  scanCache.scanning = true;
  const startTime = Date.now();
  console.log(`[${new Date().toLocaleTimeString('ko-KR')}] 백그라운드 스캔 시작...`);

  // 새 스캔 시작 시 임시 버퍼에 쌓고, 실시간으로 캐시 업데이트
  const kospiResults = [];
  const kosdaqResults = [];
  const allTickers = [
    ...stockList.kospi.map(t => ({ ticker: t, market: 'kospi' })),
    ...stockList.kosdaq.map(t => ({ ticker: t, market: 'kosdaq' })),
  ];

  scanCache.progress = { done: 0, total: allTickers.length };

  // 5개씩 배치, 배치 간 200ms 딜레이
  for (let i = 0; i < allTickers.length; i += 5) {
    const batch = allTickers.slice(i, i + 5);
    const promises = batch.map(async ({ ticker, market }) => {
      try {
        const { name, candles } = await fetchYahooData(ticker);
        const result = analyze(candles);
        if (result.signal === 'BUY' || result.signal === 'SELL' || result.signal === 'WATCH') {
          const entry = {
            ticker, name, market, ...result,
            timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
          };
          if (market === 'kospi') kospiResults.push(entry);
          else kosdaqResults.push(entry);
        }
      } catch { /* skip */ }
    });
    await Promise.all(promises);
    scanCache.progress.done = Math.min(i + 5, allTickers.length);

    // 실시간 캐시 업데이트 (50개 배치마다)
    if ((i + 5) % 50 === 0 || i + 5 >= allTickers.length) {
      scanCache.kospi = [...kospiResults].sort(sortFn);
      scanCache.kosdaq = [...kosdaqResults].sort(sortFn);
      scanCache.lastScan = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    }

    // Yahoo 차단 방지 딜레이
    if (i + 5 < allTickers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  // 최종 정렬 및 저장
  scanCache.kospi = kospiResults.sort(sortFn);
  scanCache.kosdaq = kosdaqResults.sort(sortFn);
  scanCache.lastScan = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  scanCache.scanning = false;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${new Date().toLocaleTimeString('ko-KR')}] 스캔 완료: 코스피 ${kospiResults.length}개, 코스닥 ${kosdaqResults.length}개 신호 (${elapsed}초, 총 ${allTickers.length}종목)`);
}

// ─── API 라우트 ───

app.use(express.static(path.join(__dirname, 'public')));

// 한글명 검색 API (정확 매칭 우선)
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 1) return res.json([]);
  const exact = [];
  const startsWith = [];
  const contains = [];
  for (const [ticker, name] of Object.entries(koreanNameMap)) {
    const nl = name.toLowerCase();
    if (nl === q) { exact.push({ ticker, name }); }
    else if (nl.startsWith(q)) { startsWith.push({ ticker, name }); }
    else if (nl.includes(q) || ticker.toLowerCase().includes(q)) { contains.push({ ticker, name }); }
  }
  res.json([...exact, ...startsWith, ...contains].slice(0, 20));
});

app.get('/api/analyze', async (req, res) => {
  try {
    let { ticker, period = '6mo', interval = '1d' } = req.query;
    if (!ticker) return res.status(400).json({ error: '종목명 또는 코드를 입력해주세요' });

    // 한글명으로 입력된 경우 티커로 변환 (정확매칭 > startsWith > includes)
    if (!/^\d{6}\.(KS|KQ)$/i.test(ticker)) {
      const q = ticker.toLowerCase();
      let found = Object.entries(koreanNameMap).find(([t, n]) => n.toLowerCase() === q);
      if (!found) found = Object.entries(koreanNameMap).find(([t, n]) => n.toLowerCase().startsWith(q));
      if (!found) found = Object.entries(koreanNameMap).find(([t, n]) => n.toLowerCase().includes(q));
      if (found) {
        ticker = found[0];
      } else {
        return res.status(400).json({ error: `"${req.query.ticker}" 종목을 찾을 수 없습니다. 종목명이나 코드(예: 005930.KS)를 확인해주세요.` });
      }
    }
    const { name, candles } = await fetchYahooData(ticker, period, interval);
    const result = analyze(candles);
    res.json({
      ticker, name, ...result,
      timestamp: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    });
  } catch (err) {
    if (err.message === 'INSUFFICIENT_DATA') {
      return res.status(400).json({ error: '데이터가 부족합니다 (최소 30봉 필요)' });
    }
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: '잠시 후 다시 시도합니다' });
  }
});

app.get('/api/scan', (req, res) => {
  const market = req.query.market; // kospi, kosdaq, 또는 미지정=전체
  let results;
  if (market === 'kospi') results = scanCache.kospi;
  else if (market === 'kosdaq') results = scanCache.kosdaq;
  else results = [...scanCache.kospi, ...scanCache.kosdaq].sort((a, b) => {
    const order = { BUY: 0, SELL: 1, WATCH: 2 };
    const oa = order[a.signal] ?? 3;
    const ob = order[b.signal] ?? 3;
    if (oa !== ob) return oa - ob;
    return Object.values(b.conditions).filter(Boolean).length - Object.values(a.conditions).filter(Boolean).length;
  });

  res.json({
    results,
    lastScan: scanCache.lastScan,
    scanning: scanCache.scanning,
    progress: scanCache.progress,
    totalStocks: { kospi: stockList.kospi.length, kosdaq: stockList.kosdaq.length },
  });
});

// ─── 포트폴리오 (모의 매수) ───

const fs = require('fs');
const PORTFOLIO_FILE = path.join(__dirname, 'portfolio.json');

function loadPortfolio() {
  try { return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf-8')); }
  catch { return []; }
}
function savePortfolio(data) {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2));
}

app.use(express.json());

// 매수 등록
app.post('/api/portfolio/buy', (req, res) => {
  const { ticker, name, price, stop_loss, take_profit, strategy, signal, data_date, actual_price, quantity } = req.body;
  if (!ticker || !price) return res.status(400).json({ error: 'ticker, price 필수' });
  const portfolio = loadPortfolio();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ticker, name: name || ticker,
    buy_price: price,
    actual_price: actual_price || price,
    quantity: quantity || 1,
    stop_loss: stop_loss || null,
    take_profit: take_profit || null,
    strategy: strategy || '-',
    signal: signal || 'BUY',
    data_date: data_date || null,
    bought_at: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    status: 'holding',
  };
  portfolio.push(entry);
  savePortfolio(portfolio);
  res.json(entry);
});

// ─── 네이버 금융 실시간 현재가 (캐시 + 병렬) ───
const naverPriceCache = {};    // { '005930': { price, time, fetchedAt } }
const NAVER_CACHE_MS = 3000;   // 3초 캐시 — 장중 실시간성 확보하면서 차단 방지

async function fetchNaverPrice(code) {
  const url = `https://m.stock.naver.com/api/stock/${code}/basic`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  if (!r.ok) throw new Error(`Naver ${r.status}`);
  const d = await r.json();
  const price = parseInt((d.closePrice || '0').replace(/,/g, ''), 10);
  if (!price) throw new Error('No price');
  // localTradedAt: "2026-03-30T14:39:01+09:00"
  let time = null;
  if (d.localTradedAt) {
    const dt = new Date(d.localTradedAt);
    time = dt.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }
  return { price, time };
}

async function fetchNaverPrices(codes) {
  if (!codes.length) return {};
  const now = Date.now();

  // 캐시 만료된 것만 조회 (병렬)
  const uncached = codes.filter(c => {
    const cached = naverPriceCache[c];
    return !cached || (now - cached.fetchedAt > NAVER_CACHE_MS);
  });

  if (uncached.length > 0) {
    const results = await Promise.allSettled(
      uncached.map(async code => {
        const data = await fetchNaverPrice(code);
        naverPriceCache[code] = { ...data, fetchedAt: Date.now() };
        return { code, ...data };
      })
    );
    results.forEach(r => {
      if (r.status === 'rejected') console.error('네이버 현재가 오류:', r.reason?.message);
    });
  }

  const result = {};
  for (const c of codes) {
    result[c] = naverPriceCache[c] || null;
  }
  return result;
}

// ticker(005930.KS) → 종목코드(005930) 변환
function tickerToCode(ticker) {
  return ticker.replace(/\.(KS|KQ)$/i, '');
}

// 포트폴리오 조회 (네이버 실시간 현재가 - 보유중만)
app.get('/api/portfolio', async (req, res) => {
  const portfolio = loadPortfolio().filter(p => p.status !== 'sold');
  if (!portfolio.length) return res.json([]);

  // 보유 종목코드 추출 → 네이버 API 1회 호출
  const codes = [...new Set(portfolio.map(p => tickerToCode(p.ticker)))];
  const prices = await fetchNaverPrices(codes);

  const results = portfolio.map(item => {
    try {
      const code = tickerToCode(item.ticker);
      const priceData = prices[code];
      if (!priceData || !priceData.price) throw new Error('No price');

      const currentPrice = priceData.price;
      const marketTime = priceData.time;
      const actualBuy = item.actual_price || item.buy_price;
      const qty = item.quantity || 1;
      const pnlPerShare = currentPrice - actualBuy;
      const pnlTotal = pnlPerShare * qty;
      const pnlPct = ((pnlPerShare / actualBuy) * 100);
      const hitSL = item.stop_loss && currentPrice <= item.stop_loss;
      const hitTP = item.take_profit && currentPrice >= item.take_profit;
      return {
        ...item,
        current_price: currentPrice,
        price_fetched_at: marketTime,
        pnl: Math.round(pnlPerShare),
        pnl_total: Math.round(pnlTotal),
        pnl_pct: Math.round(pnlPct * 100) / 100,
        status: hitTP ? 'TARGET' : hitSL ? 'STOPLOSS' : pnlPerShare >= 0 ? 'PROFIT' : 'LOSS',
      };
    } catch {
      return { ...item, current_price: null, price_fetched_at: null, pnl: null, pnl_pct: null, status: 'ERROR' };
    }
  });

  res.json(results);
});

// 매매 기록 조회 (매도 완료 내역) - :id 라우트보다 먼저 정의
app.get('/api/portfolio/history', (req, res) => {
  const portfolio = loadPortfolio();
  const history = portfolio.filter(p => p.status === 'sold').sort((a, b) => {
    return (b.sold_at || '').localeCompare(a.sold_at || '');
  });
  res.json(history);
});

// 매도 처리 (기록 보존)
app.post('/api/portfolio/sell', (req, res) => {
  const { id, sell_price } = req.body;
  if (!id) return res.status(400).json({ error: 'id 필수' });
  const portfolio = loadPortfolio();
  const item = portfolio.find(p => p.id === id);
  if (!item) return res.status(404).json({ error: '종목 없음' });

  item.status = 'sold';
  item.sell_price = sell_price || null;
  item.sold_at = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  if (item.sell_price && item.actual_price) {
    item.realized_pnl = Math.round((item.sell_price - item.actual_price) * item.quantity);
    item.realized_pnl_pct = Math.round(((item.sell_price - item.actual_price) / item.actual_price) * 10000) / 100;
  }
  savePortfolio(portfolio);
  res.json(item);
});

// 포트폴리오에서 완전 삭제
app.delete('/api/portfolio/:id', (req, res) => {
  let portfolio = loadPortfolio();
  portfolio = portfolio.filter(p => p.id !== req.params.id);
  savePortfolio(portfolio);
  res.json({ ok: true });
});

// ─── 웹 푸시 API ───

// VAPID 공개키 전달
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// 푸시 구독 등록
app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: '잘못된 구독 정보' });
  // 중복 제거
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== sub.endpoint);
  pushSubscriptions.push(sub);
  saveSubs();
  console.log(`📱 푸시 구독 등록 (총 ${pushSubscriptions.length}개)`);
  res.json({ ok: true });
});

// 푸시 구독 해제
app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
  saveSubs();
  res.json({ ok: true });
});

// 모든 구독자에게 푸시 보내기
async function sendPushToAll(title, body) {
  if (!pushSubscriptions.length) { console.log('⚠️ 등록된 푸시 구독 없음'); return; }
  const payload = JSON.stringify({ title, body });
  const expired = [];
  await Promise.allSettled(pushSubscriptions.map(async (sub, i) => {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        expired.push(i);
      }
      console.error('푸시 발송 실패:', err.statusCode || err.message);
    }
  }));
  // 만료된 구독 정리
  if (expired.length) {
    pushSubscriptions = pushSubscriptions.filter((_, i) => !expired.includes(i));
    saveSubs();
  }
}

// 테스트 푸시 발송
app.post('/api/push/test', async (req, res) => {
  await sendPushToAll('🔔 테스트 알림', '푸시 알림이 정상 작동합니다!');
  res.json({ ok: true, subscribers: pushSubscriptions.length });
});

// ─── 포트폴리오 가격 모니터링 (손절/목표 알림) ───
const alertedItems = new Set(); // 중복 알림 방지 (세션 동안)

async function monitorPortfolio() {
  const portfolio = loadPortfolio().filter(p => p.status !== 'sold');
  if (!portfolio.length || !pushSubscriptions.length) return;

  const codes = [...new Set(portfolio.map(p => tickerToCode(p.ticker)))];
  const prices = await fetchNaverPrices(codes);

  for (const item of portfolio) {
    const code = tickerToCode(item.ticker);
    const priceData = prices[code];
    if (!priceData || !priceData.price) continue;

    const currentPrice = priceData.price;
    const actualBuy = item.actual_price || item.buy_price;
    const name = item.name || code;
    const alertKey = item.id;

    // 손절가 도달
    if (item.stop_loss && currentPrice <= item.stop_loss && !alertedItems.has(alertKey + '_SL')) {
      alertedItems.add(alertKey + '_SL');
      const pnl = Math.round((currentPrice - actualBuy) / actualBuy * 100);
      await sendPushToAll(
        `🚨 손절가 도달! ${name}`,
        `현재가 ${currentPrice.toLocaleString()}원 ≤ 손절가 ${item.stop_loss.toLocaleString()}원 (${pnl}%)`
      );
    }

    // 목표가 도달
    if (item.take_profit && currentPrice >= item.take_profit && !alertedItems.has(alertKey + '_TP')) {
      alertedItems.add(alertKey + '_TP');
      const pnl = Math.round((currentPrice - actualBuy) / actualBuy * 100);
      await sendPushToAll(
        `🎯 목표가 도달! ${name}`,
        `현재가 ${currentPrice.toLocaleString()}원 ≥ 목표가 ${item.take_profit.toLocaleString()}원 (+${pnl}%)`
      );
    }
  }
}

// ─── 서버 시작 ───

app.listen(PORT, async () => {
  console.log(`RSI 투자 에이전트 실행 중: http://localhost:${PORT}`);

  // 종목 리스트 로드
  stockList = await fetchKRXStockList();

  // 즉시 첫 스캔
  runBackgroundScan();

  // 10분마다 반복 스캔
  setInterval(runBackgroundScan, 10 * 60 * 1000);

  // 30초마다 포트폴리오 모니터링 (손절/목표 알림)
  setInterval(monitorPortfolio, 30 * 1000);
  console.log('📱 포트폴리오 모니터링 시작 (30초 간격)');
});
