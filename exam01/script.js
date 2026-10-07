// 검색
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  window.open('https://search.naver.com/search.naver?query=' + encodeURIComponent(q), '_blank');
});

// 뉴스 롤링
const headlines = [
  ['연합뉴스', '전국 대부분 지역 맑고 일교차 커… 건강관리 유의'],
  ['한국경제', '코스피, 외국인 순매수에 상승 마감'],
  ['조선일보', '가을 단풍 절정 시기, 올해는 평년보다 늦어져'],
  ['중앙일보', 'AI 기술 확산에 따른 일자리 변화 전망'],
  ['KBS', '주말 고속도로 정체 예상… 출발 전 교통정보 확인'],
];
let headIdx = 0;
const rolling = document.getElementById('rollingNews');
function rollNews() {
  const [press, title] = headlines[headIdx];
  rolling.innerHTML = `<span class="press">${press}</span><a href="#" class="rolling-text">${title}</a>`;
  headIdx = (headIdx + 1) % headlines.length;
}
rollNews();
setInterval(rollNews, 3000);

// 언론사 그리드
const pressSets = {
  press: ['연합뉴스', 'KBS', 'MBC', 'SBS', 'JTBC', 'YTN', '조선일보', '중앙일보', '동아일보', '한겨레', '경향신문', '한국경제',
          '매일경제', '머니투데이', '서울신문', '국민일보', '세계일보', '뉴시스'],
  list: ['ZDNet', '전자신문', '디지털타임스', '블로터', '아이뉴스24', '지디넷', '스포츠조선', '스포츠서울', 'OSEN', '마이데일리',
         '이데일리', '파이낸셜뉴스', '헤럴드경제', '아시아경제', '노컷뉴스', '오마이뉴스', '프레시안', '시사IN'],
};
const pressGrid = document.getElementById('pressGrid');
function renderPress(key) {
  pressGrid.innerHTML = pressSets[key].map((p) => `<li>${p}</li>`).join('');
}
document.querySelectorAll('#newsTabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#newsTabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderPress(btn.dataset.tab);
  });
});
renderPress('press');

// 주제별 콘텐츠
const palette = ['#ffe8e8', '#e8f1ff', '#e9fbe9', '#fff4d9', '#f1e9ff'];
const topicEmoji = { 엔터: '🎬', 스포츠: '⚽', 자동차: '🚗', 웹툰: '📖', 경제: '💰', 레시피: '🍳', 리빙: '🛋', 여행: '✈️' };
const cardList = document.getElementById('cardList');
function renderCards(topic) {
  const emoji = topicEmoji[topic];
  cardList.innerHTML = [1, 2, 3, 4].map((n, i) => `
    <li>
      <a href="#" style="display:flex;gap:16px;width:100%">
        <div class="card-thumb" style="background:${palette[i % palette.length]}">${emoji}</div>
        <div class="card-body">
          <h4>[${topic}] 지금 가장 주목받는 이야기 ${n}</h4>
          <p>${topic} 분야에서 화제가 되고 있는 소식을 한눈에 정리했습니다. 놓치기 쉬운 핵심 포인트를 확인해 보세요.</p>
          <p class="source">${topic}매거진 · ${n}시간 전</p>
        </div>
      </a>
    </li>`).join('');
}
document.querySelectorAll('#topicTabs li').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#topicTabs li').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    renderCards(tab.textContent);
  });
});
renderCards('엔터');
