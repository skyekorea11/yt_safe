import { readFile } from 'fs/promises'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

type Row = Record<string, string>

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',')
  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length !== headers.length) continue
    const row: Row = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j]
    rows.push(row)
  }
  return rows
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function loadDotEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  const text = await readFile(envPath, 'utf-8').catch(() => '')
  if (!text) return
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

async function upsertBatched(
  supabase: ReturnType<typeof createClient<any>>,
  table: string,
  rows: Row[],
  onConflict: string
) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await (supabase as any).from(table).upsert(batch as any[], { onConflict })
    if (error) throw new Error(`${table} upsert failed: ${error.message}`)
  }
}

async function main() {
  await loadDotEnvLocal()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
  }

  const base = path.join(process.cwd(), 'taxonomy_assets')
  const [taxonomyCsv, industryCsv, mappingCsv, stockCsv] = await Promise.all([
    readFile(path.join(base, 'content_taxonomy.csv'), 'utf-8'),
    readFile(path.join(base, 'industry_classification.csv'), 'utf-8'),
    readFile(path.join(base, 'taxonomy_industry_mapping.csv'), 'utf-8'),
    readFile(path.join(base, 'stock_example_mapping.csv'), 'utf-8'),
  ])

  const taxonomyRows = parseCsv(taxonomyCsv)
  const industryRows = parseCsv(industryCsv)
  const mappingRows = parseCsv(mappingCsv)
  const stockRows = parseCsv(stockCsv)

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  await upsertBatched(supabase, 'content_taxonomy', taxonomyRows, 'taxonomy_id')
  await upsertBatched(supabase, 'industry_classification', industryRows, 'subindustry_id')
  await upsertBatched(supabase, 'taxonomy_industry_mapping', mappingRows, 'taxonomy_id,subindustry_id')
  await upsertBatched(supabase, 'stock_example_mapping', stockRows, 'ticker,subindustry_id')

  logger.log('Pushed taxonomy assets to Supabase')
  logger.log(`content_taxonomy: ${taxonomyRows.length}`)
  logger.log(`industry_classification: ${industryRows.length}`)
  logger.log(`taxonomy_industry_mapping: ${mappingRows.length}`)
  logger.log(`stock_example_mapping: ${stockRows.length}`)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
