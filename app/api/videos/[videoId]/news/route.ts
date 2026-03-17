import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { videoRepository } from '@/lib/supabase/videos'
import { supabase } from '@/lib/supabase/client'

interface NewsItem {
  title: string
  link: string
  source: string
  publishedAt: string | null
}

interface StockSuggestion {
  ticker: string
  name: string
  market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'HKEX' | 'TSE' | 'TWSE'
  is_core: boolean
}

interface TaxonomyRow {
  taxonomy_id: string
  sector: string
  category: string
  subcategory: string
}

interface TaxonomyIndustryRow {
  taxonomy_id: string
  subindustry_id: string
}

interface StockExampleRow {
  ticker: string
  company_name: string
  subindustry_id: string
}

interface TaxonomyContext {
  sector: string
  category: string
  subcategory: string
  taxonomyId: string
}

type ChannelStockMode = 'auto' | 'strict' | 'off' | 'low_stock'
type ChannelNewsMode = 'auto' | 'strict' | 'off'

const VALID_MARKETS = ['KOSPI', 'KOSDAQ', 'NYSE', 'NASDAQ', 'HKEX', 'TSE', 'TWSE'] as const
const VALID_MARKET_SET = new Set<string>(VALID_MARKETS)

const TAXONOMY_RULES: Array<{ keywords: string[]; target: { sector: string; category: string; subcategory: string } }> = [
  { keywords: ['도서관', '건축가', '건축', '공공건축'], target: { sector: 'Construction', category: 'Architecture', subcategory: 'Library' } },
  { keywords: ['cu', '편의점', 'gs25', '세븐일레븐'], target: { sector: 'Retail', category: 'Convenience', subcategory: 'CU' } },
  { keywords: ['밀크티', '버블티'], target: { sector: 'Consumer', category: 'Food', subcategory: 'Milk Tea' } },
  { keywords: ['ai', '엔비디아', 'gpu', '반도체'], target: { sector: 'Technology', category: 'Semiconductor', subcategory: 'GPU' } },
  { keywords: ['명품', '럭셔리', '플래그십'], target: { sector: 'LuxuryFashion', category: 'Luxury', subcategory: 'Luxury Brand' } },
  { keywords: ['수능', '입시', '학원', '영어'], target: { sector: 'Education', category: 'K-12', subcategory: 'Suneung' } },
  { keywords: ['암세포', '암환자', '항암', '종양', '병원', '식이요법'], target: { sector: 'Healthcare', category: 'Pharma', subcategory: 'Oncology' } },
  { keywords: ['비타민', '미네랄', '영양소', '과일식사', '영양관리', '건강식단'], target: { sector: 'Healthcare', category: 'Nutrition', subcategory: 'Medical Nutrition' } },
  { keywords: ['이란', '호르무즈', '기뢰', '미사일', '러시아', '우크라이나', '돈바스', '푸틴'], target: { sector: 'AerospaceDefense', category: 'Defense', subcategory: 'Missile' } },
  { keywords: ['이더리움', 'eth'], target: { sector: 'DigitalAssets', category: 'Crypto Market', subcategory: 'Ethereum' } },
  { keywords: ['비트코인', 'btc', '코인', '암호화폐', '가상자산'], target: { sector: 'DigitalAssets', category: 'Crypto Market', subcategory: 'Bitcoin' } },
  { keywords: ['해킹', '백도어', '랜섬웨어', '제로데이', '악성코드'], target: { sector: 'CyberSecurity', category: 'Threat', subcategory: 'Hacking' } },
]

let taxonomyCache: {
  taxonomyRows: TaxonomyRow[]
  mappingRows: TaxonomyIndustryRow[]
  stockRows: StockExampleRow[]
} | null = null

async function getChannelModes(youtubeChannelId: string): Promise<{
  stockMode: ChannelStockMode
  newsMode: ChannelNewsMode
}> {
  void youtubeChannelId
  // 사용자 설정에서 기사/영상 모드 제어를 제거했으므로 런타임은 항상 기본값(auto)으로 고정
  return { stockMode: 'auto', newsMode: 'auto' }
  /*
  try {
    const { data, error } = await supabase
      .from('channels')
      .select('stock_mode,news_mode')
      .eq('youtube_channel_id', youtubeChannelId)
      .single()
    if (error) return { stockMode: 'auto', newsMode: 'auto' }
    const stockModeRaw = data?.stock_mode
    const newsModeRaw = data?.news_mode
    const stockMode: ChannelStockMode =
      stockModeRaw === 'off' || stockModeRaw === 'low_stock' || stockModeRaw === 'strict' || stockModeRaw === 'auto'
        ? stockModeRaw
        : 'auto'
    const newsMode: ChannelNewsMode =
      newsModeRaw === 'off' || newsModeRaw === 'strict' || newsModeRaw === 'auto'
        ? newsModeRaw
        : 'auto'
    return { stockMode, newsMode }
  } catch {
    return { stockMode: 'auto', newsMode: 'auto' }
  }
  */
}

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length !== headers.length) continue
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j]
    rows.push(row)
  }
  return rows
}

function toTaxonomyRows(rows: Record<string, string>[]): TaxonomyRow[] {
  return rows
    .map((row) => ({
      taxonomy_id: row.taxonomy_id,
      sector: row.sector,
      category: row.category,
      subcategory: row.subcategory,
    }))
    .filter((row) =>
      Boolean(row.taxonomy_id && row.sector && row.category && row.subcategory)
    )
}

function toTaxonomyIndustryRows(rows: Record<string, string>[]): TaxonomyIndustryRow[] {
  return rows
    .map((row) => ({
      taxonomy_id: row.taxonomy_id,
      subindustry_id: row.subindustry_id,
    }))
    .filter((row) => Boolean(row.taxonomy_id && row.subindustry_id))
}

function toStockExampleRows(rows: Record<string, string>[]): StockExampleRow[] {
  return rows
    .map((row) => ({
      ticker: row.ticker,
      company_name: row.company_name,
      subindustry_id: row.subindustry_id,
    }))
    .filter((row) => Boolean(row.ticker && row.company_name && row.subindustry_id))
}

async function loadTaxonomyData() {
  if (taxonomyCache) return taxonomyCache

  // 1) Supabase 우선
  try {
    const [taxonomyRes, mappingRes, stockRes] = await Promise.all([
      supabase.from('content_taxonomy').select('taxonomy_id,sector,category,subcategory'),
      supabase.from('taxonomy_industry_mapping').select('taxonomy_id,subindustry_id'),
      supabase.from('stock_example_mapping').select('ticker,company_name,subindustry_id'),
    ])
    const taxonomyRows = (taxonomyRes.data || []) as TaxonomyRow[]
    const mappingRows = (mappingRes.data || []) as TaxonomyIndustryRow[]
    const stockRows = (stockRes.data || []) as StockExampleRow[]
    if (taxonomyRows.length > 0 && mappingRows.length > 0 && stockRows.length > 0) {
      taxonomyCache = { taxonomyRows, mappingRows, stockRows }
      return taxonomyCache
    }
  } catch {}

  // 2) 로컬 CSV fallback
  const base = path.join(process.cwd(), 'taxonomy_assets')
  const [taxonomyCsv, mappingCsv, stockCsv] = await Promise.all([
    fs.readFile(path.join(base, 'content_taxonomy.csv'), 'utf-8').catch(() => ''),
    fs.readFile(path.join(base, 'taxonomy_industry_mapping.csv'), 'utf-8').catch(() => ''),
    fs.readFile(path.join(base, 'stock_example_mapping.csv'), 'utf-8').catch(() => ''),
  ])
  taxonomyCache = {
    taxonomyRows: toTaxonomyRows(parseCsvRows(taxonomyCsv)),
    mappingRows: toTaxonomyIndustryRows(parseCsvRows(mappingCsv)),
    stockRows: toStockExampleRows(parseCsvRows(stockCsv)),
  }
  return taxonomyCache
}

function inferMarketFromTicker(ticker: string): StockSuggestion['market'] | null {
  if (/^\d{6}$/.test(ticker)) return 'KOSPI'
  if (ticker.endsWith('.HK')) return 'HKEX'
  if (ticker.endsWith('.T')) return 'TSE'
  if (ticker.endsWith('.TW')) return 'TWSE'
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) return 'NASDAQ'
  return null
}

const STOCK_KEYWORD_MAP: Array<{
  keywords: string[]
  ticker: string
  name: string
  market: 'KOSPI' | 'KOSDAQ' | 'NYSE' | 'NASDAQ' | 'HKEX' | 'TSE' | 'TWSE'
}> = [
  // 반도체 — '삼성' 단독 제거(삼성생명·삼성화재 오매칭 방지), '삼성전자' 명칭 기준 유지
  { keywords: ['삼성전자', '갤럭시', '파운드리', 'hbm', 'dram', '반도체', '메모리반도체'], ticker: '005930', name: '삼성전자', market: 'KOSPI' },
  { keywords: ['sk하이닉스', '하이닉스', 'hbm', 'dram', 'nand', '반도체', '메모리'], ticker: '000660', name: 'SK하이닉스', market: 'KOSPI' },
  { keywords: ['한미반도체', 'tc본더', '반도체장비', 'hbm장비', '반도체패키징'], ticker: '042700', name: '한미반도체', market: 'KOSDAQ' },
  // AI / 플랫폼
  { keywords: ['naver', '네이버', '클로바', '하이퍼클로바', '인공지능', 'ai', 'llm', 'chatgpt', '챗gpt', '생성ai'], ticker: '035420', name: 'NAVER', market: 'KOSPI' },
  { keywords: ['카카오', '카카오톡', '카카오페이', '카카오뱅크', '카카오모빌리티'], ticker: '035720', name: '카카오', market: 'KOSPI' },
  // 자동차 / 모빌리티 — '자동차' 단독 제거(너무 포괄적)
  { keywords: ['현대차', '현대자동차', '아이오닉', '전기차', 'ev', '자율주행', '수소차'], ticker: '005380', name: '현대차', market: 'KOSPI' },
  { keywords: ['기아', '기아차', 'ev6', 'ev9', '카니발'], ticker: '000270', name: '기아', market: 'KOSPI' },
  // 배터리 / 이차전지
  { keywords: ['lg에너지솔루션', 'lges', '배터리', '이차전지', '2차전지', '원통형배터리'], ticker: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
  { keywords: ['삼성sdi', 'sdi', '전고체배터리', '파우치형배터리'], ticker: '006400', name: '삼성SDI', market: 'KOSPI' },
  { keywords: ['sk이노베이션', 'sk온', 'sk배터리'], ticker: '096770', name: 'SK이노베이션', market: 'KOSPI' },
  { keywords: ['에코프로비엠', '에코프로', '양극재', '이차전지소재', '에코프로그룹'], ticker: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
  { keywords: ['포스코', 'posco', '철강', '포스코홀딩스', '리튬'], ticker: '005490', name: 'POSCO홀딩스', market: 'KOSPI' },
  // 식품 원재료 / 담합 이슈
  { keywords: ['밀가루', '제분', '포도당', '전분당', '설탕', '식품원재료', '식품담합'], ticker: '097950', name: 'CJ제일제당', market: 'KOSPI' },
  { keywords: ['대한제분', '밀가루가격', '소맥분'], ticker: '001130', name: '대한제분', market: 'KOSPI' },
  { keywords: ['삼양사', '전분당', '원당', '당류'], ticker: '145990', name: '삼양사', market: 'KOSPI' },
  // 가전
  { keywords: ['lg전자', 'oled', '에어컨', '냉장고', '세탁기', '가전'], ticker: '066570', name: 'LG전자', market: 'KOSPI' },
  // 게임
  { keywords: ['크래프톤', '배틀그라운드', 'pubg', '게임'], ticker: '259960', name: '크래프톤', market: 'KOSPI' },
  { keywords: ['엔씨소프트', '리니지', 'nc소프트', '엔씨'], ticker: '036570', name: '엔씨소프트', market: 'KOSPI' },
  // 바이오 / 헬스케어
  { keywords: ['삼성바이오로직스', '바이오의약품', 'cmo', 'cdmo', '바이오'], ticker: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
  { keywords: ['셀트리온', '바이오시밀러', '램시마'], ticker: '068270', name: '셀트리온', market: 'KOSPI' },
  { keywords: ['유한양행', '렉라자', '폐암신약', '항암제'], ticker: '000100', name: '유한양행', market: 'KOSPI' },
  // 노후 / 실버 / 보험 — 노후준비·연금·실버산업 영상 커버
  { keywords: ['삼성생명', '생명보험', '연금', '노후', '노후준비', '은퇴', '퇴직연금', '실버', '고령', '노인빈곤'], ticker: '032830', name: '삼성생명', market: 'KOSPI' },
  { keywords: ['한화생명', '연금보험', '노후대비', '종신보험'], ticker: '088350', name: '한화생명', market: 'KOSPI' },
  { keywords: ['미래에셋증권', '미래에셋', '자산관리', '재테크', '투자', '펀드', 'isa', '퇴직연금'], ticker: '006800', name: '미래에셋증권', market: 'KOSPI' },
  { keywords: ['db손해보험', '손해보험', '실손보험', '건강보험'], ticker: '005830', name: 'DB손해보험', market: 'KOSPI' },
  // 금융 / 은행
  { keywords: ['kb금융', 'kb국민은행', '은행', '금리', '부동산', '주식시장', '금융지주', '대출'], ticker: '105560', name: 'KB금융', market: 'KOSPI' },
  { keywords: ['신한지주', '신한은행', '신한금융'], ticker: '055550', name: '신한지주', market: 'KOSPI' },
  { keywords: ['하나금융', '하나은행'], ticker: '086790', name: '하나금융지주', market: 'KOSPI' },
  // 엔터 / K-pop
  { keywords: ['하이브', 'bts', '방탄소년단', 'k팝', 'kpop', '아이돌', '케이팝'], ticker: '352820', name: 'HYBE', market: 'KOSPI' },
  { keywords: ['sm엔터', 'sm엔터테인먼트', '에스파', 'aespa', 'sm'], ticker: '041510', name: 'SM엔터테인먼트', market: 'KOSDAQ' },
  { keywords: ['jyp', 'jyp엔터', '트와이스', '스트레이키즈'], ticker: '035900', name: 'JYP엔터테인먼트', market: 'KOSDAQ' },
  // 통신
  { keywords: ['sk텔레콤', 'skt', '5g', 'sk브로드밴드'], ticker: '017670', name: 'SK텔레콤', market: 'KOSPI' },
  { keywords: ['kt그룹', 'kt통신', 'kt인터넷', 'kt ai'], ticker: '030200', name: 'KT', market: 'KOSPI' },
  { keywords: ['버라이즌', 'verizon', '무선통신', '이동통신'], ticker: 'VZ', name: 'Verizon', market: 'NYSE' },
  { keywords: ['at&t', 'att', 'atnt', '통신업계독점', '통신독점'], ticker: 'T', name: 'AT&T', market: 'NYSE' },
  { keywords: ['t-mobile', 'tmobile', '티모바일'], ticker: 'TMUS', name: 'T-Mobile US', market: 'NASDAQ' },
  // 유통 / 편의점
  { keywords: ['cu', '씨유', '편의점', 'bgf리테일', '특화점포', '러닝특화', 'gs25', '세븐일레븐'], ticker: '282330', name: 'BGF리테일', market: 'KOSPI' },
  { keywords: ['gs리테일', 'gs25', '편의점pb', '퀵커머스'], ticker: '007070', name: 'GS리테일', market: 'KOSPI' },
  // 건축 / 공간 / 전통 재해석
  { keywords: ['건축가', '건축', '도서관', '공공건축', '공간디자인', '리모델링', '설계'], ticker: '000720', name: '현대건설', market: 'KOSPI' },
  { keywords: ['한국전통', '전통건축', '한옥', '문화공간', '전통재해석', '한국미'], ticker: '009240', name: '한샘', market: 'KOSPI' },
  { keywords: ['도시개발', '복합개발', '개발사업'], ticker: '294870', name: 'HDC현대산업개발', market: 'KOSPI' },
  // 주거 / 부동산 이주
  { keywords: ['부동산', '주택', '집값', '아파트', '청약', '분양', '재개발', '재건축', '전세', '월세', '이사', '인서울', '탈서울', '경기도'], ticker: '000720', name: '현대건설', market: 'KOSPI' },
  { keywords: ['주거', '인테리어', '리모델링', '신혼집', '이사가구'], ticker: '009240', name: '한샘', market: 'KOSPI' },
  { keywords: ['창호', '리모델링자재', '건자재', '주택개보수'], ticker: '108670', name: 'LX하우시스', market: 'KOSPI' },
  { keywords: ['주택공급', '도시정비', '재개발', '재건축', '복합개발'], ticker: '294870', name: 'HDC현대산업개발', market: 'KOSPI' },
  { keywords: ['건설주', '주택경기', '수도권공급', '신도시'], ticker: '006360', name: 'GS건설', market: 'KOSPI' },
  { keywords: ['건설사', '주택사업', '분양시장', '주거수요'], ticker: '375500', name: 'DL이앤씨', market: 'KOSPI' },
  // 명품 / 럭셔리 리테일
  { keywords: ['명품', '럭셔리', '하이엔드', '명품매장', '브랜드매장', '프리미엄브랜드'], ticker: 'TPR', name: 'Tapestry', market: 'NYSE' },
  { keywords: ['백화점명품', '명품관', '럭셔리유통', '신세계백화점'], ticker: '004170', name: '신세계', market: 'KOSPI' },
  // 식음료 / 음료 / 밀크티
  { keywords: ['밀크티', '버블티', '음료', '음료브랜드', '식음료', '공차'], ticker: '005300', name: '롯데칠성', market: 'KOSPI' },
  { keywords: ['차백도', '헤이티', 'chagee', '중국밀크티', '중국음료', '중국식음료', '중국브랜드'], ticker: '2150.HK', name: 'Nayuki', market: 'HKEX' },
  { keywords: ['홍콩주식', '홍콩브랜드', '중화권브랜드'], ticker: '9633.HK', name: 'Nongfu Spring', market: 'HKEX' },
  { keywords: ['일본음료', '일본브랜드', '일본밀크티'], ticker: '2587.T', name: 'Suntory Beverage & Food', market: 'TSE' },
  { keywords: ['대만음료', '대만브랜드', '대만밀크티'], ticker: '1216.TW', name: 'Uni-President', market: 'TWSE' },
  { keywords: ['코카콜라', 'cocacola', 'coke', '탄산음료'], ticker: 'KO', name: 'Coca-Cola', market: 'NYSE' },
  { keywords: ['펩시', 'pepsi', 'pepsico'], ticker: 'PEP', name: 'PepsiCo', market: 'NASDAQ' },
  { keywords: ['스타벅스', 'starbucks', '커피프랜차이즈'], ticker: 'SBUX', name: 'Starbucks', market: 'NASDAQ' },
  { keywords: ['동서식품', '맥심', '카누', '커피믹스'], ticker: '026960', name: '동서', market: 'KOSPI' },
  // 방산 / 항공
  { keywords: ['방산', '무기', 'k2전차', 'k9자주포', '방위산업', '군수'], ticker: '012450', name: '한화에어로스페이스', market: 'KOSPI' },
  { keywords: ['한국항공우주', 'kai', '항공기', 'fa50', 'kf21'], ticker: '047810', name: '한국항공우주', market: 'KOSPI' },
  { keywords: ['러시아', '우크라이나', '돈바스', '푸틴', '전쟁', '군사긴장', '확전', '휴전협상'], ticker: '079550', name: 'LIG넥스원', market: 'KOSPI' },
  { keywords: ['러시아', '우크라이나', '돈바스', '푸틴', '나토', '군비', '군수'], ticker: '012450', name: '한화에어로스페이스', market: 'KOSPI' },
  { keywords: ['러시아', '우크라이나', '돈바스', '포탄', '탄약', '군사충돌'], ticker: '103140', name: '풍산', market: 'KOSPI' },
  // 중국 로봇/공장 자동화
  { keywords: ['중국로봇', '중국휴머노이드', '중국산업로봇', '유비테크', 'ubtech', '중국공장자동화'], ticker: '9880.HK', name: 'UBTECH Robotics', market: 'HKEX' },
  { keywords: ['샤오미', 'xiaomi', '중국로봇생태계', '중국제조자동화'], ticker: '1810.HK', name: 'Xiaomi', market: 'HKEX' },
  { keywords: ['비야디', 'byd', '중국공장', '중국자동화공장', '중국전기차공장'], ticker: '1211.HK', name: 'BYD', market: 'HKEX' },
  // 원전 / 에너지
  { keywords: ['원전', '원자력', '핵발전', 'smr', '소형원전', '두산에너빌리티'], ticker: '034020', name: '두산에너빌리티', market: 'KOSPI' },
  // 글로벌 빅테크 / AI
  { keywords: ['엔비디아', 'nvidia', '젠슨황', 'cuda', 'gpu', 'ai반도체'], ticker: 'NVDA', name: 'NVIDIA', market: 'NASDAQ' },
  { keywords: ['테슬라', 'tesla', '일론', '머스크', 'robotaxi', '옵티머스', '모델y'], ticker: 'TSLA', name: 'Tesla', market: 'NASDAQ' },
  { keywords: ['마이크로소프트', 'microsoft', 'msft', 'azure', '오픈ai', 'copilot'], ticker: 'MSFT', name: 'Microsoft', market: 'NASDAQ' },
  { keywords: ['알파벳', 'google', '구글', '유튜브', 'gemini', 'waymo'], ticker: 'GOOGL', name: 'Alphabet', market: 'NASDAQ' },
  { keywords: ['애플', 'apple', '아이폰', 'ios', '맥북'], ticker: 'AAPL', name: 'Apple', market: 'NASDAQ' },
  { keywords: ['아마존', 'amazon', 'aws', '프라임'], ticker: 'AMZN', name: 'Amazon', market: 'NASDAQ' },
  { keywords: ['메타', 'meta', '페이스북', 'instagram', '인스타그램'], ticker: 'META', name: 'Meta Platforms', market: 'NASDAQ' },
  // 우주 / 항공
  { keywords: ['spacex', '스타링크', 'starlink', '우주개발', '로켓발사'], ticker: 'RKLB', name: 'Rocket Lab', market: 'NASDAQ' },
  { keywords: ['보잉', 'boeing', '항공기제조'], ticker: 'BA', name: 'Boeing', market: 'NYSE' },
  { keywords: ['천문학', '외계', '외계생명체', '외계신호', 'seti', '우주신호', '우주관측', '전파망원경'], ticker: 'RKLB', name: 'Rocket Lab', market: 'NASDAQ' },
  { keywords: ['딥스페이스', '우주통신', '심우주', 'satcom', '위성데이터'], ticker: 'IRDM', name: 'Iridium Communications', market: 'NASDAQ' },
]

function findRelatedStocks(text: string, max = 6): StockSuggestion[] {
  const normalized = text.toLowerCase().replace(/\s+/g, '')
  const scored: Array<{ score: number; stock: Omit<StockSuggestion, 'is_core'> }> = []

  for (const entry of STOCK_KEYWORD_MAP) {
    const score = entry.keywords.reduce((acc, kw) => (
      normalized.includes(kw.toLowerCase().replace(/\s+/g, '')) ? acc + 1 : acc
    ), 0)
    if (score > 0) {
      scored.push({
        score,
        stock: { ticker: entry.ticker, name: entry.name, market: entry.market },
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)

  const deduped: Omit<StockSuggestion, 'is_core'>[] = []
  const seen = new Set<string>()
  for (const item of scored) {
    if (seen.has(item.stock.ticker)) continue
    seen.add(item.stock.ticker)
    deduped.push(item.stock)
    if (deduped.length >= max) break
  }

  return deduped.map((stock, idx) => ({ ...stock, is_core: idx === 0 }))
}

function mergeStockGroups(groups: Array<StockSuggestion[] | null | undefined>, max = 6): StockSuggestion[] {
  const merged: StockSuggestion[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    if (!group) continue
    for (const stock of group) {
      if (!stock?.ticker || seen.has(stock.ticker)) continue
      seen.add(stock.ticker)
      merged.push({ ...stock, is_core: false })
      if (merged.length >= max) break
    }
    if (merged.length >= max) break
  }
  if (merged.length === 0) return []
  return merged.map((s, idx) => ({ ...s, is_core: idx === 0 }))
}

const CORE_RELATED_STOCKS: Record<string, Array<Omit<StockSuggestion, 'is_core'>>> = {
  TSLA: [
    { ticker: 'RIVN', name: 'Rivian', market: 'NASDAQ' },
    { ticker: 'NIO', name: 'NIO', market: 'NYSE' },
    { ticker: 'NVDA', name: 'NVIDIA', market: 'NASDAQ' },
    { ticker: '005380', name: '현대차', market: 'KOSPI' },
    { ticker: '000270', name: '기아', market: 'KOSPI' },
    { ticker: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
  ],
  NVDA: [
    { ticker: 'AMD', name: 'Advanced Micro Devices', market: 'NASDAQ' },
    { ticker: 'AVGO', name: 'Broadcom', market: 'NASDAQ' },
    { ticker: 'TSM', name: 'Taiwan Semiconductor', market: 'NYSE' },
    { ticker: '005930', name: '삼성전자', market: 'KOSPI' },
    { ticker: '000660', name: 'SK하이닉스', market: 'KOSPI' },
  ],
  RKLB: [
    { ticker: 'LMT', name: 'Lockheed Martin', market: 'NYSE' },
    { ticker: 'BA', name: 'Boeing', market: 'NYSE' },
    { ticker: '047810', name: '한국항공우주', market: 'KOSPI' },
    { ticker: '012450', name: '한화에어로스페이스', market: 'KOSPI' },
  ],
  MSFT: [
    { ticker: 'GOOGL', name: 'Alphabet', market: 'NASDAQ' },
    { ticker: 'AMZN', name: 'Amazon', market: 'NASDAQ' },
    { ticker: 'META', name: 'Meta Platforms', market: 'NASDAQ' },
    { ticker: 'NVDA', name: 'NVIDIA', market: 'NASDAQ' },
    { ticker: '035420', name: 'NAVER', market: 'KOSPI' },
  ],
  '005300': [
    { ticker: '9633.HK', name: 'Nongfu Spring', market: 'HKEX' },
    { ticker: '2150.HK', name: 'Nayuki', market: 'HKEX' },
    { ticker: '2587.T', name: 'Suntory Beverage & Food', market: 'TSE' },
    { ticker: '1216.TW', name: 'Uni-President', market: 'TWSE' },
    { ticker: 'KO', name: 'Coca-Cola', market: 'NYSE' },
    { ticker: 'PEP', name: 'PepsiCo', market: 'NASDAQ' },
  ],
  KO: [
    { ticker: '9633.HK', name: 'Nongfu Spring', market: 'HKEX' },
    { ticker: '2587.T', name: 'Suntory Beverage & Food', market: 'TSE' },
    { ticker: '1216.TW', name: 'Uni-President', market: 'TWSE' },
    { ticker: 'PEP', name: 'PepsiCo', market: 'NASDAQ' },
    { ticker: 'SBUX', name: 'Starbucks', market: 'NASDAQ' },
    { ticker: '005300', name: '롯데칠성', market: 'KOSPI' },
  ],
  '9633.HK': [
    { ticker: '2150.HK', name: 'Nayuki', market: 'HKEX' },
    { ticker: '2587.T', name: 'Suntory Beverage & Food', market: 'TSE' },
    { ticker: '1216.TW', name: 'Uni-President', market: 'TWSE' },
    { ticker: 'KO', name: 'Coca-Cola', market: 'NYSE' },
    { ticker: '005300', name: '롯데칠성', market: 'KOSPI' },
  ],
  '282330': [
    { ticker: '007070', name: 'GS리테일', market: 'KOSPI' },
    { ticker: '139480', name: '이마트', market: 'KOSPI' },
    { ticker: 'NKE', name: 'Nike', market: 'NYSE' },
    { ticker: 'TPR', name: 'Tapestry', market: 'NYSE' },
    { ticker: '004170', name: '신세계', market: 'KOSPI' },
  ],
  TPR: [
    { ticker: 'CPRI', name: 'Capri Holdings', market: 'NYSE' },
    { ticker: 'RL', name: 'Ralph Lauren', market: 'NYSE' },
    { ticker: 'PVH', name: 'PVH', market: 'NYSE' },
    { ticker: '004170', name: '신세계', market: 'KOSPI' },
    { ticker: '282330', name: 'BGF리테일', market: 'KOSPI' },
  ],
  '000720': [
    { ticker: '294870', name: 'HDC현대산업개발', market: 'KOSPI' },
    { ticker: '006360', name: 'GS건설', market: 'KOSPI' },
    { ticker: '375500', name: 'DL이앤씨', market: 'KOSPI' },
    { ticker: '009240', name: '한샘', market: 'KOSPI' },
    { ticker: '108670', name: 'LX하우시스', market: 'KOSPI' },
  ],
}

const DEFAULT_SUPPLEMENT_STOCKS: Array<Omit<StockSuggestion, 'is_core'>> = [
  { ticker: 'NVDA', name: 'NVIDIA', market: 'NASDAQ' },
  { ticker: 'TSLA', name: 'Tesla', market: 'NASDAQ' },
  { ticker: 'GOOGL', name: 'Alphabet', market: 'NASDAQ' },
  { ticker: '005930', name: '삼성전자', market: 'KOSPI' },
  { ticker: '000660', name: 'SK하이닉스', market: 'KOSPI' },
]

const SCIENCE_SUPPLEMENT_STOCKS: Array<Omit<StockSuggestion, 'is_core'>> = [
  { ticker: 'RKLB', name: 'Rocket Lab', market: 'NASDAQ' },
  { ticker: 'IRDM', name: 'Iridium Communications', market: 'NASDAQ' },
  { ticker: 'ASTS', name: 'AST SpaceMobile', market: 'NASDAQ' },
  { ticker: 'LMT', name: 'Lockheed Martin', market: 'NYSE' },
  { ticker: 'BA', name: 'Boeing', market: 'NYSE' },
  { ticker: '047810', name: '한국항공우주', market: 'KOSPI' },
]

const SCIENCE_TOPIC_KEYWORDS = [
  '과학', '천문학', '천체', '우주', '외계', '물리', '화학', '생물', '지구과학',
  '지질', '지진', '핵융합', '원자력', '양자', '로봇', '인공지능', '통계', '데이터사이언스',
  '신경과학', '뇌과학', '기후', '환경과학', '생명체', '신호포착',
]

const LOW_STOCK_TOPIC_KEYWORDS = [
  '아프리카', '원조', '공적개발원조', 'oda', '기부금', '국제개발', '개발원조',
  '원조효과', '거버넌스', '제도경제학', '부패', '원조피로', '역사를보다',
]

const HUMANITIES_LOW_STOCK_KEYWORDS = [
  '철학', '철학을보다', '행복의기원', '행복', '삶의의미', '윤리학', '인문학',
  '고대사상', '인간본성', '사유', '존재론', '형이상학', '도덕철학',
]

function ensureMinStocks(stocks: StockSuggestion[], minCount = 6): StockSuggestion[] {
  if (stocks.length === 0 || stocks.length >= minCount) return stocks

  const coreTicker = stocks[0].ticker
  const supplement = CORE_RELATED_STOCKS[coreTicker] || []
  const merged: StockSuggestion[] = [...stocks]
  const seen = new Set(stocks.map(s => s.ticker))

  for (const stock of [...supplement, ...DEFAULT_SUPPLEMENT_STOCKS]) {
    if (merged.length >= minCount) break
    if (seen.has(stock.ticker)) continue
    seen.add(stock.ticker)
    merged.push({ ...stock, is_core: false })
  }

  return merged.map((item, idx) => ({ ...item, is_core: idx === 0 }))
}

function ensureMinStocksFromList(
  stocks: StockSuggestion[],
  supplement: Array<Omit<StockSuggestion, 'is_core'>>,
  minCount = 6
): StockSuggestion[] {
  if (stocks.length === 0 || stocks.length >= minCount) return stocks
  const merged: StockSuggestion[] = [...stocks]
  const seen = new Set(stocks.map((s) => s.ticker))

  for (const stock of supplement) {
    if (merged.length >= minCount) break
    if (seen.has(stock.ticker)) continue
    seen.add(stock.ticker)
    merged.push({ ...stock, is_core: false })
  }

  return merged.map((item, idx) => ({ ...item, is_core: idx === 0 }))
}

const SECTOR_RULES: Array<{
  sector: string
  keywords: string[]
  stocks: Array<Omit<StockSuggestion, 'is_core'>>
}> = [
  {
    sector: 'education',
    keywords: ['수능', '입시', '모의고사', '영어', '국어', '수학', '학원', '사교육', '교육정책', '내신', '정시', '수시', 'ebs'],
    stocks: [
      { ticker: '215200', name: '메가스터디교육', market: 'KOSDAQ' },
      { ticker: '053290', name: 'NE능률', market: 'KOSDAQ' },
      { ticker: '100220', name: '비상교육', market: 'KOSDAQ' },
      { ticker: '095720', name: '웅진씽크빅', market: 'KOSPI' },
      { ticker: '289010', name: '아이스크림에듀', market: 'KOSDAQ' },
      { ticker: '067280', name: '멀티캠퍼스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'travel',
    keywords: ['여행', '관광', '항공권', '호텔', '면세', '출국', '인바운드'],
    stocks: [
      { ticker: '039130', name: '하나투어', market: 'KOSPI' },
      { ticker: '080160', name: '모두투어', market: 'KOSDAQ' },
      { ticker: '089590', name: '제주항공', market: 'KOSPI' },
      { ticker: '272450', name: '진에어', market: 'KOSPI' },
      { ticker: '008770', name: '호텔신라', market: 'KOSPI' },
    ],
  },
  {
    sector: 'real_estate_housing',
    keywords: [
      '부동산', '주택', '집값', '아파트', '청약', '분양', '재개발', '재건축',
      '전세', '월세', '이사', '인서울', '탈서울', '서울집값', '경기도이사', '수도권이주',
      '주거이동', '주거수요', '주택공급',
    ],
    stocks: [
      { ticker: '000720', name: '현대건설', market: 'KOSPI' },
      { ticker: '006360', name: 'GS건설', market: 'KOSPI' },
      { ticker: '375500', name: 'DL이앤씨', market: 'KOSPI' },
      { ticker: '294870', name: 'HDC현대산업개발', market: 'KOSPI' },
      { ticker: '009240', name: '한샘', market: 'KOSPI' },
      { ticker: '108670', name: 'LX하우시스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'healthcare',
    keywords: [
      '암세포', '암치료', '항암', '항암제', '종양', '면역항암', '암환자',
      '병원', '의사', '원장', '치료', '건강', '식이요법', '영양', '예방의학',
    ],
    stocks: [
      { ticker: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
      { ticker: '068270', name: '셀트리온', market: 'KOSPI' },
      { ticker: '196170', name: '알테오젠', market: 'KOSDAQ' },
      { ticker: '000100', name: '유한양행', market: 'KOSPI' },
      { ticker: '128940', name: '한미약품', market: 'KOSPI' },
      { ticker: '069620', name: '대웅제약', market: 'KOSPI' },
      { ticker: 'JNJ', name: 'Johnson & Johnson', market: 'NYSE' },
    ],
  },
  {
    sector: 'defense_geopolitics',
    keywords: [
      '이란', '기뢰', '호르무즈', '해협봉쇄', '중동', '전면전', '군사충돌',
      '공습', '미사일', '공격', '확전', '미해군', '전쟁위기', '해상봉쇄',
      '러시아', '우크라이나', '돈바스', '푸틴', '크렘린', '나토', '군비경쟁', '휴전협상',
    ],
    stocks: [
      { ticker: '012450', name: '한화에어로스페이스', market: 'KOSPI' },
      { ticker: '079550', name: 'LIG넥스원', market: 'KOSPI' },
      { ticker: '047810', name: '한국항공우주', market: 'KOSPI' },
      { ticker: '103140', name: '풍산', market: 'KOSPI' },
      { ticker: 'LMT', name: 'Lockheed Martin', market: 'NYSE' },
      { ticker: 'RTX', name: 'RTX', market: 'NYSE' },
    ],
  },
  {
    sector: 'energy_oil',
    keywords: ['유가', '원유', '정유', '석유', '가스', 'opec', '천연가스', '에너지위기'],
    stocks: [
      { ticker: '010950', name: 'S-Oil', market: 'KOSPI' },
      { ticker: '267250', name: 'HD현대', market: 'KOSPI' },
      { ticker: 'XOM', name: 'Exxon Mobil', market: 'NYSE' },
      { ticker: 'CVX', name: 'Chevron', market: 'NYSE' },
      { ticker: 'SHEL', name: 'Shell', market: 'NYSE' },
    ],
  },
  {
    sector: 'crypto_blockchain',
    keywords: ['비트코인', '이더리움', '가상자산', '암호화폐', '코인', '블록체인', 'etf승인'],
    stocks: [
      { ticker: 'COIN', name: 'Coinbase', market: 'NASDAQ' },
      { ticker: 'MSTR', name: 'MicroStrategy', market: 'NASDAQ' },
      { ticker: 'SQ', name: 'Block', market: 'NYSE' },
      { ticker: '035420', name: 'NAVER', market: 'KOSPI' },
      { ticker: '035720', name: '카카오', market: 'KOSPI' },
    ],
  },
  {
    sector: 'space_science_astronomy',
    keywords: [
      '천문학', '천체물리', '우주과학', '외계', '외계생명체', '외계문명', '외계신호',
      '신호포착', '우주신호', 'seti', '전파망원경', '우주망원경', '심우주',
    ],
    stocks: [
      { ticker: 'RKLB', name: 'Rocket Lab', market: 'NASDAQ' },
      { ticker: 'IRDM', name: 'Iridium Communications', market: 'NASDAQ' },
      { ticker: 'ASTS', name: 'AST SpaceMobile', market: 'NASDAQ' },
      { ticker: 'LMT', name: 'Lockheed Martin', market: 'NYSE' },
      { ticker: 'BA', name: 'Boeing', market: 'NYSE' },
      { ticker: '047810', name: '한국항공우주', market: 'KOSPI' },
    ],
  },
  {
    sector: 'physics_quantum',
    keywords: [
      '물리학', '양자', '양자컴퓨터', '양자암호', '초전도', '양자역학', '입자물리', '핵물리',
      'quantum', 'qubit', 'particle physics',
    ],
    stocks: [
      { ticker: 'IBM', name: 'IBM', market: 'NYSE' },
      { ticker: 'GOOGL', name: 'Alphabet', market: 'NASDAQ' },
      { ticker: 'IONQ', name: 'IonQ', market: 'NYSE' },
      { ticker: 'RGTI', name: 'Rigetti Computing', market: 'NASDAQ' },
      { ticker: 'MSFT', name: 'Microsoft', market: 'NASDAQ' },
      { ticker: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'chemistry_materials',
    keywords: [
      '화학', '유기화학', '무기화학', '촉매', '고분자', '소재화학', '정밀화학',
      '리튬화학', '전해질', '배터리소재', '신소재화학',
    ],
    stocks: [
      { ticker: '051910', name: 'LG화학', market: 'KOSPI' },
      { ticker: '011170', name: '롯데케미칼', market: 'KOSPI' },
      { ticker: '003670', name: '포스코퓨처엠', market: 'KOSPI' },
      { ticker: '247540', name: '에코프로비엠', market: 'KOSDAQ' },
      { ticker: 'ALB', name: 'Albemarle', market: 'NYSE' },
      { ticker: 'SQM', name: 'SQM', market: 'NYSE' },
    ],
  },
  {
    sector: 'biology_biotech',
    keywords: [
      '생물학', '분자생물학', '유전학', '유전자', '유전체', '단백질', '세포생물학',
      '바이오테크', '합성생물학', 'crispr', 'gene editing',
    ],
    stocks: [
      { ticker: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
      { ticker: '068270', name: '셀트리온', market: 'KOSPI' },
      { ticker: '196170', name: '알테오젠', market: 'KOSDAQ' },
      { ticker: 'VRTX', name: 'Vertex Pharmaceuticals', market: 'NASDAQ' },
      { ticker: 'REGN', name: 'Regeneron', market: 'NASDAQ' },
      { ticker: 'CRSP', name: 'CRISPR Therapeutics', market: 'NASDAQ' },
    ],
  },
  {
    sector: 'neuroscience_medicaltech',
    keywords: [
      '신경과학', '뇌과학', '뇌공학', '뇌신호', 'neural', 'bci', 'brain computer interface',
      '뉴럴링크', '치매연구', '인지과학',
    ],
    stocks: [
      { ticker: 'MDT', name: 'Medtronic', market: 'NYSE' },
      { ticker: 'ABT', name: 'Abbott Laboratories', market: 'NYSE' },
      { ticker: 'ISRG', name: 'Intuitive Surgical', market: 'NASDAQ' },
      { ticker: 'SYK', name: 'Stryker', market: 'NYSE' },
      { ticker: 'JNJ', name: 'Johnson & Johnson', market: 'NYSE' },
      { ticker: '207940', name: '삼성바이오로직스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'earth_science_geology',
    keywords: [
      '지구과학', '지질학', '판구조', '지진', '화산', '광물', '희토류',
      'resource geology', 'earth science',
    ],
    stocks: [
      { ticker: 'FCX', name: 'Freeport-McMoRan', market: 'NYSE' },
      { ticker: 'RIO', name: 'Rio Tinto', market: 'NYSE' },
      { ticker: 'BHP', name: 'BHP Group', market: 'NYSE' },
      { ticker: '005490', name: 'POSCO홀딩스', market: 'KOSPI' },
      { ticker: '010130', name: '고려아연', market: 'KOSPI' },
      { ticker: '267250', name: 'HD현대', market: 'KOSPI' },
    ],
  },
  {
    sector: 'climate_environment',
    keywords: [
      '기후변화', '환경과학', '탄소중립', '넷제로', '온실가스', '배출권', '친환경',
      '재활용기술', '환경규제', 'esg',
    ],
    stocks: [
      { ticker: 'TSLA', name: 'Tesla', market: 'NASDAQ' },
      { ticker: 'ENPH', name: 'Enphase Energy', market: 'NASDAQ' },
      { ticker: 'NEE', name: 'NextEra Energy', market: 'NYSE' },
      { ticker: '009830', name: '한화솔루션', market: 'KOSPI' },
      { ticker: '373220', name: 'LG에너지솔루션', market: 'KOSPI' },
      { ticker: '096770', name: 'SK이노베이션', market: 'KOSPI' },
    ],
  },
  {
    sector: 'energy_nuclear_fusion',
    keywords: [
      '핵융합', 'fusion', 'tokamak', '플라즈마', '원자력', 'smr', '소형원전',
      '핵연료', '전력망',
    ],
    stocks: [
      { ticker: '034020', name: '두산에너빌리티', market: 'KOSPI' },
      { ticker: '015760', name: '한국전력', market: 'KOSPI' },
      { ticker: 'BWXT', name: 'BWX Technologies', market: 'NYSE' },
      { ticker: 'CCJ', name: 'Cameco', market: 'NYSE' },
      { ticker: 'GEV', name: 'GE Vernova', market: 'NYSE' },
      { ticker: '6501.T', name: 'Hitachi', market: 'TSE' },
    ],
  },
  {
    sector: 'robotics_mechatronics',
    keywords: [
      '로봇공학', '휴머노이드', '산업로봇', '자율로봇', '메카트로닉스',
      'robotics', 'robot', '자동화공학',
      '중국로봇', '중국휴머노이드', '중국산업로봇', '중국공장', '중국제조업', 'china robot',
    ],
    stocks: [
      { ticker: '9880.HK', name: 'UBTECH Robotics', market: 'HKEX' },
      { ticker: '1810.HK', name: 'Xiaomi', market: 'HKEX' },
      { ticker: '1211.HK', name: 'BYD', market: 'HKEX' },
      { ticker: 'TSLA', name: 'Tesla', market: 'NASDAQ' },
      { ticker: 'ABB', name: 'ABB', market: 'NYSE' },
      { ticker: 'ISRG', name: 'Intuitive Surgical', market: 'NASDAQ' },
      { ticker: '6954.T', name: 'Fanuc', market: 'TSE' },
      { ticker: '6146.T', name: 'Disco', market: 'TSE' },
      { ticker: '454910', name: '두산로보틱스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'computer_science_ai',
    keywords: [
      '컴퓨터공학', '알고리즘', '인공지능', '머신러닝', '딥러닝', 'llm', '생성ai',
      '컴파일러', '데이터구조', 'software engineering',
    ],
    stocks: [
      { ticker: 'NVDA', name: 'NVIDIA', market: 'NASDAQ' },
      { ticker: 'MSFT', name: 'Microsoft', market: 'NASDAQ' },
      { ticker: 'GOOGL', name: 'Alphabet', market: 'NASDAQ' },
      { ticker: 'AMZN', name: 'Amazon', market: 'NASDAQ' },
      { ticker: '035420', name: 'NAVER', market: 'KOSPI' },
      { ticker: '005930', name: '삼성전자', market: 'KOSPI' },
    ],
  },
  {
    sector: 'cybersecurity_forensics',
    keywords: [
      '정보보안', '사이버보안', '해킹', '백도어', '랜섬웨어', '취약점', '제로데이',
      '디지털포렌식', 'malware', 'threat intelligence',
    ],
    stocks: [
      { ticker: 'CRWD', name: 'CrowdStrike', market: 'NASDAQ' },
      { ticker: 'PANW', name: 'Palo Alto Networks', market: 'NASDAQ' },
      { ticker: 'FTNT', name: 'Fortinet', market: 'NASDAQ' },
      { ticker: 'ZS', name: 'Zscaler', market: 'NASDAQ' },
      { ticker: '053800', name: '안랩', market: 'KOSDAQ' },
      { ticker: '049470', name: 'SGA', market: 'KOSDAQ' },
    ],
  },
  {
    sector: 'statistics_data_science',
    keywords: [
      '통계학', '데이터사이언스', '확률', '회귀분석', '시계열', '계량경제',
      '모델링', '예측모델', '빅데이터분석',
    ],
    stocks: [
      { ticker: 'PLTR', name: 'Palantir', market: 'NASDAQ' },
      { ticker: 'SNOW', name: 'Snowflake', market: 'NYSE' },
      { ticker: 'DDOG', name: 'Datadog', market: 'NASDAQ' },
      { ticker: 'MDB', name: 'MongoDB', market: 'NASDAQ' },
      { ticker: '035420', name: 'NAVER', market: 'KOSPI' },
      { ticker: '035720', name: '카카오', market: 'KOSPI' },
    ],
  },
  {
    sector: 'satellite_telecom',
    keywords: [
      '스페이스x', 'spacex', '스타링크', 'starlink', '위성통신', '위성네트워크',
      '저궤도', 'leo', '버라이즌', 'verizon', 'at&t', 'att', 'atnt', '통신업계', '통신독점',
    ],
    stocks: [
      { ticker: 'RKLB', name: 'Rocket Lab', market: 'NASDAQ' },
      { ticker: 'ASTS', name: 'AST SpaceMobile', market: 'NASDAQ' },
      { ticker: 'IRDM', name: 'Iridium Communications', market: 'NASDAQ' },
      { ticker: 'VZ', name: 'Verizon', market: 'NYSE' },
      { ticker: 'T', name: 'AT&T', market: 'NYSE' },
      { ticker: '017670', name: 'SK텔레콤', market: 'KOSPI' },
    ],
  },
  {
    sector: 'shipping_logistics',
    keywords: ['해운', '운임', '물류', '컨테이너', '벌크선', '홍해', '수에즈', '항만'],
    stocks: [
      { ticker: '011200', name: 'HMM', market: 'KOSPI' },
      { ticker: '028670', name: '팬오션', market: 'KOSPI' },
      { ticker: 'UPS', name: 'UPS', market: 'NYSE' },
      { ticker: 'FDX', name: 'FedEx', market: 'NYSE' },
      { ticker: 'KEX', name: 'Kirby', market: 'NYSE' },
    ],
  },
  {
    sector: 'convenience_retail',
    keywords: ['편의점', 'cu', '씨유', 'gs25', '세븐일레븐', '점포확대', '특화점포', 'pb상품', '근거리유통', '러닝'],
    stocks: [
      { ticker: '282330', name: 'BGF리테일', market: 'KOSPI' },
      { ticker: '007070', name: 'GS리테일', market: 'KOSPI' },
      { ticker: '139480', name: '이마트', market: 'KOSPI' },
      { ticker: 'NKE', name: 'Nike', market: 'NYSE' },
      { ticker: 'WMT', name: 'Walmart', market: 'NYSE' },
      { ticker: 'TGT', name: 'Target', market: 'NYSE' },
    ],
  },
  {
    sector: 'luxury_retail',
    keywords: ['명품', '럭셔리', '하이엔드', '명품매장', '쇼윈도', '매장설계', '플래그십', '브랜드경험', '프리미엄소비'],
    stocks: [
      { ticker: 'TPR', name: 'Tapestry', market: 'NYSE' },
      { ticker: 'CPRI', name: 'Capri Holdings', market: 'NYSE' },
      { ticker: 'RL', name: 'Ralph Lauren', market: 'NYSE' },
      { ticker: 'PVH', name: 'PVH', market: 'NYSE' },
      { ticker: '004170', name: '신세계', market: 'KOSPI' },
      { ticker: '023530', name: '롯데쇼핑', market: 'KOSPI' },
    ],
  },
  {
    sector: 'architecture_design',
    keywords: ['건축가', '건축', '도서관', '공공건축', '건축설계', '리모델링', '공간디자인', '문화공간', '아키텍처'],
    stocks: [
      { ticker: '000720', name: '현대건설', market: 'KOSPI' },
      { ticker: '006360', name: 'GS건설', market: 'KOSPI' },
      { ticker: '375500', name: 'DL이앤씨', market: 'KOSPI' },
      { ticker: '294870', name: 'HDC현대산업개발', market: 'KOSPI' },
      { ticker: '009240', name: '한샘', market: 'KOSPI' },
      { ticker: '108670', name: 'LX하우시스', market: 'KOSPI' },
    ],
  },
  {
    sector: 'korean_heritage',
    keywords: ['한국전통', '한옥', '전통미', '전통재해석', '문화재', '궁궐', '한지', '국악', '전통문화'],
    stocks: [
      { ticker: '009240', name: '한샘', market: 'KOSPI' },
      { ticker: '108670', name: 'LX하우시스', market: 'KOSPI' },
      { ticker: '001680', name: '대상', market: 'KOSPI' },
      { ticker: '069960', name: '현대백화점', market: 'KOSPI' },
      { ticker: '004170', name: '신세계', market: 'KOSPI' },
      { ticker: '005440', name: '현대그린푸드', market: 'KOSPI' },
    ],
  },
  {
    sector: 'competition_food_cartel',
    keywords: ['담합', '카르텔', '공정위', '공정거래위원회', '가격담합', '짜고치는', '밀가루', '설탕', '포도당', '전분당'],
    stocks: [
      { ticker: '097950', name: 'CJ제일제당', market: 'KOSPI' },
      { ticker: '001130', name: '대한제분', market: 'KOSPI' },
      { ticker: '145990', name: '삼양사', market: 'KOSPI' },
      { ticker: '271560', name: '오리온', market: 'KOSPI' },
      { ticker: '280360', name: '롯데웰푸드', market: 'KOSPI' },
      { ticker: '004370', name: '농심', market: 'KOSPI' },
    ],
  },
]

function inferSectorStocks(text: string, max = 6): StockSuggestion[] {
  const normalized = text.toLowerCase().replace(/\s+/g, '')
  const scored = SECTOR_RULES
    .map(rule => ({
      rule,
      score: rule.keywords.reduce((acc, kw) => (
        normalized.includes(kw.toLowerCase().replace(/\s+/g, '')) ? acc + 1 : acc
      ), 0),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return []

  const merged: Omit<StockSuggestion, 'is_core'>[] = []
  const seen = new Set<string>()
  for (const { rule } of scored.slice(0, 2)) {
    for (const stock of rule.stocks) {
      if (seen.has(stock.ticker)) continue
      seen.add(stock.ticker)
      merged.push(stock)
      if (merged.length >= max) break
    }
    if (merged.length >= max) break
  }

  return merged.map((stock, idx) => ({ ...stock, is_core: idx === 0 }))
}

function withGuaranteedFallback(stocks: StockSuggestion[], minCount = 6): StockSuggestion[] {
  if (stocks.length > 0) return stocks
  return DEFAULT_SUPPLEMENT_STOCKS
    .slice(0, minCount)
    .map((stock, idx) => ({ ...stock, is_core: idx === 0 }))
}

async function inferTaxonomyContext(text: string): Promise<TaxonomyContext | null> {
  const normalized = text.toLowerCase().replace(/\s+/g, '')
  const hit = TAXONOMY_RULES.find(rule =>
    rule.keywords.some(kw => normalized.includes(kw.toLowerCase().replace(/\s+/g, '')))
  )
  if (!hit) return null

  const { taxonomyRows } = await loadTaxonomyData()
  const matched = taxonomyRows.find(r =>
    r.sector === hit.target.sector &&
    r.category === hit.target.category &&
    r.subcategory === hit.target.subcategory
  )
  if (!matched) return null

  return {
    sector: matched.sector,
    category: matched.category,
    subcategory: matched.subcategory,
    taxonomyId: matched.taxonomy_id,
  }
}

async function inferStocksFromTaxonomy(text: string, max = 6): Promise<StockSuggestion[]> {
  const context = await inferTaxonomyContext(text)
  if (!context) return []

  const { mappingRows, stockRows } = await loadTaxonomyData()
  const subindustryIds = mappingRows
    .filter(r => r.taxonomy_id === context.taxonomyId)
    .map(r => r.subindustry_id)
  if (subindustryIds.length === 0) return []

  const mapped: StockSuggestion[] = []
  const seen = new Set<string>()
  for (const subId of subindustryIds) {
    for (const stock of stockRows.filter(s => s.subindustry_id === subId)) {
      if (seen.has(stock.ticker)) continue
      const market = inferMarketFromTicker(stock.ticker.toUpperCase())
      if (!market || !VALID_MARKET_SET.has(market)) continue
      seen.add(stock.ticker)
      mapped.push({
        ticker: stock.ticker.toUpperCase(),
        name: stock.company_name,
        market,
        is_core: false,
      })
      if (mapped.length >= max) break
    }
    if (mapped.length >= max) break
  }

  return mapped.map((s, idx) => ({ ...s, is_core: idx === 0 }))
}

function prioritizeCoreByTitle(stocks: StockSuggestion[], title: string): StockSuggestion[] {
  if (stocks.length === 0) return stocks

  const normalizedTitle = title.toLowerCase().replace(/\s+/g, '')
  const isOverseasMilkTeaTopic =
    normalizedTitle.includes('해외') &&
    ['밀크티', '버블티', '음료', '브랜드', '차백도', '헤이티', '차지']
      .some(kw => normalizedTitle.includes(kw))

  const isFoodCartelTopic =
    ['담합', '카르텔', '공정위', '공정거래위원회'].some(kw => normalizedTitle.includes(kw))
  const isStarlinkTelecomTopic =
    ['스타링크', 'starlink', '스페이스x', 'spacex', '위성통신', '통신업계', '통신독점']
      .some(kw => normalizedTitle.includes(kw))
  const isGeopoliticsDefenseTopic =
    ['러시아', '우크라이나', '돈바스', '푸틴', '나토', '전쟁', '군사충돌', '확전']
      .some(kw => normalizedTitle.includes(kw))
  const isChinaRobotTopic =
    (['중국', 'china', '중국산'].some(kw => normalizedTitle.includes(kw))) &&
    (['로봇', '휴머노이드', '산업로봇', '공장자동화', '자동화'].some(kw => normalizedTitle.includes(kw)))
  const isHousingMigrationTopic =
    ['부동산', '주택', '아파트', '전세', '월세', '청약', '분양', '재건축', '재개발', '이사', '인서울', '탈서울', '경기도']
      .some(kw => normalizedTitle.includes(kw))

  if (!isOverseasMilkTeaTopic && !isFoodCartelTopic && !isStarlinkTelecomTopic && !isGeopoliticsDefenseTopic && !isChinaRobotTopic && !isHousingMigrationTopic) return stocks

  const foreignPriority = ['2150.HK', '9633.HK', '2587.T', '1216.TW', 'KO', 'PEP', 'SBUX']
  const foodCartelPriority = ['097950', '001130', '145990', '271560', '280360', '004370']
  const starlinkTelecomPriority = ['RKLB', 'ASTS', 'IRDM', 'VZ', 'T', 'TMUS', '017670', '030200']
  const geopoliticsDefensePriority = ['012450', '079550', '047810', '103140', 'LMT', 'RTX']
  const chinaRobotPriority = ['9880.HK', '1810.HK', '1211.HK', '454910', '6954.T', 'ABB', 'TSLA']
  const housingMigrationPriority = ['000720', '006360', '375500', '294870', '009240', '108670', '105560']
  const priority = isChinaRobotTopic
    ? chinaRobotPriority
    : isHousingMigrationTopic
    ? housingMigrationPriority
    : isGeopoliticsDefenseTopic
    ? geopoliticsDefensePriority
    : isStarlinkTelecomTopic
    ? starlinkTelecomPriority
    : (isFoodCartelTopic ? foodCartelPriority : foreignPriority)
  const byTicker = new Map(stocks.map(s => [s.ticker, s] as const))
  const reordered: StockSuggestion[] = []
  const seen = new Set<string>()

  for (const ticker of priority) {
    const stock = byTicker.get(ticker)
    if (!stock || seen.has(ticker)) continue
    seen.add(ticker)
    reordered.push(stock)
  }
  for (const stock of stocks) {
    if (seen.has(stock.ticker)) continue
    seen.add(stock.ticker)
    reordered.push(stock)
  }

  return reordered.map((s, idx) => ({ ...s, is_core: idx === 0 }))
}

function buildStockCandidates(params: {
  titleText: string
  summaryText: string
  geminiStocks: StockSuggestion[] | null
  taxonomyStocks: StockSuggestion[]
  channelStockMode?: ChannelStockMode
}): StockSuggestion[] {
  const { titleText, summaryText, geminiStocks, taxonomyStocks, channelStockMode = 'auto' } = params
  const baseText = `${titleText} ${summaryText}`.trim()
  const normalized = baseText.toLowerCase().replace(/\s+/g, '')
  if (channelStockMode === 'off') return []
  const isLowStockTopic = LOW_STOCK_TOPIC_KEYWORDS.some((kw) => normalized.includes(kw))
  const isHumanitiesLowStockTopic = HUMANITIES_LOW_STOCK_KEYWORDS.some((kw) => normalized.includes(kw))
  const isChannelLowStockTopic = channelStockMode === 'low_stock' || channelStockMode === 'strict'
  const isScienceTopic = SCIENCE_TOPIC_KEYWORDS.some((kw) => normalized.includes(kw))
  const isStarlinkTelecomTopic =
    ['스타링크', 'starlink', '스페이스x', 'spacex', '위성통신', '위성네트워크', '버라이즌', 'verizon', 'at&t', 'att', 'atnt', '통신업계']
      .some(kw => normalized.includes(kw))

  const sectorStocks = inferSectorStocks(baseText)
  const useKeywordFallback = taxonomyStocks.length + sectorStocks.length < 4
  const keywordStocks = useKeywordFallback
    ? findRelatedStocks(baseText, isStarlinkTelecomTopic ? 6 : 3)
    : []

  if (isLowStockTopic || isHumanitiesLowStockTopic || isChannelLowStockTopic) {
    // 국제개발/거버넌스형 콘텐츠는 특정 종목 매핑 신뢰도가 낮아 종목 추천을 비활성화한다.
    return []
  }

  if (isScienceTopic) {
    // 과학 주제는 규칙 기반 분류를 우선하고, 금융/유통 등 잡음이 큰 LLM 보강은 배제한다.
    const scienceDeterministic = mergeStockGroups([sectorStocks, taxonomyStocks, keywordStocks], 6)
    const scienceBase = scienceDeterministic.length > 0
      ? scienceDeterministic
      : mergeStockGroups([SCIENCE_SUPPLEMENT_STOCKS.map((s) => ({ ...s, is_core: false }))], 6)
    const scienceFilled = ensureMinStocksFromList(scienceBase, SCIENCE_SUPPLEMENT_STOCKS, 6)
    return prioritizeCoreByTitle(scienceFilled, titleText)
  }

  const deterministicStocks = mergeStockGroups([taxonomyStocks, sectorStocks, keywordStocks], 6)

  if (isStarlinkTelecomTopic) {
    const deterministicFirst = mergeStockGroups([deterministicStocks, geminiStocks || []], 6)
    return prioritizeCoreByTitle(withGuaranteedFallback(ensureMinStocks(deterministicFirst)), titleText)
  }

  // 전 주제 공통: 규칙 기반(택소노미/산업/키워드) 우선, Gemini는 보조 보강
  const merged = deterministicStocks.length > 0
    ? mergeStockGroups([deterministicStocks, geminiStocks || []], 6)
    : mergeStockGroups([geminiStocks || []], 6)

  return prioritizeCoreByTitle(withGuaranteedFallback(ensureMinStocks(merged)), titleText)
}

const STOPWORDS = new Set([
  '그리고', '하지만', '그러나', '또한', '이것', '저것', '그것', '영상', '요약', '관련',
  '대한', '통해', '대한민국', '에서', '으로', '하다', '하는', '있는', '있음', '없음',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'video', 'summary',
])

const WEAK_RELEVANCE_TERMS = new Set([
  '오늘', '이번', '최근', '최신', '화제', '이슈', '분석', '전망', '정리',
  '공개', '발표', '출시', '논란', '충격', '역사', '횡을', '한획', '기록',
  '주년', '7주년', '1주년', '2주년', '3주년', '5주년', '10주년',
  '이유', '근황', '소식', '모델',
])

const NON_INVESTMENT_KEYWORDS = [
  '한국인만몰라요', '한국의잠재력', '국뽕', '지식인초대석', '풀버전',
  '감동', '자부심', '위대함', '정신력', '문화우월', '교양강연',
]

const INVESTMENT_SIGNAL_KEYWORDS = [
  '주식', '종목', '실적', '매출', '영업이익', '증시', '투자', 'etf',
  '산업', '반도체', '배터리', '바이오', '금리', '수출', '기업', '시장',
  '비트코인', '암호화폐', '방산', '원유', '정책', '규제',
]

const CARTEL_TERMS = ['담합', '카르텔', '공정위', '공정거래위원회']
const FOOD_CARTEL_TERMS = ['식품', '밀가루', '설탕', '포도당', '전분당']
const HOUSING_MIGRATION_TERMS = [
  '부동산', '주택', '아파트', '전세', '월세', '청약', '분양', '재건축', '재개발',
  '이사', '인서울', '탈서울', '경기도', '수도권', '주거이동', '주택공급', '임장', '집값', '매매',
]
const CORE_CYBER_SECURITY_TERMS = [
  '해킹', '보안', '악성코드', '취약점', '랜섬웨어', '스파이웨어', '백도어', '제로데이',
  '익스플로잇', '해킹도구',
]
const PLATFORM_CYBER_TERMS = ['아이폰', 'ios', '안드로이드', '탈옥', '포렌식', '디지털포렌식']
const CYBER_SECURITY_TERMS = [...CORE_CYBER_SECURITY_TERMS, ...PLATFORM_CYBER_TERMS]
const GENERIC_ENTITY_ANCHOR_TERMS = new Set([
  '아이폰', 'ios', '안드로이드', '스마트폰', '모바일',
  '혁명', '충격', '이유', '전망', '분석',
])

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, '')
}

function isWeakRelevanceTerm(term: string): boolean {
  const normalized = normalizeTerm(term)
  if (!normalized || normalized.length < 2) return true
  if (STOPWORDS.has(normalized) || WEAK_RELEVANCE_TERMS.has(normalized)) return true
  if (/^\d+$/.test(normalized)) return true
  if (/^\d+(년|월|일|시|분|초|주년)$/.test(normalized)) return true
  return false
}

function dedupeTerms(terms: string[], max = 12): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    const normalized = normalizeTerm(term)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(term)
    if (out.length >= max) break
  }
  return out
}

function extractEntityAnchorTerms(text: string, max = 8): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, '')
  const candidates: string[] = []
  const seen = new Set<string>()

  for (const entry of STOCK_KEYWORD_MAP) {
    for (const kw of entry.keywords) {
      const norm = normalizeTerm(kw)
      if (!norm || norm.length < 2) continue
      if (isWeakRelevanceTerm(norm)) continue
      if (!normalized.includes(norm)) continue
      if (seen.has(norm)) continue
      seen.add(norm)
      candidates.push(norm)
      if (candidates.length >= max * 2) break
    }
    if (candidates.length >= max * 2) break
  }

  return candidates
    .sort((a, b) => b.length - a.length)
    .slice(0, max)
}

function shouldSkipFinancialEnrichment(title: string, summary: string): boolean {
  const text = `${title} ${summary}`.toLowerCase().replace(/\s+/g, '')
  const hasNonInvestmentTone = NON_INVESTMENT_KEYWORDS.some(kw => text.includes(kw))
  const hasInvestmentSignal = INVESTMENT_SIGNAL_KEYWORDS.some(kw => text.includes(kw))

  // 국뽕/교양 토크형이면서 투자 시그널이 없으면 기사/종목 추천 스킵
  return hasNonInvestmentTone && !hasInvestmentSignal
}

export const dynamic = 'force-dynamic'

async function suggestRelatedStocksViaGemini(title: string, summary: string, keywords: string[]): Promise<StockSuggestion[] | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const parseStocks = (raw: unknown): StockSuggestion[] | null => {
    const parseArray = (candidate: unknown): unknown[] | null => {
      if (Array.isArray(candidate)) return candidate
      if (typeof candidate !== 'string') return null
      const text = candidate.trim()

      try {
        const full = JSON.parse(text)
        if (Array.isArray(full)) return full
      } catch {}

      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
      if (fenced) {
        try {
          const fromFence = JSON.parse(fenced[1])
          if (Array.isArray(fromFence)) return fromFence
        } catch {}
      }

      const match = text.match(/\[[\s\S]*\]/)
      if (!match) return null
      try {
        const extracted = JSON.parse(match[0])
        if (Array.isArray(extracted)) return extracted
      } catch {}
      return null
    }

    const parsed = parseArray(raw)
    if (!parsed) return null

    const filtered = parsed.filter((item): item is StockSuggestion => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<StockSuggestion>
      return (
        typeof candidate.ticker === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.market === 'string' &&
        VALID_MARKET_SET.has(candidate.market.toUpperCase())
      )
    }).slice(0, 6)

    if (filtered.length === 0) return null
    return filtered.map((item, idx) => ({
      ticker: item.ticker.toUpperCase(),
      name: item.name.trim(),
      market: item.market.toUpperCase() as StockSuggestion['market'],
      is_core: idx === 0,
    }))
  }

  const requestGemini = async (prompt: string): Promise<StockSuggestion[] | null> => {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 600,
            responseMimeType: 'application/json',
          },
        }),
      }
    )
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text
    return parseStocks(raw)
  }

  const keywordStr = keywords.length > 0 ? keywords.join(', ') : '(없음)'
  const promptBase = [
    `다음은 유튜브 영상 정보입니다.`,
    `제목: ${title}`,
    `요약: ${summary}`,
    `키워드: ${keywordStr}`,
    ``,
    `작업: 영상 주제에서 산업군을 자동 추론하고 투자 연관성이 높은 상장사 6개를 선정.`,
    `규칙:`,
    `- 첫 번째는 핵심 종목 1개(is_core=true).`,
    `- 나머지 5개는 연관 종목(is_core=false).`,
    `- 제목 맥락(예: 해외/국내, 교육, 의료, 방산, 에너지, 소비재 등)을 우선 반영.`,
    `- market은 KOSPI, KOSDAQ, NYSE, NASDAQ, HKEX, TSE, TWSE 중 하나만 사용.`,
    `- 반드시 JSON 배열만 반환.`,
    `[{"ticker":"티커","name":"종목명","market":"시장","is_core":true|false}]`,
  ].join('\n')

  try {
    const first = await requestGemini(promptBase)
    if (first && first.length >= 3) return first

    const retryPrompt = `${promptBase}\n\n이전 응답이 불완전했습니다. 반드시 6개를 채워 JSON 배열만 출력하세요.`
    return await requestGemini(retryPrompt)
  } catch {
    return null
  }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim()
}

function extractTag(block: string, tag: string): string {
  const matched = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return matched?.[1]?.trim() || ''
}

function extractKeywords(text: string, max = 8): string[] {
  const rawTokens = text
    .toLowerCase()
    .replace(/[^0-9a-zA-Z가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const unique: string[] = []
  const seen = new Set<string>()
  for (const token of rawTokens) {
    if (token.length < 2) continue
    if (STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    unique.push(token)
    if (unique.length >= max) break
  }
  return unique
}

async function fetchGoogleNews(query: string): Promise<NewsItem[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  let response: Response
  try {
    response = await fetch(rssUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; YT-Digest-News/1.0)',
        'accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
      },
    })
  } catch {
    return []
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) return []

  const xml = await response.text()
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1])

  const raw = blocks.slice(0, 12).map((block) => {
    const title = decodeEntities(extractTag(block, 'title')).replace(/\s+-\s+[^-]+$/, '')
    const link = decodeEntities(extractTag(block, 'link'))
    const source = decodeEntities(extractTag(block, 'source')) || 'Google News'
    const publishedAt = decodeEntities(extractTag(block, 'pubDate')) || null
    return { title, link, source, publishedAt }
  }).filter(item => item.title && item.link)

  const deduped = new Map<string, NewsItem>()
  for (const item of raw) {
    const key = `${item.title}|${item.link}`
    if (!deduped.has(key)) deduped.set(key, item)
  }
  return [...deduped.values()].slice(0, 8)
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ videoId: string }> }
): Promise<NextResponse> {
  try {
    const { videoId } = await params
    if (!videoId) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 })
    }

    const video = await videoRepository.getByYouTubeId(videoId)
    if (!video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 })
    }
    const { stockMode: channelStockMode, newsMode: channelNewsMode } = await getChannelModes(video.youtube_channel_id)
    const channelModes = { stock: channelStockMode, news: channelNewsMode }

    const titleText = (video.title || '').trim()
    const summaryText = (video.summary_text || '').trim()
    if (shouldSkipFinancialEnrichment(titleText, summaryText)) {
      void videoRepository.updateRelatedNews(videoId, [], [])
      return NextResponse.json({
        success: true,
        cached: false,
        skipped: true,
        reason: 'non_investment_content',
        articles: [],
        stocks: [],
        channelModes,
      })
    }
    const baseText = `${titleText} ${summaryText}`.trim()
    const titleKeywords = extractKeywords(titleText, 4)
    const summaryKeywords = extractKeywords(summaryText, 4)
    const allKeywords = [...new Set([...titleKeywords, ...summaryKeywords])]
    const taxonomySourceText = `${titleText} ${summaryText}`.trim()
    const stocksPromise = suggestRelatedStocksViaGemini(titleText, summaryText, allKeywords)
    const taxonomyContextPromise = inferTaxonomyContext(taxonomySourceText)
    const taxonomyStocksPromise = inferStocksFromTaxonomy(taxonomySourceText)

    // refresh 파라미터: news | stocks | all
    const searchParams = new URL(request.url).searchParams
    const refresh = searchParams.get('refresh')
    const forceRefresh = searchParams.get('force') === 'true' || refresh === 'all'
    const refreshStocksOnly = refresh === 'stocks'
    const refreshNewsOnly = refresh === 'news'
    const refreshNews = refreshNewsOnly || forceRefresh
    const hasCachedArticles = Array.isArray(video.related_news) && video.related_news.length > 0
    const cachedStocks = Array.isArray(video.related_stocks) ? (video.related_stocks as StockSuggestion[]) : []
    const shouldSuppressNewsByChannel = channelNewsMode === 'off'
    const shouldSuppressStocksByChannel =
      channelStockMode === 'off' || channelStockMode === 'low_stock' || channelStockMode === 'strict'
    if (shouldSuppressStocksByChannel && cachedStocks.length > 0) {
      void videoRepository.updateRelatedNews(videoId, (video.related_news as unknown[]) || [], [])
    }
    if (shouldSuppressNewsByChannel && hasCachedArticles) {
      void videoRepository.updateRelatedNews(videoId, [], shouldSuppressStocksByChannel ? [] : cachedStocks)
    }
    if (!forceRefresh && !refreshStocksOnly && !refreshNews && (
      (shouldSuppressNewsByChannel || hasCachedArticles) && (
      shouldSuppressStocksByChannel || cachedStocks.length >= 3
      )
    )) {
      return NextResponse.json({
        success: true,
        cached: true,
        articles: shouldSuppressNewsByChannel ? [] : (video.related_news || []),
        stocks: shouldSuppressStocksByChannel ? [] : cachedStocks,
        channelModes,
      })
    }

    // 종목만 새로고침: 기사 캐시는 유지하고 종목만 재계산
    if (refreshStocksOnly) {
      const [geminiStocks, taxonomyStocks] = await Promise.all([stocksPromise, taxonomyStocksPromise])
      const stocks = buildStockCandidates({ titleText, summaryText, geminiStocks, taxonomyStocks, channelStockMode })
      const articles = shouldSuppressNewsByChannel
        ? []
        : (hasCachedArticles ? (video.related_news as unknown[]) : [])
      void videoRepository.updateRelatedNews(videoId, articles, stocks)
      return NextResponse.json({
        success: true,
        cached: false,
        articles: shouldSuppressNewsByChannel ? [] : articles,
        stocks,
        channelModes,
      })
    }

    // 과거 캐시에 종목이 빈약한 경우(0~2개)는 종목만 재계산해 캐시 보정
    if (!forceRefresh && hasCachedArticles && cachedStocks.length < 3) {
      const [geminiStocks, taxonomyStocks] = await Promise.all([stocksPromise, taxonomyStocksPromise])
      const stocks = buildStockCandidates({ titleText, summaryText, geminiStocks, taxonomyStocks, channelStockMode })
      void videoRepository.updateRelatedNews(videoId, video.related_news as unknown[], stocks)
      return NextResponse.json({
        success: true,
        cached: false,
        articles: shouldSuppressNewsByChannel ? [] : (video.related_news || []),
        stocks,
        channelModes,
      })
    }

    const titleBasisTerms = dedupeTerms(
      extractKeywords(titleText, 8).filter((term) => !isWeakRelevanceTerm(term)),
      8
    )
    const summaryBasisTerms = dedupeTerms(
      extractKeywords(summaryText, 8).filter((term) => !isWeakRelevanceTerm(term)),
      8
    )

    // 중복 없는 쿼리 후보 — 제목+요약 결합 우선, 이후 단독 후보
    const querySet = new Set<string>()
    const titleSummaryCombined = [...new Set([...titleBasisTerms.slice(0, 3), ...summaryBasisTerms.slice(0, 3)])].join(' ')
    if (titleSummaryCombined) querySet.add(titleSummaryCombined) // 1순위: 제목+요약 결합
    if (titleText) querySet.add(titleText.slice(0, 80))  // 1순위: 제목 (80자 이하)
    if (titleKeywords.length > 0) querySet.add(titleKeywords.join(' '))  // 2순위: 제목 키워드
    const taxonomyContext = await taxonomyContextPromise
    if (taxonomyContext) {
      querySet.add(`${taxonomyContext.subcategory} ${taxonomyContext.category}`)
      querySet.add(`${taxonomyContext.sector} ${taxonomyContext.subcategory}`)
    }
    if (summaryKeywords.length > 0) {
      // 3순위: 제목+요약 혼합 키워드
      const mixed = [...new Set([...titleKeywords.slice(0, 2), ...summaryKeywords.slice(0, 3)])].join(' ')
      if (mixed.trim()) querySet.add(mixed)
      querySet.add(summaryKeywords.join(' '))  // 4순위: 요약 키워드만
    }
    const entityAnchors = extractEntityAnchorTerms(titleText, 6)
    if (entityAnchors.length > 0) {
      // 브랜드/기업명 앵커가 있으면 검색 후보에 우선 추가 (무관 기사 유입 감소)
      querySet.add(entityAnchors.slice(0, 2).join(' '))
    }
    const normalizedTitle = titleText.toLowerCase().replace(/\s+/g, '')
    const normalizedSummary = summaryText.toLowerCase().replace(/\s+/g, '')
    const normalizedBase = `${normalizedTitle}${normalizedSummary}`
    const isCartelTopic = CARTEL_TERMS.some(kw => normalizedBase.includes(kw))
    const isFoodCartelTopic = isCartelTopic && FOOD_CARTEL_TERMS.some(kw => normalizedBase.includes(kw))
    const isStarlinkTelecomTopic =
      ['스타링크', 'starlink', '스페이스x', 'spacex', '위성통신', '위성네트워크', '버라이즌', 'verizon', 'at&t', 'att', 'atnt', '통신업계']
        .some(kw => normalizedBase.includes(kw))
    const hasCoreCyberSignal = CORE_CYBER_SECURITY_TERMS.some((kw) => normalizedBase.includes(kw))
    const hasPlatformCyberSignal = PLATFORM_CYBER_TERMS.some((kw) => normalizedBase.includes(kw))
    // "아이폰급 혁명"처럼 플랫폼 단어만 등장하는 기술/경제 영상이 보안 토픽으로 오분류되는 것을 방지
    const isCyberSecurityTopic = hasCoreCyberSignal && (hasPlatformCyberSignal || hasCoreCyberSignal)
    const isHousingMigrationTopic = !isCyberSecurityTopic && HOUSING_MIGRATION_TERMS.some((kw) => normalizedBase.includes(kw))
    if (isCartelTopic) {
      querySet.add('공정거래위원회 담합')
      querySet.add('가격 담합 과징금')
    }
    if (isFoodCartelTopic) {
      querySet.add('공정거래위원회 식품 담합')
      querySet.add('밀가루 설탕 포도당 담합')
      querySet.add('식품 원재료 가격 담합')
    }
    if (isStarlinkTelecomTopic) {
      querySet.add('스타링크 위성통신 경쟁')
      querySet.add('스페이스X 스타링크 통신업계')
      querySet.add('Verizon AT&T Starlink competition')
    }
    if (isHousingMigrationTopic) {
      querySet.add('서울 경기 이사 수요')
      querySet.add('인서울 탈서울 주거 이동')
      querySet.add('수도권 주택 공급 아파트 분양')
      querySet.add('전세 월세 주택시장')
    }
    if (isCyberSecurityTopic) {
      querySet.add('아이폰 해킹 보안')
      querySet.add('iOS spyware exploit')
      querySet.add('모바일 보안 취약점')
    }
    let queryCandidates = [...querySet].filter(Boolean)
    if (isCartelTopic || isStarlinkTelecomTopic || isHousingMigrationTopic || isCyberSecurityTopic) {
      const priority = isFoodCartelTopic
        ? ['공정거래위원회 식품 담합', '밀가루 설탕 포도당 담합', '식품 원재료 가격 담합', '공정거래위원회 담합', '가격 담합 과징금']
        : isCyberSecurityTopic
        ? ['아이폰 해킹 보안', 'iOS spyware exploit', '모바일 보안 취약점']
        : (isHousingMigrationTopic
          ? ['서울 경기 이사 수요', '인서울 탈서울 주거 이동', '수도권 주택 공급 아파트 분양', '전세 월세 주택시장']
          : (isStarlinkTelecomTopic
            ? ['스타링크 위성통신 경쟁', '스페이스X 스타링크 통신업계', 'Verizon AT&T Starlink competition']
            : ['공정거래위원회 담합', '가격 담합 과징금']))
      const prioritized = [...priority, ...queryCandidates]
      const deduped: string[] = []
      const seen = new Set<string>()
      for (const q of prioritized) {
        if (!q || seen.has(q)) continue
        seen.add(q)
        deduped.push(q)
      }
      queryCandidates = deduped
    }
    if (queryCandidates.length === 0) {
      const [geminiStocks, taxonomyStocks] = await Promise.all([stocksPromise, taxonomyStocksPromise])
      const stocks = buildStockCandidates({ titleText, summaryText, geminiStocks, taxonomyStocks, channelStockMode })
      void videoRepository.updateRelatedNews(videoId, [], stocks)
      return NextResponse.json({ success: true, cached: false, articles: [], stocks, channelModes })
    }

    // 뉴스 fetch와 Gemini 종목 추론을 병렬 실행

    let articles: NewsItem[] = []
    let queryUsed = queryCandidates[0]
    if (!refreshStocksOnly && !shouldSuppressNewsByChannel) {
      const collected: NewsItem[] = []
      for (const candidate of queryCandidates.slice(0, 8)) {
        queryUsed = candidate
        const items = await fetchGoogleNews(candidate)
        if (items.length > 0) collected.push(...items)
        if (collected.length >= 40) break
      }
      if (collected.length > 0) {
        const deduped = new Map<string, NewsItem>()
        for (const item of collected) {
          const key = `${item.title}|${item.link}`
          if (!deduped.has(key)) deduped.set(key, item)
        }
        articles = [...deduped.values()]
      }
    }

    // 후보 풀이 너무 작을 때는 baseText로 추가 수집 시도
    if (!shouldSuppressNewsByChannel && articles.length < 8 && baseText.length > 0) {
      const fallback = extractKeywords(baseText, 5).join(' ')
      if (fallback && !querySet.has(fallback)) {
        queryUsed = fallback
        const fallbackItems = await fetchGoogleNews(fallback)
        if (articles.length === 0) {
          articles = fallbackItems
        } else if (fallbackItems.length > 0) {
          const deduped = new Map<string, NewsItem>()
          for (const item of [...articles, ...fallbackItems]) {
            const key = `${item.title}|${item.link}`
            if (!deduped.has(key)) deduped.set(key, item)
          }
          articles = [...deduped.values()]
        }
      }
    }

    // 관련성 점수 필터링(강화):
    // taxonomy/요약 키워드와 겹치지 않으면 기사 미노출(빈 배열 반환)
    const taxonomyTerms = taxonomyContext
      ? [
          ...extractKeywords(taxonomyContext.sector, 2),
          ...extractKeywords(taxonomyContext.category, 2),
          ...extractKeywords(taxonomyContext.subcategory, 2),
        ]
      : []
    const relevanceTerms = isCartelTopic
      ? [...new Set([
          ...CARTEL_TERMS,
          ...(isFoodCartelTopic ? FOOD_CARTEL_TERMS : []),
          ...extractKeywords(queryUsed, 6),
        ])]
      : isCyberSecurityTopic
      ? [...new Set([
          ...CYBER_SECURITY_TERMS,
          ...extractKeywords(titleText, 8),
          ...extractKeywords(queryUsed, 6),
        ])]
      : isHousingMigrationTopic
      ? [...new Set([
          ...HOUSING_MIGRATION_TERMS,
          ...extractKeywords(baseText, 10),
          ...extractKeywords(queryUsed, 6),
        ])]
      : [...new Set([
          ...extractKeywords(baseText, 12),
          ...taxonomyTerms,
          ...extractKeywords(queryUsed, 6),
        ])]
    const strongAnchorTerms = isCartelTopic
      ? dedupeTerms([
          ...CARTEL_TERMS,
          ...(isFoodCartelTopic ? FOOD_CARTEL_TERMS : []),
          ...extractKeywords(titleText, 8),
        ], 10)
      : isCyberSecurityTopic
      ? dedupeTerms([
          ...CYBER_SECURITY_TERMS,
          ...extractKeywords(titleText, 8),
        ], 10)
      : isHousingMigrationTopic
      ? dedupeTerms([
          ...HOUSING_MIGRATION_TERMS,
          ...extractKeywords(titleText, 8),
          ...extractKeywords(summaryText, 4),
        ], 10)
      : dedupeTerms(
          [
            ...extractKeywords(titleText, 8),
            ...extractKeywords(summaryText, 6),
            ...taxonomyTerms,
          ].filter((term) => !isWeakRelevanceTerm(term)),
          10
        )
    const rawEntityAnchorTerms = (isCartelTopic || isHousingMigrationTopic || isCyberSecurityTopic)
      ? []
      : dedupeTerms(extractEntityAnchorTerms(titleText, 6), 6)
    const specificEntityAnchorTerms = rawEntityAnchorTerms.filter(
      (term) => !GENERIC_ENTITY_ANCHOR_TERMS.has(term.toLowerCase())
    )
    const entityAnchorTerms = specificEntityAnchorTerms.length > 0 ? specificEntityAnchorTerms : rawEntityAnchorTerms

    const hasSpecificEntityAnchor = specificEntityAnchorTerms.length > 0
    const minScoreBase = hasSpecificEntityAnchor
      ? Math.max(relevanceTerms.length >= 8 ? 2 : 1, 2)
      : (relevanceTerms.length >= 8 ? 2 : 1)
    const minScore = isHousingMigrationTopic
      ? 1
      : (channelNewsMode === 'strict' ? Math.max(minScoreBase + 1, 3) : minScoreBase)

    const scored = articles
      .map(a => {
        const normalizedTitle = a.title.toLowerCase().replace(/\s+/g, '')
        const score = relevanceTerms.filter((term) =>
          normalizedTitle.includes(normalizeTerm(term))
        ).length
        const anchorScore = strongAnchorTerms.filter((term) =>
          normalizedTitle.includes(normalizeTerm(term))
        ).length
        const titleBasisScore = titleBasisTerms.filter((term) =>
          normalizedTitle.includes(normalizeTerm(term))
        ).length
        const summaryBasisScore = summaryBasisTerms.filter((term) =>
          normalizedTitle.includes(normalizeTerm(term))
        ).length
        return { ...a, _score: score, _anchorScore: anchorScore, _titleBasisScore: titleBasisScore, _summaryBasisScore: summaryBasisScore }
      })
      .sort((a, b) => b._score - a._score)

    const minAnchorScore = isHousingMigrationTopic ? 0 : (channelNewsMode === 'strict' ? 2 : 1)
    let relevant = scored.filter((a) => {
      if (a._score < minScore) return false
      if (titleBasisTerms.length > 0 && summaryBasisTerms.length > 0) {
        if (a._titleBasisScore < 1 && a._summaryBasisScore < 1) return false
      } else if (titleBasisTerms.length > 0 && a._titleBasisScore < 1) {
        return false
      } else if (summaryBasisTerms.length > 0 && a._summaryBasisScore < 1) {
        return false
      }
      if (isCartelTopic || isHousingMigrationTopic || isCyberSecurityTopic) return true
      if (strongAnchorTerms.length === 0) return true
      return a._anchorScore >= minAnchorScore
    })
    if (!isCartelTopic && !isHousingMigrationTopic && !isCyberSecurityTopic && entityAnchorTerms.length > 0) {
      relevant = relevant.filter((a) => {
        const t = a.title.toLowerCase().replace(/\s+/g, '')
        return entityAnchorTerms.some((term) => t.includes(term))
      })
    }
    if (isCartelTopic) {
      relevant = relevant.filter((a) => {
        const t = a.title.toLowerCase().replace(/\s+/g, '')
        const hasCartel = CARTEL_TERMS.some(k => t.includes(k))
        if (!hasCartel) return false
        if (!isFoodCartelTopic) return true
        const hasFood = FOOD_CARTEL_TERMS.some(k => t.includes(k))
        return hasFood
      })
    }
    if (isHousingMigrationTopic && relevant.length === 0 && scored.length > 0) {
      // 주거이동 토픽은 매체별 표현 편차가 커서 점수 0~1 기사도 상위 일부 허용
      relevant = scored.filter((a) => a._score >= 1).slice(0, 8)
    }
    if (isCyberSecurityTopic) {
      relevant = relevant.filter((a) => {
        const t = a.title.toLowerCase().replace(/\s+/g, '')
        const hasCyber = CYBER_SECURITY_TERMS.some((k) => t.includes(k))
        const hasHousingNoise = HOUSING_MIGRATION_TERMS.some((k) => t.includes(k))
        return hasCyber && !hasHousingNoise
      })
    }
    if (!isCartelTopic && !isHousingMigrationTopic && !isCyberSecurityTopic && relevant.length === 0 && scored.length > 0) {
      // 일반 토픽에서 과도한 필터로 0건이 되는 경우, 제목/요약 기반 최소 매칭 기사 일부 허용
      relevant = scored
        .filter((a) => a._score >= 1 && (a._titleBasisScore >= 1 || a._summaryBasisScore >= 1))
        .slice(0, 6)
    }
    if (!isCartelTopic && !isHousingMigrationTopic && !isCyberSecurityTopic && relevant.length > 0 && relevant.length < 4) {
      // 일반 토픽에서 1~3건만 남는 경우, 같은 주제축(제목/요약 기반)을 유지하며 최소 4건까지 보강
      const existingLinks = new Set(relevant.map((a) => a.link))
      const supplement = scored
        .filter((a) => !existingLinks.has(a.link))
        .filter((a) => a._score >= 1 && (a._titleBasisScore >= 1 || a._summaryBasisScore >= 1))
        .filter((a) => {
          if (entityAnchorTerms.length === 0) return true
          const t = a.title.toLowerCase().replace(/\s+/g, '')
          const hasEntityAnchor = entityAnchorTerms.some((term) => t.includes(term))
          return hasEntityAnchor || a._anchorScore >= 1
        })
        .slice(0, 4 - relevant.length)
      relevant = [...relevant, ...supplement]
    }
    articles = shouldSuppressNewsByChannel
      ? []
      : relevant
      .slice(0, 8)
      .map(({ _score, _anchorScore, _titleBasisScore, _summaryBasisScore, ...a }) => {
        void _score
        void _anchorScore
        void _titleBasisScore
        void _summaryBasisScore
        return a
      })

    // 종목 추천: refresh=news 인 경우 기존 캐시 유지, 그 외에는 재계산
    let stocks: StockSuggestion[] = cachedStocks
    if (!refreshNewsOnly || forceRefresh || cachedStocks.length === 0) {
      const [geminiStocks, taxonomyStocks] = await Promise.all([stocksPromise, taxonomyStocksPromise])
      stocks = buildStockCandidates({ titleText, summaryText, geminiStocks, taxonomyStocks, channelStockMode })
    }

    // DB에 캐시 저장 (fire-and-forget)
    void videoRepository.updateRelatedNews(videoId, articles, stocks)

    return NextResponse.json({
      success: true,
      cached: false,
      query: queryUsed,
      articles,
      stocks,
      channelModes,
    })
  } catch (error) {
    console.error('Error fetching related news:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch related news' }, { status: 500 })
  }
}
