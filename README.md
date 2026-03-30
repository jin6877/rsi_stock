# KRX RSI 투자 에이전트 웹서비스

로스 카메론 RSI 매매법 기반 한국 주식 분석 도구

## 전략 요약

- **전략 1**: RSI + 캔들 패턴 + 볼린저밴드 (쌍바닥/쌍봉)
- **전략 2**: RSI 다이버전스 + MACD 크로스
- 5초마다 자동 갱신, 종목 스캔 및 신호 알림

## 설치 및 실행

```bash
# 1. 의존성 설치
npm install

# 2. 서버 실행
npm start

# 3. 브라우저 접속
open http://localhost:9090
```

## 기술 스택

- Backend: Node.js + Express
- Frontend: 단일 index.html (Chart.js CDN)
- 데이터: Yahoo Finance API

## 신호 등급

| 신호 | 의미 |
|------|------|
| BUY  | 매수 조건 완성 |
| SELL | 매도 조건 완성 |
| WATCH | 일부 조건 충족, 모니터링 |
| WAIT | RSI 30~70 구간, 진입 금지 |
