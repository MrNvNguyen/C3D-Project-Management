/**
 * QLy HSTK — parse BEP filenames, scan design packages, project dashboard aggregates.
 */
import type { Context } from 'hono'
import {
  TASK_DONE_SQL,
  TASK_OPEN_TOTAL_SQL,
  TASK_OVERDUE_SQL,
  taskComputedProgress,
} from './finance'

export type BepParsed = {
  project: string
  originator: string
  volume: string
  level: string
  type: string
  role: string
  number: string
  description: string
}

const MODEL_TYPES = new Set(['M2', 'M3', 'CM'])
const PACKAGE_FOLDER_RE = /^(\d{6})[-_](.+)$/

export function stripModelExtension(name: string): string {
  return name.replace(/\.(rvt|nwc|ifc|dwg|pdf|nwd|nwf)$/i, '')
}

/** BEP §1.2 — at least 7 hyphen fields; field 7 is 4–6 digits. */
export function parseBepFileName(rawName: string): BepParsed | { error: string } {
  const base = stripModelExtension(String(rawName || '').trim())
  if (!base) return { error: 'empty' }
  const parts = base.split('-').map(p => p.trim()).filter(Boolean)
  if (parts.length < 7) return { error: 'too_few_fields' }
  const number = parts[6]
  if (!/^\d{4,6}$/.test(number)) return { error: 'invalid_number_field' }
  const tail = parts.slice(7).join('-')
  return {
    project: parts[0],
    originator: parts[1],
    volume: parts[2],
    level: parts[3],
    type: parts[4].toUpperCase(),
    role: parts[5].toUpperCase(),
    number,
    description: tail,
  }
}

/** BEP field 1 (`parseBepFileName().project`) vs `projects.code`, `projects.project_code_letter`, outgoing `letter_number`. */
export function bepProjectTokenMatchesOutgoingLetter(bepProjectToken: string, letterNumber: string): boolean {
  const token = String(bepProjectToken || '').trim().toUpperCase()
  const letter = String(letterNumber || '').trim().toUpperCase()
  if (!token || !letter) return false
  if (token === letter) return true
  return letter.startsWith(`${token}/`) || letter.startsWith(`${token}-`) || letter.startsWith(`${token} `)
}

function bepTokenMatchesProjectCode(token: string, projectCode: string): boolean {
  const code = String(projectCode || '').trim().toUpperCase()
  if (!code || !token) return false
  if (token === code) return true
  return code.endsWith(`-${token}`) || code.endsWith(`_${token}`)
}

export function modelBepProjectCodeMismatch(
  bepProjectToken: string,
  projectCode: string,
  outgoingLetterNumbers: string[],
  projectCodeLetter?: string,
): boolean {
  const token = String(bepProjectToken || '').trim().toUpperCase()
  if (!token) return false

  const code = String(projectCode || '').trim()
  const docLetter = String(projectCodeLetter || '').trim()
  const letters = (outgoingLetterNumbers || []).map(n => String(n || '').trim()).filter(Boolean)

  if (bepTokenMatchesProjectCode(token, code)) return false
  if (docLetter && token === docLetter.toUpperCase()) return false

  for (const ln of letters) {
    if (bepProjectTokenMatchesOutgoingLetter(bepProjectToken, ln)) return false
  }

  if (letters.length === 0) {
    return !!(code || docLetter)
  }
  return true
}

export function roleInCodes(role: string, roleCodes: string): boolean {
  const r = role.toUpperCase()
  const codes = String(roleCodes || '')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
  if (!codes.length) return false
  return codes.includes(r)
}

export function parseYyMmDdFolder(name: string): { packageDate: string; description: string } | null {
  const m = PACKAGE_FOLDER_RE.exec(String(name || '').trim())
  if (!m) return null
  const yy = parseInt(m[1].slice(0, 2), 10)
  const mm = parseInt(m[1].slice(2, 4), 10)
  const dd = parseInt(m[1].slice(4, 6), 10)
  const year = 2000 + yy
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const d = new Date(iso + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd) return null
  return { packageDate: iso, description: m[2].trim() }
}

export type PackageRow = {
  id: number
  folder_name: string
  package_date: string
  revision_label?: string | null
  missing_since?: string | null
  [key: string]: unknown
}

/** Sort by package_date then folder_name; assign R0, R1… */
export function assignRevisionNumbers(packages: PackageRow[]): Map<number, { revNum: number; revLabel: string }> {
  const sorted = [...packages].sort((a, b) => {
    const da = String(a.package_date)
    const db = String(b.package_date)
    if (da !== db) return da.localeCompare(db)
    return String(a.folder_name).localeCompare(String(b.folder_name))
  })
  const map = new Map<number, { revNum: number; revLabel: string }>()
  sorted.forEach((p, idx) => {
    const revNum = idx
    const auto = `R${revNum}`
    const revLabel = p.revision_label ? String(p.revision_label) : auto
    map.set(p.id, { revNum, revLabel })
  })
  return map
}

export function displayRevision(p: PackageRow, revMap: Map<number, { revNum: number; revLabel: string }>): string {
  return revMap.get(p.id)?.revLabel ?? 'R0'
}

export function revisionCountForDiscipline(packageCount: number): number {
  return Math.max(0, packageCount - 1)
}

export function filterPresentPackages(packages: PackageRow[]): PackageRow[] {
  return packages.filter(p => !p.missing_since)
}

export function sortPackagesNewestFirst(packages: PackageRow[]): PackageRow[] {
  return [...packages].sort((a, b) => {
    const da = String(a.package_date)
    const db = String(b.package_date)
    if (da !== db) return db.localeCompare(da)
    return String(b.folder_name).localeCompare(String(a.folder_name))
  })
}

/** Newest package still on disk (missing_since IS NULL). */
export function pickLatestPresentPackage(packages: PackageRow[]): PackageRow | null {
  const sorted = sortPackagesNewestFirst(filterPresentPackages(packages))
  return sorted[0] ?? null
}

/** Dashboard timeline: newest packages by date (includes current path), capped. */
export function dashboardTimelinePackages(packages: PackageRow[], limit = 3): PackageRow[] {
  return sortPackagesNewestFirst(packages).slice(0, limit)
}

/** Superseded / historical missing packages are not NAS dashboard blockers. */
export function dashboardPackageMissingNasBlockers(_packages: PackageRow[]): string[] {
  return []
}

/** Last segment of a saved folder path (slashes normalized, trailing slash trimmed). */
export function folderPathPackageLeaf(folderPath: string | null | undefined): string {
  if (!folderPath) return ''
  const norm = normalizeNasPath(String(folderPath)).replace(/[\\/]+$/, '')
  return norm.split(/[/\\]/).pop() || ''
}

/** Package identity from saved path: ^(\\d{6})-(.+)$ or ^(\\d{6})_(.+)$ on last segment only. */
export function parsePackageFromFolderPath(folderPath: string | null | undefined): {
  folderName: string
  packageDate: string
  description: string
} | null {
  const leaf = folderPathPackageLeaf(folderPath)
  const parsed = parseYyMmDdFolder(leaf)
  if (!parsed) return null
  return { folderName: leaf, packageDate: parsed.packageDate, description: parsed.description }
}

/** Headline latest: when path leaf matches YYMMDD-name, that package — not max date among others. */
export function pickLatestPackageForDiscipline(
  folderPath: string | null | undefined,
  packages: PackageRow[],
): PackageRow | null {
  const fromPath = parsePackageFromFolderPath(folderPath)
  if (fromPath) {
    const match = filterPresentPackages(packages).find(
      p => String(p.folder_name).toLowerCase() === fromPath.folderName.toLowerCase(),
    )
    if (match) return match
  }
  return pickLatestPresentPackage(packages)
}

/** Discipline HSTK mới nhất: newest package implied by any category path in that discipline. */
export function pickDisciplineHeadlinePackage(
  categoryFolderPaths: (string | null | undefined)[],
  packages: PackageRow[],
): PackageRow | null {
  let best: PackageRow | null = null
  for (const path of categoryFolderPaths) {
    const pkg = pickLatestPackageForDiscipline(path, packages)
    if (!pkg) continue
    if (!best) {
      best = pkg
      continue
    }
    const da = String(pkg.package_date)
    const db = String(best.package_date)
    if (da > db || (da === db && String(pkg.folder_name).localeCompare(String(best.folder_name)) > 0)) {
      best = pkg
    }
  }
  return best
}

export function designStoredPathsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = a ? normalizeNasPath(String(a)) : null
  const nb = b ? normalizeNasPath(String(b)) : null
  return na === nb
}

export type DesignCategoryFolderMatrixRow = {
  category_id?: number | null
  category_folder_path?: string | null
}

/** One entry per category_id in model_matrix (first row wins). */
export function uniqueCategoryFolderPathsById(
  rows: DesignCategoryFolderMatrixRow[],
): Map<number, string | null> {
  const map = new Map<number, string | null>()
  for (const row of rows) {
    const id = row.category_id
    if (id == null || !Number.isFinite(Number(id))) continue
    const catId = Number(id)
    if (map.has(catId)) continue
    const p = row.category_folder_path ? normalizeNasPath(String(row.category_folder_path)) : null
    map.set(catId, p)
  }
  return map
}

/** Shared path when every category on the sheet matches; otherwise null (header stays empty). */
export function designCommonCategoryFolderPath(rows: DesignCategoryFolderMatrixRow[]): string | null {
  const byId = uniqueCategoryFolderPathsById(rows)
  if (byId.size === 0) return null
  const paths = [...byId.values()]
  const first = paths[0] ?? null
  for (const p of paths) {
    if (!designStoredPathsEqual(p, first)) return null
  }
  return first
}

/** Category ids whose stored path differs from the bulk target (scoped to supplied matrix rows). */
export function categoryIdsNeedingFolderPathUpdate(
  rows: DesignCategoryFolderMatrixRow[],
  newPath: string | null,
): number[] {
  const byId = uniqueCategoryFolderPathsById(rows)
  const out: number[] = []
  for (const [catId, prev] of byId) {
    if (!designStoredPathsEqual(prev, newPath)) out.push(catId)
  }
  return out.sort((a, b) => a - b)
}

async function upsertDesignCategoryFolderPathRow(
  db: D1Database,
  projectId: number,
  disciplineCode: string,
  categoryId: number,
  phaseIdBind: number | null,
  path: string | null,
): Promise<void> {
  if (phaseIdBind === null) {
    await db.prepare(
      `INSERT INTO project_design_category_paths (project_id, phase_id, discipline_code, category_id, folder_path, updated_at)
       VALUES (?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id, phase_id, discipline_code, category_id) DO UPDATE SET
         folder_path = excluded.folder_path,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(projectId, disciplineCode, categoryId, path).run()
  } else {
    await db.prepare(
      `INSERT INTO project_design_category_paths (project_id, phase_id, discipline_code, category_id, folder_path, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id, phase_id, discipline_code, category_id) DO UPDATE SET
         folder_path = excluded.folder_path,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(projectId, phaseIdBind, disciplineCode, categoryId, path).run()
  }
}

/** Same date format as QLy HSTK tab status line (dd/mm/yyyy). */
export function formatIsoDateVi(iso: string | null | undefined): string {
  if (!iso) return '—'
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(iso)
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Headline for HSTK mới nhất — matches `formatLatestPackageLabel` in design-hstk.js. */
export function formatLatestPackageHeadline(
  pkg: { package_date?: string | null; description?: string | null; folder_name?: string | null } | null | undefined,
): string | null {
  if (!pkg) return null
  const label = String(pkg.description || pkg.folder_name || '').trim()
  if (!label) return null
  return `${formatIsoDateVi(pkg.package_date)} — ${label}`
}

export type CategoryDossierStatus = {
  latest_headline: string | null
  current_revision: string | null
  revision_change_count: number
  package_updated_at: string | null
}

/** Per hạng mục dossier line — path leaf package, not discipline-wide headline. */
export function buildCategoryDossierStatus(
  catFolderPath: string | null | undefined,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
): CategoryDossierStatus {
  if (!catFolderPath) {
    return {
      latest_headline: null,
      current_revision: null,
      revision_change_count: 0,
      package_updated_at: null,
    }
  }
  const rowLatest = pickLatestPackageForDiscipline(catFolderPath, packages)
  if (!rowLatest) {
    return {
      latest_headline: null,
      current_revision: null,
      revision_change_count: 0,
      package_updated_at: null,
    }
  }
  const revNum = revMap.get(rowLatest.id)?.revNum ?? 0
  const updatedRaw = rowLatest.updated_at
  return {
    latest_headline: formatLatestPackageHeadline(rowLatest),
    current_revision: displayRevision(rowLatest, revMap),
    revision_change_count: revNum,
    package_updated_at: updatedRaw != null && String(updatedRaw).trim() ? String(updatedRaw) : null,
  }
}

/** At task create: mô tả chỉ ngày hồ sơ — `Cập nhật HS dd/mm/yyyy`. */
export function formatTaskCreateDescriptionFromLatestPkg(
  pkg: { package_date?: string | null } | null | undefined,
): string | null {
  if (!pkg?.package_date) return null
  const d = formatIsoDateVi(pkg.package_date)
  if (d === '—') return null
  return `Cập nhật HS ${d}`
}

/** At task create: keep user text; else fill from latest package date. */
export function resolveEmptyTaskDescription(
  description: unknown,
  latestPkg: PackageRow | null | undefined,
): string | null {
  const trimmed = String(description ?? '').trim()
  if (trimmed) return trimmed
  return formatTaskCreateDescriptionFromLatestPkg(latestPkg)
}

export async function resolveTaskDescriptionOnCreate(
  db: D1Database,
  projectId: number,
  disciplineCode: string | null | undefined,
  designPackageId: unknown,
  description: unknown,
): Promise<string | null> {
  const trimmed = String(description ?? '').trim()
  if (trimmed) return trimmed
  if (!designPackageId && !disciplineCode) return null

  let discCode = disciplineCode ? String(disciplineCode).trim() : ''
  if (!discCode && designPackageId) {
    const row = (await db
      .prepare('SELECT discipline_code FROM design_packages WHERE id = ? AND project_id = ?')
      .bind(designPackageId, projectId)
      .first()) as { discipline_code?: string } | null
    discCode = row?.discipline_code ? String(row.discipline_code).trim() : ''
  }
  if (!discCode) return null

  const discRow = (await db
    .prepare('SELECT folder_path FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ?')
    .bind(projectId, discCode)
    .first()) as { folder_path?: string | null } | null

  const pkgs = await db
    .prepare(
      'SELECT id, folder_name, package_date, description, missing_since FROM design_packages WHERE project_id = ? AND discipline_code = ?',
    )
    .bind(projectId, discCode)
    .all()
  const packages = (pkgs.results || []) as PackageRow[]
  const latest = pickLatestPackageForDiscipline(discRow?.folder_path, packages)
  return formatTaskCreateDescriptionFromLatestPkg(latest)
}

/** Include YYMMDD-name leaf of saved path plus child folder names from disk scan. */
export function mergeScanFolderNames(folderPath: string | null | undefined, folderNames: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string) => {
    const n = String(raw || '').trim()
    if (!n) return
    const key = n.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(n)
  }
  if (folderPath) {
    const norm = normalizeNasPath(String(folderPath)).replace(/[\\/]+$/, '')
    const leaf = norm.split(/[/\\]/).pop() || ''
    if (leaf && parseYyMmDdFolder(leaf)) add(leaf)
  }
  for (const n of folderNames) add(n)
  return out
}

export type HstkCompare = 'match_latest' | 'match_old' | 'unmatched'

export function compareHstkToPackages(
  hstkDate: string | null | undefined,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
  folderPath?: string | null,
): HstkCompare {
  const h = String(hstkDate || '').trim()
  if (!h || !packages.length) return 'unmatched'
  const latest =
    folderPath !== undefined
      ? pickLatestPackageForDiscipline(folderPath, packages)
      : pickLatestPresentPackage(packages)
  if (!latest) return 'unmatched'
  const latestName = String(latest.folder_name)
  if (h === latestName || h === displayRevision(latest, revMap)) return 'match_latest'
  for (const p of packages) {
    if (h === String(p.folder_name) || h === displayRevision(p, revMap)) return 'match_old'
  }
  return 'unmatched'
}

/** Whether a task belongs on the active QLy sheet (legacy = empty phase only). */
export function taskPhaseMatchesDesignSheet(
  taskPhase: string | null | undefined,
  sheetExecutionPhaseKey: string | null,
): boolean {
  const raw = String(taskPhase ?? '').trim()
  if (sheetExecutionPhaseKey == null) return raw === ''
  if (!raw) return false
  return resolveProjectExecutionPhaseKey(raw) === sheetExecutionPhaseKey
}

export function filterModelMatrixTasksForDesignSheet<
  T extends { phase?: string | null },
>(tasks: T[], sheetExecutionPhaseKey: string | null): T[] {
  return (tasks || []).filter(t => taskPhaseMatchesDesignSheet(t.phase, sheetExecutionPhaseKey))
}

/** When several tasks share a model, prefer the newest row (highest id). */
export function pickPrimaryModelTask(
  tasks: { id?: number; assigned_to_name?: string | null; hstk_date?: string | null; design_package_id?: number | null }[],
): {
  id?: number
  assigned_to_name?: string | null
  hstk_date?: string | null
  design_package_id?: number | null
} | null {
  if (!tasks?.length) return null
  return [...tasks].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0))[0]
}

/** Tổng hợp CV columns for one matrix row — primary task only (not filename-level aggregate). */
export function primaryTaskCvReportFields(
  task: { status?: string | null; progress?: number | null; cde_report?: number | null } | null,
): {
  task_status: string | null
  task_progress_percent: number | null
  task_cde_report: boolean | null
} {
  if (!task) {
    return { task_status: null, task_progress_percent: null, task_cde_report: null }
  }
  return {
    task_status: task.status ?? null,
    task_progress_percent: task.progress != null ? Number(task.progress) : 0,
    task_cde_report: !!task.cde_report,
  }
}

export function modelMatrixCvFromTasks(
  relatedTasks: { id?: number; status?: string | null; progress?: number | null; cde_report?: number | null }[],
): ReturnType<typeof primaryTaskCvReportFields> {
  return primaryTaskCvReportFields(pickPrimaryModelTask(relatedTasks))
}

/** Matrix column Người phụ trách — primary task assignee (same pick rule as CV columns). */
export function primaryTaskAssigneeName(task: { assigned_to_name?: string | null } | null): string | null {
  if (!task) return null
  const name = String(task.assigned_to_name ?? '').trim()
  return name || null
}

export function modelMatrixAssigneeFromTasks(
  relatedTasks: { id?: number; assigned_to_name?: string | null }[],
): string | null {
  return primaryTaskAssigneeName(pickPrimaryModelTask(relatedTasks))
}

/** Package row aligned to task Theo HSTK (design_package_id, else hstk_date match). */
export function resolveTaskDesignPackage(
  task: { hstk_date?: string | null; design_package_id?: number | null } | null,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
): PackageRow | null {
  if (!task) return null
  if (task.design_package_id) {
    const linked = packages.find(p => p.id === task.design_package_id)
    if (linked) return linked
  }
  const h = String(task.hstk_date || '').trim()
  if (!h) return null
  for (const p of packages) {
    if (h === String(p.folder_name) || h === displayRevision(p, revMap)) {
      return p
    }
  }
  return null
}

/** Matrix column Rev đã cập nhật — primary task linked HSTK package revision. */
export function modelMatrixRevisionUpdatedFromTasks(
  relatedTasks: { id?: number; hstk_date?: string | null; design_package_id?: number | null }[],
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
): string | null {
  const task = pickPrimaryModelTask(relatedTasks)
  const pkg = resolveTaskDesignPackage(task, packages, revMap)
  return pkg ? displayRevision(pkg, revMap) : null
}

/** Display text for matrix column Đối chiếu HS (Theo HSTK + linked package when known). */
export function buildHstkReference(
  task: { hstk_date?: string | null; design_package_id?: number | null } | null,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
): string | null {
  if (!task) return null
  const h = String(task.hstk_date || '').trim()
  if (!h) return null
  const linked = resolveTaskDesignPackage(task, packages, revMap)
  if (linked) {
    return `${displayRevision(linked, revMap)} · ${linked.package_date} · ${linked.folder_name}`
  }
  return h
}

/** Forward slashes → `\`; collapse accidental `\\` runs (not UNC `\\server\share`). */
export function normalizeNasPath(p: string): string {
  let s = String(p || '').trim().replace(/\//g, '\\')
  if (!s) return ''
  if (s.startsWith('\\\\') && !s.startsWith('\\\\?\\')) {
    const tail = s.slice(2).replace(/\\+/g, '\\').replace(/\\+$/, '')
    return '\\\\' + tail
  }
  return s.replace(/\\+/g, '\\').replace(/\\+$/, '')
}

export function isPathUnderNasRoot(folderPath: string, nasRoot: string): boolean {
  const root = normalizeNasPath(nasRoot).toLowerCase()
  const path = normalizeNasPath(folderPath).toLowerCase()
  if (!root || !path) return false
  if (path.includes('..')) return false
  return path === root || path.startsWith(root + '\\')
}

export function validateDesignFolderPath(
  raw: string | null | undefined,
  nasRoot: string | null | undefined,
): { ok: true; path: string | null } | { ok: false; error: string } {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { ok: true, path: null }
  if (trimmed.includes('..')) return { ok: false, error: 'Đường dẫn không hợp lệ' }
  const path = normalizeNasPath(trimmed)
  const root = nasRoot ? String(nasRoot).trim() : ''
  if (root && !isPathUnderNasRoot(path, root)) {
    return { ok: false, error: 'Đường dẫn ngoài gốc NAS' }
  }
  return { ok: true, path }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function phaseToDocStage(phase: string | null | undefined): string {
  const m: Record<string, string> = {
    basic_design: 'TKCS',
    technical_design: 'TKKT',
    construction_design: 'BVTC',
  }
  return m[String(phase || '')] || 'TKCS'
}

async function defaultDocStageForProject(db: D1Database, projectId: number): Promise<string> {
  const catPhase = await db.prepare(
    `SELECT phase FROM categories WHERE project_id = ? AND phase IS NOT NULL LIMIT 1`,
  ).bind(projectId).first() as { phase?: string } | null
  return phaseToDocStage(catPhase?.phase)
}

export type DesignPackageNotifyTask = {
  assigned_to?: number | null
  discipline_code?: string | null
  category_id?: number | null
  design_package_id?: number | null
  hstk_date?: string | null
  model_filename?: string | null
}

/** Project leaders: projects.leader_id + project_members project_leader/leader (same as app leader role). */
export function collectProjectLeaderUserIds(
  projectLeaderId: number | null | undefined,
  memberLeaderIds: number[],
): number[] {
  const ids = new Set<number>()
  if (projectLeaderId) ids.add(projectLeaderId)
  for (const uid of memberLeaderIds) {
    if (uid) ids.add(uid)
  }
  return [...ids]
}

/** Same HSTK task linkage as QLy matrix: discipline model tasks, linked package, or Theo HSTK match. */
export function taskLinkedToDesignDisciplineNotify(
  task: DesignPackageNotifyTask,
  disciplineCode: string,
  disciplinePackageIds: Set<number>,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
): boolean {
  if (task.design_package_id && disciplinePackageIds.has(task.design_package_id)) return true
  const model = String(task.model_filename ?? '').trim()
  if (model && String(task.discipline_code ?? '').trim() === disciplineCode) return true
  if (String(task.hstk_date ?? '').trim() && packages.length) {
    if (resolveTaskDesignPackage(task, packages, revMap)) return true
  }
  return false
}

/** When set, assignees must belong to that hạng mục (leaders always included). */
export function taskEligibleForCategoryPackageNotify(
  task: DesignPackageNotifyTask,
  categoryId: number | null | undefined,
): boolean {
  if (categoryId == null) return true
  if (task.category_id == null) return false
  return Number(task.category_id) === Number(categoryId)
}

/** Deduped notify recipients: project leaders + assignees on HSTK-linked tasks for the discipline. */
export function collectDesignPackageNotifyRecipientUserIds(
  projectLeaderIds: number[],
  tasks: DesignPackageNotifyTask[],
  disciplineCode: string,
  disciplinePackageIds: Set<number>,
  packages: PackageRow[],
  revMap: Map<number, { revNum: number; revLabel: string }>,
  categoryId?: number | null,
): number[] {
  const userIds = new Set<number>()
  for (const lid of projectLeaderIds) {
    if (lid) userIds.add(lid)
  }
  for (const t of tasks) {
    if (!t.assigned_to) continue
    if (!taskEligibleForCategoryPackageNotify(t, categoryId)) continue
    if (!taskLinkedToDesignDisciplineNotify(t, disciplineCode, disciplinePackageIds, packages, revMap)) continue
    userIds.add(t.assigned_to)
  }
  return [...userIds]
}

/** Upsert design_packages row from folder_path last segment (no child scan required). */
export async function ensurePackageFromFolderPathLeaf(
  db: D1Database,
  projectId: number,
  disciplineCode: string,
  userId: number,
  folderPath: string | null | undefined,
): Promise<Array<{ id: number; folder_name: string; revLabel: string }>> {
  const fromPath = parsePackageFromFolderPath(folderPath)
  if (!fromPath) return []

  const ex = await db.prepare(
    `SELECT id, missing_since FROM design_packages
     WHERE project_id = ? AND discipline_code = ? AND lower(folder_name) = lower(?)`,
  ).bind(projectId, disciplineCode, fromPath.folderName).first() as { id: number; missing_since?: string | null } | null

  if (ex) {
    if (ex.missing_since) {
      await db.prepare(
        `UPDATE design_packages SET missing_since = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(ex.id).run()
    }
    return []
  }

  const countRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM design_packages WHERE project_id = ? AND discipline_code = ?`,
  ).bind(projectId, disciplineCode).first() as { c?: number } | null
  const priorCount = Number(countRow?.c) || 0
  const packageType = priorCount === 0 ? 'issue' : 'revise'
  const defaultStage = await defaultDocStageForProject(db, projectId)

  const ins = await db.prepare(
    `INSERT INTO design_packages (
      project_id, discipline_code, folder_name, package_date, description,
      created_by, package_type, doc_stage, review_status, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'internal')`,
  ).bind(
    projectId,
    disciplineCode,
    fromPath.folderName,
    fromPath.packageDate,
    fromPath.description,
    userId,
    packageType,
    defaultStage,
  ).run()
  const newId = ins.meta.last_row_id as number
  const allPkgs = await db.prepare(
    `SELECT id, folder_name, package_date, revision_label FROM design_packages
     WHERE project_id = ? AND discipline_code = ?`,
  ).bind(projectId, disciplineCode).all()
  const revMap = assignRevisionNumbers((allPkgs.results || []) as PackageRow[])
  const row = (allPkgs.results || []).find((r: PackageRow) => r.id === newId) as PackageRow | undefined
  if (!row) return []
  return [{ id: row.id, folder_name: row.folder_name, revLabel: displayRevision(row, revMap) }]
}

export type ScanResult = {
  newPackages: Array<{ id: number; folder_name: string; revLabel: string }>
  skipped: string[]
  newCount: number
  missingCount: number
  totalCount: number
  /** True when disk listing matched DB — no log row or package writes. */
  unchanged?: boolean
}

/** YYMMDD package folder names from scan listing (+ optional path leaf). */
export function collectValidYyMmDdFolderNames(
  folderPath: string | null | undefined,
  folderNames: string[],
): { validNames: string[]; skipped: string[] } {
  const names = mergeScanFolderNames(folderPath, folderNames).slice(0, 500)
  const seen = new Set<string>()
  const validNames: string[] = []
  const skipped: string[] = []
  for (const n of names) {
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (!parseYyMmDdFolder(n)) {
      skipped.push(n)
      continue
    }
    validNames.push(n)
  }
  return { validNames, skipped }
}

/** Whether applying a scan would insert, mark missing, or restore packages. */
export function designScanWouldChangePackages(
  existingRows: Array<{ folder_name: string; missing_since?: string | null }>,
  validNames: string[],
): boolean {
  const validSet = new Set(validNames.map(n => n.toLowerCase()))
  const byName = new Map(existingRows.map(r => [String(r.folder_name).toLowerCase(), r]))
  for (const name of validNames) {
    if (!byName.has(name.toLowerCase())) return true
  }
  for (const row of existingRows) {
    const fn = String(row.folder_name).toLowerCase()
    const inScan = validSet.has(fn)
    if (inScan && row.missing_since) return true
    if (!inScan && !row.missing_since) return true
  }
  return false
}

export async function executeDesignScan(
  db: D1Database,
  opts: {
    projectId: number
    disciplineCode: string
    phaseId?: number | null
    folderNames: string[]
    folderPath?: string | null
    userId: number
    updateFolderPath: boolean
  },
): Promise<ScanResult> {
  const { projectId, disciplineCode, folderNames, userId, updateFolderPath } = opts
  const phaseId = opts.phaseId === undefined ? null : opts.phaseId
  const folderPath = opts.folderPath ?? null
  const { validNames, skipped } = collectValidYyMmDdFolderNames(folderPath, folderNames)

  const existing = await db.prepare(
    `SELECT id, folder_name, package_date, revision_label, missing_since FROM design_packages
     WHERE project_id = ? AND discipline_code = ?`,
  ).bind(projectId, disciplineCode).all()
  const existingRows = (existing.results || []) as PackageRow[]

  if (!updateFolderPath && !designScanWouldChangePackages(existingRows, validNames)) {
    return {
      newPackages: [],
      skipped,
      newCount: 0,
      missingCount: 0,
      totalCount: validNames.length,
      unchanged: true,
    }
  }

  const byName = new Map(existingRows.map(r => [String(r.folder_name).toLowerCase(), r]))

  let newCount = 0
  const newPackages: ScanResult['newPackages'] = []
  const insertedIds: number[] = []
  const validSet = new Set(validNames.map(n => n.toLowerCase()))

  const catPhase = await db.prepare(
    `SELECT phase FROM categories WHERE project_id = ? AND phase IS NOT NULL LIMIT 1`,
  ).bind(projectId).first() as any
  const defaultStage = phaseToDocStage(catPhase?.phase)

  for (const folderName of validNames) {
    const parsed = parseYyMmDdFolder(folderName)!
    const key = folderName.toLowerCase()
    const ex = byName.get(key)
    if (ex) {
      if (ex.missing_since) {
        await db.prepare(
          `UPDATE design_packages SET missing_since = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).bind(ex.id).run()
      }
      continue
    }
    const priorCount = existingRows.length + newCount
    const packageType = priorCount === 0 ? 'issue' : 'revise'
    const ins = await db.prepare(
      `INSERT INTO design_packages (
        project_id, discipline_code, folder_name, package_date, description,
        created_by, package_type, doc_stage, review_status, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'internal')`,
    ).bind(
      projectId, disciplineCode, folderName, parsed.packageDate, parsed.description,
      userId, packageType, defaultStage,
    ).run()
    const newId = ins.meta.last_row_id as number
    newCount++
    insertedIds.push(newId)
    existingRows.push({
      id: newId,
      folder_name: folderName,
      package_date: parsed.packageDate,
      revision_label: null,
      missing_since: null,
    })
    byName.set(key, existingRows[existingRows.length - 1])
  }

  let missingCount = 0
  for (const row of existingRows) {
    const fn = String(row.folder_name)
    if (!validSet.has(fn.toLowerCase()) && !row.missing_since) {
      await db.prepare(
        `UPDATE design_packages SET missing_since = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).bind(row.id).run()
      missingCount++
    }
  }

  const phaseWhere =
    phaseId === null
      ? 'project_id = ? AND discipline_code = ? AND phase_id IS NULL'
      : 'project_id = ? AND discipline_code = ? AND phase_id = ?'
  const phaseBinds =
    phaseId === null ? [folderPath, userId, projectId, disciplineCode] : [folderPath, userId, projectId, disciplineCode, phaseId]

  if (updateFolderPath && folderPath) {
    await db.prepare(
      `UPDATE project_design_disciplines SET folder_path = ?, last_scanned_at = CURRENT_TIMESTAMP,
       last_scanned_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ${phaseWhere}`,
    ).bind(...phaseBinds).run()
  } else {
    const binds =
      phaseId === null ? [userId, projectId, disciplineCode] : [userId, projectId, disciplineCode, phaseId]
    await db.prepare(
      `UPDATE project_design_disciplines SET last_scanned_at = CURRENT_TIMESTAMP,
       last_scanned_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ${phaseWhere}`,
    ).bind(...binds).run()
  }

  await db.prepare(
    `INSERT INTO design_scan_log (project_id, discipline_code, scanned_by, new_count, missing_count, total_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(projectId, disciplineCode, userId, newCount, missingCount, validNames.length).run()

  const allPkgs = await db.prepare(
    `SELECT id, folder_name, package_date, revision_label FROM design_packages
     WHERE project_id = ? AND discipline_code = ?`,
  ).bind(projectId, disciplineCode).all()
  const revMap = assignRevisionNumbers((allPkgs.results || []) as PackageRow[])
  for (const id of insertedIds) {
    const p = (allPkgs.results || []).find((r: any) => r.id === id) as PackageRow | undefined
    if (p) {
      newPackages.push({
        id: p.id,
        folder_name: p.folder_name,
        revLabel: displayRevision(p, revMap),
      })
    }
  }

  return {
    newPackages,
    skipped,
    newCount,
    missingCount,
    totalCount: validNames.length,
  }
}

export async function canScanDesignDiscipline(
  db: D1Database,
  user: any,
  projectId: number,
  disciplineCode: string,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
  phaseId: number | null = null,
): Promise<boolean> {
  if (user.role === 'system_admin') return true
  if (await isProjectLeaderOrAdmin(db, user, projectId)) return true
  const row =
    phaseId === null
      ? await db.prepare(
          `SELECT leader_id FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id IS NULL`,
        ).bind(projectId, disciplineCode).first()
      : await db.prepare(
          `SELECT leader_id FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id = ?`,
        ).bind(projectId, disciplineCode, phaseId).first()
  return (row as any)?.leader_id === user.id
}

export function parseDesignPhaseIdQuery(raw: string | undefined): number | 'legacy' | undefined {
  if (raw === undefined || raw === '') return undefined
  if (raw === 'legacy' || raw === 'null') return 'legacy'
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

/** QLy sheet filter — legacy = phase_id IS NULL. */
export function designDisciplineMatchesPhaseFilter(
  rowPhaseId: number | null | undefined,
  filter: number | 'legacy' | undefined,
): boolean {
  if (filter === 'legacy') return rowPhaseId == null
  if (typeof filter === 'number') return rowPhaseId === filter
  return rowPhaseId == null
}

/** Checked discipline codes from Khai báo bộ môn save payload. */
export function declaredDisciplineCodesFromPayload(
  disciplines: Array<{ discipline_code?: string | null }>,
): string[] {
  const codes: string[] = []
  for (const d of disciplines) {
    const code = String(d.discipline_code ?? '').trim()
    if (code) codes.push(code)
  }
  return codes
}

export type ProjectExecutionPhaseDef = {
  key: string
  short_code: string
  name: string
}

/** Same giai đoạn thực hiện as tasks.phase / categories.phase (PHASE_ORDER in app.js). */
export const PROJECT_EXECUTION_PHASES: ProjectExecutionPhaseDef[] = [
  { key: 'basic_design', short_code: 'TKCS', name: 'TKCS — Thiết kế cơ sở' },
  { key: 'technical_design', short_code: 'TKKT', name: 'TKKT — Thiết kế kỹ thuật' },
  { key: 'construction_design', short_code: 'TKTC', name: 'TKTC — Thiết kế thi công' },
  { key: 'as_built', short_code: 'AsBuilt', name: 'Hoàn công' },
]

const EXECUTION_PHASE_KEY_SET = new Set(PROJECT_EXECUTION_PHASES.map(p => p.key))

const EXECUTION_PHASE_ALIAS: Record<string, string> = {
  TKCS: 'basic_design',
  BASIC_DESIGN: 'basic_design',
  TKKT: 'technical_design',
  TECHNICAL_DESIGN: 'technical_design',
  TKTC: 'construction_design',
  BVTC: 'construction_design',
  CONSTRUCTION_DESIGN: 'construction_design',
  AS_BUILT: 'as_built',
  HOAN_CONG: 'as_built',
}

export function projectExecutionPhaseCatalog(): ProjectExecutionPhaseDef[] {
  return PROJECT_EXECUTION_PHASES.map(p => ({ ...p }))
}

export function isProjectExecutionPhaseKey(raw: string | null | undefined): boolean {
  return !!resolveProjectExecutionPhaseKey(raw)
}

/** Map stored design phase code / task phase key / short code (TKCS) → tasks.phase key. */
export function resolveProjectExecutionPhaseKey(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  if (EXECUTION_PHASE_KEY_SET.has(s)) return s
  const norm = s.toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (EXECUTION_PHASE_KEY_SET.has(norm.toLowerCase())) return norm.toLowerCase()
  const alias = EXECUTION_PHASE_ALIAS[norm]
  if (alias) return alias
  return null
}

export function isOrphanDesignPhaseCode(raw: string | null | undefined): boolean {
  const s = String(raw || '').trim()
  if (!s) return true
  return !resolveProjectExecutionPhaseKey(s)
}

export function taskPhaseKeyForDesignSheet(
  activePhaseId: number | null | undefined,
  phases: Array<{ id: number; code?: string; execution_phase_key?: string | null }>,
): string | null {
  if (activePhaseId == null) return null
  const row = phases.find(p => p.id === activePhaseId)
  if (!row) return null
  return row.execution_phase_key || resolveProjectExecutionPhaseKey(row.code)
}

export type DesignPhaseInput = {
  id?: number | null
  name?: string
  code?: string
  execution_phase_key?: string
}

function executionPhaseDef(key: string): ProjectExecutionPhaseDef | undefined {
  return PROJECT_EXECUTION_PHASES.find(p => p.key === key)
}

function executionPhaseSortIndex(key: string): number {
  const i = PROJECT_EXECUTION_PHASES.findIndex(p => p.key === key)
  return i >= 0 ? i : 999
}

function parseDeclaredExecutionPhaseKeys(
  phases: DesignPhaseInput[],
): { error?: string; keys: string[] } {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const p of phases) {
    const raw = String(p.execution_phase_key ?? p.code ?? p.name ?? '').trim()
    if (!raw) continue
    const key = resolveProjectExecutionPhaseKey(raw)
    if (!key) {
      return { error: 'Chỉ chọn giai đoạn thực hiện có sẵn (TKCS, TKKT, …)' }
    }
    if (seen.has(key)) return { error: 'Mã giai đoạn không được trùng' }
    seen.add(key)
    keys.push(key)
  }
  if (!keys.length) return { error: 'Chọn ít nhất một giai đoạn' }
  keys.sort((a, b) => executionPhaseSortIndex(a) - executionPhaseSortIndex(b))
  return { keys }
}

function findExistingPhaseIdForKey(
  key: string,
  existingRows: Array<{ id: number; code: string }>,
): number | null {
  for (const r of existingRows) {
    if (resolveProjectExecutionPhaseKey(r.code) === key) return r.id
  }
  return null
}

async function migrateOrphanDesignPhaseRows(
  db: D1Database,
  projectId: number,
  orphanPhaseIds: number[],
  targetPhaseId: number | null,
): Promise<void> {
  if (!orphanPhaseIds.length) return
  if (targetPhaseId != null) {
    for (const oid of orphanPhaseIds) {
      await db
        .prepare(
          `UPDATE project_design_disciplines SET phase_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND phase_id = ?`,
        )
        .bind(targetPhaseId, projectId, oid)
        .run()
      await db
        .prepare(
          `UPDATE project_design_category_paths SET phase_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND phase_id = ?`,
        )
        .bind(targetPhaseId, projectId, oid)
        .run()
    }
  } else {
    for (const oid of orphanPhaseIds) {
      await db
        .prepare(
          `UPDATE project_design_disciplines SET phase_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND phase_id = ?`,
        )
        .bind(projectId, oid)
        .run()
      await db
        .prepare(
          `UPDATE project_design_category_paths SET phase_id = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND phase_id = ?`,
        )
        .bind(projectId, oid)
        .run()
    }
  }
  for (const oid of orphanPhaseIds) {
    await db.prepare(`DELETE FROM project_design_phases WHERE id = ? AND project_id = ?`).bind(oid, projectId).run()
  }
}

/** Sync giai đoạn QLy HSTK; gắn bộ môn/category path phase_id NULL vào giai đoạn đầu khi lưu lần đầu. */
export async function applyProjectDesignPhases(
  db: D1Database,
  projectId: number,
  phases: DesignPhaseInput[],
): Promise<{ error?: string }> {
  const parsed = parseDeclaredExecutionPhaseKeys(phases)
  if (parsed.error) return { error: parsed.error }

  const cleaned = parsed.keys.map((key, idx) => {
    const def = executionPhaseDef(key)!
    return { key, name: def.name, code: key, sort_order: idx }
  })

  const existing = (await db
    .prepare(`SELECT id, code FROM project_design_phases WHERE project_id = ?`)
    .bind(projectId)
    .all()) as { results?: Array<{ id: number; code: string }> }
  const existingRows = existing.results || []
  const orphanPhaseIds = existingRows
    .filter(r => isOrphanDesignPhaseCode(r.code))
    .map(r => r.id)
  const keepIds = new Set<number>()

  for (const p of cleaned) {
    const byKey = findExistingPhaseIdForKey(p.key, existingRows)
    if (byKey) keepIds.add(byKey)
  }

  for (const ex of existingRows) {
    if (keepIds.has(ex.id)) continue
    if (orphanPhaseIds.includes(ex.id)) continue
    const cnt = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM project_design_disciplines WHERE project_id = ? AND phase_id = ?`,
      )
      .bind(projectId, ex.id)
      .first()) as { c?: number } | null
    if (Number(cnt?.c) > 0) {
      return { error: 'Không xóa được giai đoạn còn bộ môn khai báo.' }
    }
    await db.prepare(`DELETE FROM project_design_phases WHERE id = ? AND project_id = ?`).bind(ex.id, projectId).run()
  }

  const nullDisc = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM project_design_disciplines WHERE project_id = ? AND phase_id IS NULL`,
    )
    .bind(projectId)
    .first()) as { c?: number } | null
  const shouldAttachLegacy = Number(nullDisc?.c) > 0 && cleaned.length > 0

  let firstPhaseId: number | null = null

  for (const p of cleaned) {
    let phaseId = findExistingPhaseIdForKey(p.key, existingRows)
    if (phaseId) {
      await db
        .prepare(
          `UPDATE project_design_phases SET name = ?, code = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND project_id = ?`,
        )
        .bind(p.name, p.code, p.sort_order, phaseId, projectId)
        .run()
    } else {
      const ins = await db
        .prepare(
          `INSERT INTO project_design_phases (project_id, name, code, sort_order) VALUES (?, ?, ?, ?)`,
        )
        .bind(projectId, p.name, p.code, p.sort_order)
        .run()
      phaseId = ins.meta.last_row_id as number
      existingRows.push({ id: phaseId, code: p.code })
    }
    if (p.sort_order === 0) firstPhaseId = phaseId
  }

  if (orphanPhaseIds.length) {
    const orphanTarget = cleaned.length === 1 ? firstPhaseId : null
    await migrateOrphanDesignPhaseRows(db, projectId, orphanPhaseIds, orphanTarget)
  }

  if (shouldAttachLegacy && firstPhaseId) {
    await db
      .prepare(
        `UPDATE project_design_disciplines SET phase_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND phase_id IS NULL`,
      )
      .bind(firstPhaseId, projectId)
      .run()
    await db
      .prepare(
        `UPDATE project_design_category_paths SET phase_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE project_id = ? AND phase_id IS NULL`,
      )
      .bind(firstPhaseId, projectId)
      .run()
  }

  return {}
}

export function enrichDesignPhasesForOverview(
  phaseRows: Array<{ id: number; name: string; code: string; sort_order: number }>,
): {
  phases: Array<{
    id: number
    name: string
    code: string
    sort_order: number
    execution_phase_key: string
    short_code: string
  }>
  orphan_phase_ids: number[]
} {
  const phases: Array<{
    id: number
    name: string
    code: string
    sort_order: number
    execution_phase_key: string
    short_code: string
  }> = []
  const orphan_phase_ids: number[] = []
  for (const row of phaseRows) {
    const key = resolveProjectExecutionPhaseKey(row.code)
    if (!key) {
      orphan_phase_ids.push(row.id)
      continue
    }
    const def = executionPhaseDef(key)!
    phases.push({
      ...row,
      code: key,
      name: def.name,
      execution_phase_key: key,
      short_code: def.short_code,
    })
  }
  phases.sort(
    (a, b) =>
      executionPhaseSortIndex(a.execution_phase_key) - executionPhaseSortIndex(b.execution_phase_key) ||
      a.sort_order - b.sort_order ||
      a.id - b.id,
  )
  return { phases, orphan_phase_ids }
}

function phaseScopeSql(phaseId: number | null | undefined): { clause: string; bind: unknown } {
  if (phaseId === undefined) return { clause: '', bind: undefined }
  if (phaseId === null) return { clause: ' AND phase_id IS NULL', bind: undefined }
  return { clause: ' AND phase_id = ?', bind: phaseId }
}

/** Upsert declared disciplines for one phase; remove unchecked codes from that phase only. */
export async function applyProjectDesignDisciplineDeclaration(
  db: D1Database,
  projectId: number,
  disciplines: Array<{ discipline_code: string; role_codes?: string; leader_id?: number | null }>,
  phaseId: number | null = null,
): Promise<void> {
  const retained = declaredDisciplineCodesFromPayload(disciplines)
  for (const d of disciplines) {
    const code = String(d.discipline_code || '').trim()
    if (!code) continue
    const roleCodes = String(d.role_codes ?? code).trim() || code
    const leaderId = d.leader_id ?? null
    if (phaseId === null) {
      await db
        .prepare(
          `INSERT INTO project_design_disciplines (project_id, phase_id, discipline_code, role_codes, leader_id, updated_at)
           VALUES (?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(project_id, phase_id, discipline_code) DO UPDATE SET
             role_codes = excluded.role_codes,
             leader_id = excluded.leader_id,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(projectId, code, roleCodes, leaderId)
        .run()
    } else {
      await db
        .prepare(
          `INSERT INTO project_design_disciplines (project_id, phase_id, discipline_code, role_codes, leader_id, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(project_id, phase_id, discipline_code) DO UPDATE SET
             role_codes = excluded.role_codes,
             leader_id = excluded.leader_id,
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(projectId, phaseId, code, roleCodes, leaderId)
        .run()
    }
  }
  const scope = phaseScopeSql(phaseId)
  if (retained.length === 0) {
    if (phaseId === null) {
      await db
        .prepare(`DELETE FROM project_design_disciplines WHERE project_id = ? AND phase_id IS NULL`)
        .bind(projectId)
        .run()
    } else {
      await db
        .prepare(`DELETE FROM project_design_disciplines WHERE project_id = ? AND phase_id = ?`)
        .bind(projectId, phaseId)
        .run()
    }
    return
  }
  const placeholders = retained.map(() => '?').join(', ')
  if (phaseId === null) {
    await db
      .prepare(
        `DELETE FROM project_design_disciplines WHERE project_id = ? AND phase_id IS NULL AND discipline_code NOT IN (${placeholders})`,
      )
      .bind(projectId, ...retained)
      .run()
  } else {
    await db
      .prepare(
        `DELETE FROM project_design_disciplines WHERE project_id = ? AND phase_id = ? AND discipline_code NOT IN (${placeholders})`,
      )
      .bind(projectId, phaseId, ...retained)
      .run()
  }
}

export async function canConfigureDesignDisciplines(
  db: D1Database,
  user: any,
  projectId: number,
): Promise<boolean> {
  if (user.role === 'system_admin') return true
  const role = await db.prepare(
    `SELECT 1 AS ok FROM projects WHERE id = ? AND admin_id = ?
     UNION SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND role IN ('project_admin','admin')`,
  ).bind(projectId, user.id, projectId, user.id).first()
  return !!role
}

export function registerDesignRoutes(
  app: any,
  deps: {
    authMiddleware: any
    canAccessProject: (db: D1Database, user: any, projectId: number) => Promise<boolean>
    isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>
    sendEmail: (env: any, opts: any) => Promise<any>
    getUserEmailInfo: (db: D1Database, userId: number) => Promise<{ email: string; full_name: string } | null>
  },
) {
  const { authMiddleware, canAccessProject, isProjectLeaderOrAdmin, sendEmail, getUserEmailInfo } = deps

  app.get('/api/projects/:id/design', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
      return c.json(body)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.put('/api/projects/:id/design/phases', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      if (!(await canConfigureDesignDisciplines(db, user, projectId))) {
        return c.json({ error: 'Không có quyền khai báo giai đoạn' }, 403)
      }
      const { phases } = await c.req.json() as { phases?: DesignPhaseInput[] }
      if (!Array.isArray(phases)) return c.json({ error: 'phases array required' }, 400)
      const result = await applyProjectDesignPhases(db, projectId, phases)
      if (result.error) return c.json({ error: result.error }, 400)
      const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
      return c.json(body)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.put('/api/projects/:id/design/disciplines/:code/folder-path', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      const disciplineCode = c.req.param('code')
      const phaseId = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const phaseIdBind = phaseId === 'legacy' || phaseId === undefined ? null : phaseId
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      if (!(await canScanDesignDiscipline(db, user, projectId, disciplineCode, isProjectLeaderOrAdmin, phaseIdBind))) {
        return c.json({ error: 'Không có quyền cập nhật folder bộ môn này' }, 403)
      }
      const row =
        phaseIdBind === null
          ? await db.prepare(
              `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id IS NULL`,
            ).bind(projectId, disciplineCode).first()
          : await db.prepare(
              `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id = ?`,
            ).bind(projectId, disciplineCode, phaseIdBind).first()
      if (!row) return c.json({ error: 'Chưa khai báo bộ môn' }, 404)
      const { folder_path } = await c.req.json() as { folder_path?: string | null }
      const nasRow = await db.prepare(
        `SELECT value FROM system_config WHERE key = 'nas_root_path'`,
      ).first() as { value?: string } | null
      const nasRoot = nasRow?.value ? String(nasRow.value) : ''
      const validated = validateDesignFolderPath(folder_path, nasRoot)
      if (!validated.ok) return c.json({ error: validated.error }, 400)
      if (phaseIdBind === null) {
        await db.prepare(
          `UPDATE project_design_disciplines SET folder_path = ?, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND discipline_code = ? AND phase_id IS NULL`,
        ).bind(validated.path, projectId, disciplineCode).run()
      } else {
        await db.prepare(
          `UPDATE project_design_disciplines SET folder_path = ?, updated_at = CURRENT_TIMESTAMP
           WHERE project_id = ? AND discipline_code = ? AND phase_id = ?`,
        ).bind(validated.path, projectId, disciplineCode, phaseIdBind).run()
      }
      if (validated.path) {
        const newFromPath = await ensurePackageFromFolderPathLeaf(db, projectId, disciplineCode, user.id, validated.path)
        if (newFromPath.length) {
          await notifyDesignPackageNew(db, c.env, sendEmail, getUserEmailInfo, {
            projectId,
            disciplineCode,
            newPackages: newFromPath,
            scannedByUserId: user.id,
          })
        }
      }
      const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
      return c.json(body)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.put(
    '/api/projects/:id/design/disciplines/:code/category-folder-paths',
    authMiddleware,
    async (c: Context) => {
      try {
        const db = c.env.DB
        const user = c.get('user') as any
        const projectId = parseInt(c.req.param('id'))
        const disciplineCode = c.req.param('code')
        const phaseId = parseDesignPhaseIdQuery(c.req.query('phase_id'))
        const phaseIdBind = phaseId === 'legacy' || phaseId === undefined ? null : phaseId
        if (!(await canAccessProject(db, user, projectId))) {
          return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
        }
        if (!(await canScanDesignDiscipline(db, user, projectId, disciplineCode, isProjectLeaderOrAdmin, phaseIdBind))) {
          return c.json({ error: 'Không có quyền cập nhật folder hạng mục này' }, 403)
        }
        const disc =
          phaseIdBind === null
            ? await db.prepare(
                `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id IS NULL`,
              ).bind(projectId, disciplineCode).first()
            : await db.prepare(
                `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id = ?`,
              ).bind(projectId, disciplineCode, phaseIdBind).first()
        if (!disc) return c.json({ error: 'Chưa khai báo bộ môn' }, 404)

        const body = await c.req.json() as { folder_path?: string | null; category_ids?: number[] }
        const categoryIds = Array.isArray(body.category_ids)
          ? [...new Set(body.category_ids.map(id => parseInt(String(id), 10)).filter(Number.isFinite))]
          : []
        if (!categoryIds.length) return c.json({ error: 'category_ids array required' }, 400)

        const nasRow = await db.prepare(
          `SELECT value FROM system_config WHERE key = 'nas_root_path'`,
        ).first() as { value?: string } | null
        const nasRoot = nasRow?.value ? String(nasRow.value) : ''
        const validated = validateDesignFolderPath(body.folder_path, nasRoot)
        if (!validated.ok) return c.json({ error: validated.error }, 400)

        for (const categoryId of categoryIds) {
          const cat = await db.prepare(
            `SELECT id FROM categories WHERE id = ? AND project_id = ?`,
          ).bind(categoryId, projectId).first()
          if (!cat) return c.json({ error: `Hạng mục ${categoryId} không thuộc dự án` }, 404)
        }

        const allNewPackages: Array<{ id: number; folder_name: string; revLabel: string }> = []
        const seenPkgIds = new Set<number>()
        let anyChanged = false

        for (const categoryId of categoryIds) {
          const prev =
            phaseIdBind === null
              ? ((await db.prepare(
                  `SELECT folder_path FROM project_design_category_paths
                   WHERE project_id = ? AND discipline_code = ? AND category_id = ? AND phase_id IS NULL`,
                ).bind(projectId, disciplineCode, categoryId).first()) as { folder_path?: string | null } | null)
              : ((await db.prepare(
                  `SELECT folder_path FROM project_design_category_paths
                   WHERE project_id = ? AND discipline_code = ? AND category_id = ? AND phase_id = ?`,
                ).bind(projectId, disciplineCode, categoryId, phaseIdBind).first()) as { folder_path?: string | null } | null)

          if (designStoredPathsEqual(prev?.folder_path, validated.path)) continue

          anyChanged = true
          await upsertDesignCategoryFolderPathRow(
            db, projectId, disciplineCode, categoryId, phaseIdBind, validated.path,
          )

          if (validated.path) {
            const newFromPath = await ensurePackageFromFolderPathLeaf(
              db, projectId, disciplineCode, user.id, validated.path,
            )
            for (const pkg of newFromPath) {
              if (seenPkgIds.has(pkg.id)) continue
              seenPkgIds.add(pkg.id)
              allNewPackages.push(pkg)
            }
          }
        }

        if (allNewPackages.length) {
          await notifyDesignPackageNew(db, c.env, sendEmail, getUserEmailInfo, {
            projectId,
            disciplineCode,
            newPackages: allNewPackages,
            scannedByUserId: user.id,
            notifyBasePath: validated.path ?? undefined,
          })
        }

        if (!anyChanged) {
          const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
          const overview = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
          return c.json(overview)
        }

        const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
        const overview = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
        return c.json(overview)
      } catch (e: any) {
        return c.json({ error: e.message }, 500)
      }
    },
  )

  app.put(
    '/api/projects/:id/design/disciplines/:code/categories/:categoryId/folder-path',
    authMiddleware,
    async (c: Context) => {
      try {
        const db = c.env.DB
        const user = c.get('user') as any
        const projectId = parseInt(c.req.param('id'))
        const disciplineCode = c.req.param('code')
        const categoryId = parseInt(c.req.param('categoryId'))
        const phaseId = parseDesignPhaseIdQuery(c.req.query('phase_id'))
        const phaseIdBind = phaseId === 'legacy' || phaseId === undefined ? null : phaseId
        if (!Number.isFinite(categoryId)) return c.json({ error: 'categoryId không hợp lệ' }, 400)
        if (!(await canAccessProject(db, user, projectId))) {
          return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
        }
        if (!(await canScanDesignDiscipline(db, user, projectId, disciplineCode, isProjectLeaderOrAdmin, phaseIdBind))) {
          return c.json({ error: 'Không có quyền cập nhật folder hạng mục này' }, 403)
        }
        const disc =
          phaseIdBind === null
            ? await db.prepare(
                `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id IS NULL`,
              ).bind(projectId, disciplineCode).first()
            : await db.prepare(
                `SELECT 1 FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ? AND phase_id = ?`,
              ).bind(projectId, disciplineCode, phaseIdBind).first()
        if (!disc) return c.json({ error: 'Chưa khai báo bộ môn' }, 404)
        const cat = await db.prepare(
          `SELECT id FROM categories WHERE id = ? AND project_id = ?`,
        ).bind(categoryId, projectId).first()
        if (!cat) return c.json({ error: 'Hạng mục không thuộc dự án' }, 404)

        const { folder_path } = await c.req.json() as { folder_path?: string | null }
        const nasRow = await db.prepare(
          `SELECT value FROM system_config WHERE key = 'nas_root_path'`,
        ).first() as { value?: string } | null
        const nasRoot = nasRow?.value ? String(nasRow.value) : ''
        const validated = validateDesignFolderPath(folder_path, nasRoot)
        if (!validated.ok) return c.json({ error: validated.error }, 400)

        const prev =
          phaseIdBind === null
            ? ((await db.prepare(
                `SELECT folder_path FROM project_design_category_paths
                 WHERE project_id = ? AND discipline_code = ? AND category_id = ? AND phase_id IS NULL`,
              ).bind(projectId, disciplineCode, categoryId).first()) as { folder_path?: string | null } | null)
            : ((await db.prepare(
                `SELECT folder_path FROM project_design_category_paths
                 WHERE project_id = ? AND discipline_code = ? AND category_id = ? AND phase_id = ?`,
              ).bind(projectId, disciplineCode, categoryId, phaseIdBind).first()) as { folder_path?: string | null } | null)

        if (designStoredPathsEqual(prev?.folder_path, validated.path)) {
          const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
          const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
          return c.json(body)
        }

        await upsertDesignCategoryFolderPathRow(
          db, projectId, disciplineCode, categoryId, phaseIdBind, validated.path,
        )

        if (validated.path) {
          const newFromPath = await ensurePackageFromFolderPathLeaf(
            db, projectId, disciplineCode, user.id, validated.path,
          )
          if (newFromPath.length) {
            await notifyDesignPackageNew(db, c.env, sendEmail, getUserEmailInfo, {
              projectId,
              disciplineCode,
              categoryId,
              newPackages: newFromPath,
              scannedByUserId: user.id,
              notifyBasePath: validated.path,
            })
          }
        }

        const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
        const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
        return c.json(body)
      } catch (e: any) {
        return c.json({ error: e.message }, 500)
      }
    },
  )

  app.put('/api/projects/:id/design/disciplines', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      if (!(await canConfigureDesignDisciplines(db, user, projectId))) {
        return c.json({ error: 'Không có quyền khai báo bộ môn' }, 403)
      }
      const payload = await c.req.json() as {
        disciplines: Array<{ discipline_code: string; role_codes?: string; leader_id?: number | null }>
        phase_id?: number | null
      }
      const { disciplines } = payload
      if (!Array.isArray(disciplines)) return c.json({ error: 'disciplines array required' }, 400)
      let phaseId: number | null = null
      if (payload.phase_id !== undefined && payload.phase_id !== null) {
        const n = parseInt(String(payload.phase_id), 10)
        if (Number.isFinite(n)) phaseId = n
      }
      await applyProjectDesignDisciplineDeclaration(db, projectId, disciplines, phaseId)
      const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, {
        phaseFilter: phaseFilter ?? (phaseId === null ? 'legacy' : phaseId),
      })
      return c.json(body)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.post('/api/projects/:id/design/disciplines/:code/scan-token', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      const disciplineCode = c.req.param('code')
      const bodyJson = await c.req.json().catch(() => ({})) as { mode?: string; phase_id?: number | null }
      const { mode } = bodyJson
      const scanMode = mode === 'rescan' ? 'rescan' : 'pick'
      let scanPhaseId: number | null = null
      if (bodyJson.phase_id !== undefined && bodyJson.phase_id !== null) {
        const n = parseInt(String(bodyJson.phase_id), 10)
        if (Number.isFinite(n)) scanPhaseId = n
      }
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      if (!(await canScanDesignDiscipline(db, user, projectId, disciplineCode, isProjectLeaderOrAdmin, scanPhaseId))) {
        return c.json({ error: 'Không có quyền quét bộ môn này' }, 403)
      }
      const rawToken = crypto.randomUUID() + crypto.randomUUID()
      const tokenHash = await sha256Hex(rawToken)
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      await db.prepare(
        `INSERT INTO design_scan_tokens (token_hash, user_id, project_id, discipline_code, phase_id, mode, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(tokenHash, user.id, projectId, disciplineCode, scanPhaseId, scanMode, expires).run()
      const origin = new URL(c.req.url).origin
      const nasRow = await db.prepare(
        `SELECT value FROM system_config WHERE key = 'nas_root_path'`,
      ).first() as { value?: string } | null
      const nasRoot = nasRow?.value ? String(nasRow.value) : ''
      const nasQ = nasRoot ? `&nas_root=${encodeURIComponent(nasRoot)}` : '&nas_root='
      const link = `bimfolder:${scanMode}?token=${encodeURIComponent(rawToken)}&api=${encodeURIComponent(origin)}${nasQ}`
      return c.json({ link, expires_at: expires })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get('/api/design/scan-token/:token/status', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const raw = c.req.param('token')
      const tokenHash = await sha256Hex(raw)
      const row = await db.prepare(
        `SELECT user_id, used_at, expires_at, failure_message FROM design_scan_tokens WHERE token_hash = ?`,
      ).bind(tokenHash).first() as any
      if (!row || row.user_id !== user.id) return c.json({ used: false, expired: true })
      const expired = new Date(row.expires_at).getTime() < Date.now()
      return c.json({
        used: !!row.used_at,
        expired,
        error: row.failure_message ? String(row.failure_message) : null,
      })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.post('/api/design/scan-callback', async (c: Context) => {
    try {
      const db = c.env.DB
      const body = await c.req.json() as {
        token: string
        folder_path?: string
        folder_names?: string[] | string
        client_error?: string
      }
      const { token, folder_path, client_error } = body
      let folder_names = body.folder_names
      if (typeof folder_names === 'string') folder_names = [folder_names]
      if (!token) {
        return c.json({ error: 'token required' }, 400)
      }
      const tokenHash = await sha256Hex(token)
      const tok = await db.prepare(
        `SELECT * FROM design_scan_tokens WHERE token_hash = ?`,
      ).bind(tokenHash).first() as any
      if (!tok) return c.json({ error: 'Mã quét không hợp lệ' }, 401)
      if (tok.used_at) return c.json({ error: 'Mã quét đã được sử dụng' }, 401)
      if (new Date(tok.expires_at).getTime() < Date.now()) {
        return c.json({ error: 'Mã quét đã hết hạn' }, 401)
      }

      if (client_error) {
        const msg = String(client_error).slice(0, 500)
        await db.prepare(
          `UPDATE design_scan_tokens SET used_at = CURRENT_TIMESTAMP, failure_message = ? WHERE token_hash = ?`,
        ).bind(msg, tokenHash).run()
        return c.json({ success: false, error: msg })
      }

      if (!Array.isArray(folder_names)) {
        return c.json({ error: 'folder_names required' }, 400)
      }

      const cfg = await db.prepare(
        `SELECT value FROM system_config WHERE key = 'nas_root_path'`,
      ).first() as any
      const nasRoot = cfg?.value ? String(cfg.value).trim() : ''
      const folderPath = folder_path ? normalizeNasPath(folder_path) : null
      if (folderPath && nasRoot && !isPathUnderNasRoot(folderPath, nasRoot)) {
        return c.json({ error: 'Đường dẫn ngoài gốc NAS' }, 403)
      }

      await db.prepare(
        `UPDATE design_scan_tokens SET used_at = CURRENT_TIMESTAMP, failure_message = NULL WHERE token_hash = ?`,
      ).bind(tokenHash).run()

      const scan = await executeDesignScan(db, {
        projectId: tok.project_id,
        disciplineCode: tok.discipline_code,
        phaseId: tok.phase_id ?? null,
        folderNames: folder_names,
        folderPath: tok.mode === 'pick' ? folderPath : undefined,
        userId: tok.user_id,
        updateFolderPath: tok.mode === 'pick' && !!folderPath,
      })

      if (scan.newCount > 0) {
        await notifyDesignPackageNew(db, c.env, sendEmail, getUserEmailInfo, {
          projectId: tok.project_id,
          disciplineCode: tok.discipline_code,
          newPackages: scan.newPackages,
          scannedByUserId: tok.user_id,
        })
      }

      return c.json({ success: true, ...scan })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.post('/api/projects/:id/design/disciplines/:code/scan', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      const disciplineCode = c.req.param('code')
      if (user.role !== 'system_admin') return c.json({ error: 'Chỉ system_admin' }, 403)
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      const { folder_names, folder_path } = await c.req.json() as { folder_names: string[]; folder_path?: string }
      const folderPathNorm = folder_path ? normalizeNasPath(folder_path) : null
      const scan = await executeDesignScan(db, {
        projectId,
        disciplineCode,
        folderNames: folder_names || [],
        folderPath: folderPathNorm,
        userId: user.id,
        updateFolderPath: !!folderPathNorm,
      })
      if (scan.newCount > 0) {
        await notifyDesignPackageNew(db, c.env, sendEmail, getUserEmailInfo, {
          projectId,
          disciplineCode,
          newPackages: scan.newPackages,
          scannedByUserId: user.id,
        })
      }
      return c.json(scan)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.put('/api/projects/:id/design/packages/:pkgId', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const projectId = parseInt(c.req.param('id'))
      const pkgId = parseInt(c.req.param('pkgId'))
      const pkg = await db.prepare(
        `SELECT * FROM design_packages WHERE id = ? AND project_id = ?`,
      ).bind(pkgId, projectId).first() as any
      if (!pkg) return c.json({ error: 'Not found' }, 404)
      if (!(await canAccessProject(db, user, projectId))) {
        return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
      }
      if (!(await canScanDesignDiscipline(db, user, projectId, pkg.discipline_code, isProjectLeaderOrAdmin))) {
        return c.json({ error: 'Không có quyền sửa gói hồ sơ' }, 403)
      }
      const data = await c.req.json()
      const allowedPkgTypes = new Set(['issue', 'revise', 'response'])
      const allowedStages = new Set(['TKCS', 'TKKT', 'BVTC'])
      const allowedReview = new Set(['pending', 'commented', 'approved'])
      const allowedSource = new Set(['TVTK', 'CDT', 'internal'])
      const updates: string[] = []
      const values: unknown[] = []
      const setField = (col: string, val: unknown) => {
        updates.push(`${col} = ?`)
        values.push(val)
      }
      if (data.package_type !== undefined) {
        if (!allowedPkgTypes.has(data.package_type)) return c.json({ error: 'package_type invalid' }, 400)
        setField('package_type', data.package_type)
      }
      if (data.doc_stage !== undefined) {
        if (!allowedStages.has(data.doc_stage)) return c.json({ error: 'doc_stage invalid' }, 400)
        setField('doc_stage', data.doc_stage)
      }
      if (data.revision_label !== undefined) setField('revision_label', data.revision_label || null)
      if (data.review_status !== undefined) {
        if (!allowedReview.has(data.review_status)) return c.json({ error: 'review_status invalid' }, 400)
        setField('review_status', data.review_status)
      }
      if (data.review_due_date !== undefined) setField('review_due_date', data.review_due_date || null)
      if (data.source !== undefined) {
        if (!allowedSource.has(data.source)) return c.json({ error: 'source invalid' }, 400)
        setField('source', data.source)
      }
      if (data.outgoing_letter_id !== undefined) {
        const letterId = data.outgoing_letter_id
        if (letterId) {
          const letter = await db.prepare(
            `SELECT id FROM outgoing_letters WHERE id = ? AND project_id = ?`,
          ).bind(letterId, projectId).first()
          if (!letter) return c.json({ error: 'Văn bản không thuộc dự án' }, 400)
        }
        setField('outgoing_letter_id', letterId || null)
      }
      if (!updates.length) return c.json({ error: 'No fields' }, 400)
      updates.push('updated_by = ?', 'updated_at = CURRENT_TIMESTAMP')
      values.push(user.id, pkgId)
      await db.prepare(`UPDATE design_packages SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
      const phaseFilter = parseDesignPhaseIdQuery(c.req.query('phase_id'))
      const body = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { phaseFilter })
      return c.json(body)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get('/api/project-dashboard', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const memberId = c.req.query('member_id')
      const statusFilter = c.req.query('status') || ''
      const stuckOnly = c.req.query('stuck') === '1'
      const filters = {
        memberId: memberId ? parseInt(memberId, 10) : null,
        statusFilter,
        stuckOnly,
      }
      const projectIdRaw = c.req.query('project_id')
      if (projectIdRaw) {
        const projectId = parseInt(projectIdRaw, 10)
        if (!Number.isFinite(projectId)) return c.json({ error: 'project_id không hợp lệ' }, 400)
        if (!(await canAccessProject(db, user, projectId))) {
          return c.json({ error: 'Không có quyền truy cập dự án này' }, 403)
        }
        const project = await buildProjectDashboardDetail(
          db,
          user,
          projectId,
          isProjectLeaderOrAdmin,
          canAccessProject,
        )
        if (!project) return c.json({ error: 'Không tìm thấy dự án' }, 404)
        return c.json({ project })
      }
      const data = await buildProjectDashboardList(
        db,
        user,
        isProjectLeaderOrAdmin,
        canAccessProject,
        filters,
      )
      return c.json(data)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  app.get('/api/project-dashboard/members/:id/tasks', authMiddleware, async (c: Context) => {
    try {
      const db = c.env.DB
      const user = c.get('user') as any
      const memberId = parseInt(c.req.param('id'), 10)
      const tasks = await fetchMemberDashboardTasks(db, user, memberId, isProjectLeaderOrAdmin)
      return c.json(tasks)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })
}

async function notifyDesignPackageNew(
  db: D1Database,
  env: any,
  sendEmailFn: (env: any, opts: any) => Promise<any>,
  getUserEmailInfo: (db: D1Database, userId: number) => Promise<{ email: string; full_name: string } | null>,
  opts: {
    projectId: number
    disciplineCode: string
    categoryId?: number | null
    newPackages: Array<{ id: number; folder_name: string; revLabel: string }>
    scannedByUserId: number
    notifyBasePath?: string | null
  },
) {
  const projRow = await db.prepare('SELECT name, code, leader_id FROM projects WHERE id = ?').bind(opts.projectId).first() as any
  const memberLeaders = await db.prepare(
    `SELECT user_id FROM project_members WHERE project_id = ? AND role IN ('project_leader', 'leader')`,
  ).bind(opts.projectId).all()
  const projectLeaderIds = collectProjectLeaderUserIds(
    projRow?.leader_id,
    ((memberLeaders.results || []) as { user_id?: number }[]).map(r => r.user_id).filter(Boolean) as number[],
  )

  const pkgRows = await db.prepare(
    `SELECT id, folder_name, package_date, revision_label FROM design_packages
     WHERE project_id = ? AND discipline_code = ?`,
  ).bind(opts.projectId, opts.disciplineCode).all()
  const packages = (pkgRows.results || []) as PackageRow[]
  const revMap = assignRevisionNumbers(packages)
  const disciplinePackageIds = new Set(packages.map(p => p.id))

  const taskRows = await db.prepare(
    `SELECT id, title, assigned_to, discipline_code, category_id, design_package_id, hstk_date, model_filename
     FROM tasks
     WHERE project_id = ? AND status NOT IN ('completed','review','cancelled')
       AND (
         discipline_code = ?
         OR design_package_id IN (SELECT id FROM design_packages WHERE project_id = ? AND discipline_code = ?)
       )`,
  ).bind(opts.projectId, opts.disciplineCode, opts.projectId, opts.disciplineCode).all()
  const candidateTasks = (taskRows.results || []) as Array<
    DesignPackageNotifyTask & { id: number; title: string; assigned_to: number | null }
  >

  const recipientIds = collectDesignPackageNotifyRecipientUserIds(
    projectLeaderIds,
    candidateTasks,
    opts.disciplineCode,
    disciplinePackageIds,
    packages,
    revMap,
    opts.categoryId,
  )

  const proj = projRow
  const disc = await db.prepare('SELECT name FROM disciplines WHERE code = ?').bind(opts.disciplineCode).first() as any
  let basePath = opts.notifyBasePath ? normalizeNasPath(String(opts.notifyBasePath)) : ''
  if (!basePath) {
    const pdd = await db.prepare(
      `SELECT folder_path FROM project_design_disciplines WHERE project_id = ? AND discipline_code = ?`,
    ).bind(opts.projectId, opts.disciplineCode).first() as any
    basePath = pdd?.folder_path ? normalizeNasPath(String(pdd.folder_path)) : ''
  }

  for (const uid of recipientIds) {
    const taskList = candidateTasks.filter(
      t =>
        t.assigned_to === uid &&
        taskEligibleForCategoryPackageNotify(t, opts.categoryId) &&
        taskLinkedToDesignDisciplineNotify(t, opts.disciplineCode, disciplinePackageIds, packages, revMap),
    )
    const pkgLines = opts.newPackages.map(p => {
      const openPath = basePath ? `bimfolder:open?path=${encodeURIComponent(basePath + '\\' + p.folder_name)}` : p.folder_name
      return `${p.folder_name} (${p.revLabel}) — ${openPath}`
    }).join('\n')
    const msg = `Có ${opts.newPackages.length} gói HSTK mới (${disc?.name || opts.disciplineCode}): ${opts.newPackages.map(p => p.revLabel).join(', ')}`
    await db.prepare(
      `INSERT INTO notifications (user_id, title, message, type, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(uid, 'Hồ sơ thiết kế mới', msg, 'info', 'project', opts.projectId).run()
    const info = await getUserEmailInfo(db, uid)
    if (info?.email) {
      await sendEmailFn(env, {
        to: info.email,
        toName: info.full_name,
        eventType: 'design_package_new',
        data: {
          projectName: proj?.name,
          discipline: disc?.name || opts.disciplineCode,
          packages: opts.newPackages,
          tasks: taskList,
          pkgLines,
          basePath,
        },
        db,
        userId: uid,
        relatedType: 'project',
        relatedId: opts.projectId,
      })
    }
  }
}

export type BuildDesignOverviewOpts = {
  phaseFilter?: number | 'legacy'
  forDashboard?: boolean
}

export async function buildDesignOverview(
  db: D1Database,
  projectId: number,
  user: any,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
  opts?: BuildDesignOverviewOpts,
) {
  const canConfigure = await canConfigureDesignDisciplines(db, user, projectId)
  const canScanAny = await isProjectLeaderOrAdmin(db, user, projectId)

  const phaseRows = await db.prepare(
    `SELECT id, name, code, sort_order FROM project_design_phases
     WHERE project_id = ? ORDER BY sort_order, id`,
  ).bind(projectId).all()
  const { phases, orphan_phase_ids } = enrichDesignPhasesForOverview(
    (phaseRows.results || []) as Array<{ id: number; name: string; code: string; sort_order: number }>,
  )

  let disciplineSql = `SELECT pdd.*, d.name AS discipline_name, u.full_name AS leader_name
     FROM project_design_disciplines pdd
     LEFT JOIN disciplines d ON d.code = pdd.discipline_code
     LEFT JOIN users u ON u.id = pdd.leader_id
     WHERE pdd.project_id = ?`
  const disciplineBinds: unknown[] = [projectId]

  if (opts?.forDashboard) {
    disciplineSql += ` AND pdd.id IN (
      SELECT p2.id FROM project_design_disciplines p2
      WHERE p2.project_id = pdd.project_id AND p2.discipline_code = pdd.discipline_code
      ORDER BY CASE WHEN p2.phase_id IS NULL THEN 0 ELSE 1 END, p2.id
      LIMIT 1
    )`
  } else if (opts?.phaseFilter === 'legacy') {
    if (orphan_phase_ids.length) {
      disciplineSql += ` AND (pdd.phase_id IS NULL OR pdd.phase_id IN (${orphan_phase_ids.map(() => '?').join(',')}))`
      disciplineBinds.push(...orphan_phase_ids)
    } else {
      disciplineSql += ' AND pdd.phase_id IS NULL'
    }
  } else if (typeof opts?.phaseFilter === 'number') {
    disciplineSql += ' AND pdd.phase_id = ?'
    disciplineBinds.push(opts.phaseFilter)
  } else {
    disciplineSql += ' AND pdd.phase_id IS NULL'
  }
  disciplineSql += ' ORDER BY pdd.discipline_code'

  const disciplines = await db.prepare(disciplineSql).bind(...disciplineBinds).all()

  const activePhaseKey =
    opts?.phaseFilter === 'legacy' || opts?.phaseFilter === undefined
      ? null
      : typeof opts?.phaseFilter === 'number'
        ? opts.phaseFilter
        : null

  for (const d of (disciplines.results || []) as Array<{ discipline_code: string; folder_path?: string | null }>) {
    if (d.folder_path) {
      await ensurePackageFromFolderPathLeaf(db, projectId, d.discipline_code, user.id, d.folder_path)
    }
  }

  const categoryPathRows = await db.prepare(
    `SELECT phase_id, discipline_code, category_id, folder_path FROM project_design_category_paths WHERE project_id = ?`,
  ).bind(projectId).all()
  const categoryPathByDisc = new Map<string, Map<number, string | null>>()
  for (const row of (categoryPathRows.results || []) as Array<{
    phase_id?: number | null
    discipline_code: string
    category_id: number
    folder_path?: string | null
  }>) {
    const rowPhase = row.phase_id ?? null
    if (!opts?.forDashboard) {
      if (opts?.phaseFilter === 'legacy') {
        const onLegacy =
          rowPhase === null || (rowPhase != null && orphan_phase_ids.includes(rowPhase))
        if (!onLegacy) continue
      } else if (rowPhase !== activePhaseKey) continue
    }
    const code = String(row.discipline_code)
    if (!categoryPathByDisc.has(code)) categoryPathByDisc.set(code, new Map())
    const pathNorm = row.folder_path ? normalizeNasPath(String(row.folder_path)) : null
    categoryPathByDisc.get(code)!.set(Number(row.category_id), pathNorm)
    if (pathNorm) {
      await ensurePackageFromFolderPathLeaf(db, projectId, code, user.id, pathNorm)
    }
  }

  const packages = await db.prepare(
    `SELECT dp.*, ol.letter_number, ol.sent_date AS letter_date,
      (SELECT COUNT(*) FROM tasks t WHERE t.design_package_id = dp.id) AS task_total,
      (SELECT COUNT(*) FROM tasks t WHERE t.design_package_id = dp.id AND t.status IN ('completed','review')) AS task_done
     FROM design_packages dp
     LEFT JOIN outgoing_letters ol ON ol.id = dp.outgoing_letter_id
     WHERE dp.project_id = ?
     ORDER BY dp.discipline_code, dp.package_date DESC, dp.folder_name DESC`,
  ).bind(projectId).all()

  const pkgByDisc = new Map<string, PackageRow[]>()
  for (const p of (packages.results || []) as any[]) {
    const code = p.discipline_code
    if (!pkgByDisc.has(code)) pkgByDisc.set(code, [])
    pkgByDisc.get(code)!.push(p)
  }

  const revMaps = new Map<string, Map<number, { revNum: number; revLabel: string }>>()
  for (const [code, pkgs] of pkgByDisc) {
    revMaps.set(code, assignRevisionNumbers(pkgs))
  }

  const categories = await db.prepare(
    `SELECT id, code, name FROM categories WHERE project_id = ? ORDER BY code`,
  ).bind(projectId).all()
  const models = await db.prepare(
    `SELECT id, name FROM project_models WHERE project_id = ? ORDER BY name`,
  ).bind(projectId).all()

  const sheetTaskPhaseKey =
    opts?.phaseFilter === 'legacy' || opts?.phaseFilter === undefined
      ? null
      : typeof opts?.phaseFilter === 'number'
        ? taskPhaseKeyForDesignSheet(opts.phaseFilter, phases)
        : null

  const tasks = await db.prepare(
    `SELECT t.id, t.title, t.status, t.progress, t.cde_report, t.hstk_date, t.design_package_id, t.discipline_code, t.category_id,
            t.model_filename, t.phase, t.assigned_to, u.full_name AS assigned_to_name
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     WHERE t.project_id = ? AND t.model_filename IS NOT NULL AND TRIM(t.model_filename) != ''`,
  ).bind(projectId).all()

  const project = await db.prepare('SELECT code, project_code_letter FROM projects WHERE id = ?').bind(projectId).first() as any
  const projectCode = project?.code || ''
  const projectCodeLetter = project?.project_code_letter || ''

  const outgoingLetterRows = await db.prepare(
    `SELECT letter_number FROM outgoing_letters
     WHERE project_id = ? AND letter_number IS NOT NULL AND TRIM(letter_number) != ''`,
  ).bind(projectId).all()
  const outgoingLetterNumbers = (outgoingLetterRows.results || []).map((r: any) => String(r.letter_number))

  const disciplineBlocks = (disciplines.results || []).map((d: any) => {
    const pkgs = pkgByDisc.get(d.discipline_code) || []
    const revMap = revMaps.get(d.discipline_code) || new Map()
    const presentPkgs = filterPresentPackages(pkgs)
    const folderPathNorm = d.folder_path ? normalizeNasPath(String(d.folder_path)) : null
    const catPathMap = categoryPathByDisc.get(d.discipline_code) || new Map<number, string | null>()
    const categoryPathsRecord: Record<string, string | null> = {}
    const categoryStatus: Record<string, CategoryDossierStatus> = {}
    for (const [catId, p] of catPathMap) {
      categoryPathsRecord[String(catId)] = p
      categoryStatus[String(catId)] = buildCategoryDossierStatus(p, pkgs, revMap)
    }
    const categoryPathValues = [...catPathMap.values()].filter(Boolean) as string[]
    const latest = pickDisciplineHeadlinePackage(categoryPathValues, pkgs)
    const currentRev = latest ? displayRevision(latest, revMap) : null
    const revCount = revisionCountForDiscipline(presentPkgs.length)

    const modelRows: any[] = []
    const invalidNames: any[] = []
    const unassigned: any[] = []

    for (const m of (models.results || []) as any[]) {
      const parsed = parseBepFileName(m.name)
      if ('error' in parsed) {
        invalidNames.push({ model_id: m.id, name: m.name, reason: parsed.error })
        continue
      }
      if (!roleInCodes(parsed.role, d.role_codes || d.discipline_code)) continue
      const vol = parsed.volume.toUpperCase()
      const cat = (categories.results || []).find((c: any) => String(c.code || '').toUpperCase() === vol)
      const catKey = cat ? cat.id : null
      if (!cat || vol === 'ZZ' || vol === 'XX') {
        unassigned.push({ model_id: m.id, name: m.name, parsed, reason: 'no_category' })
        continue
      }
      const relatedTasks = filterModelMatrixTasksForDesignSheet(
        (tasks.results || []).filter((t: any) =>
          String(t.model_filename || '').trim() === m.name &&
          (t.discipline_code === d.discipline_code || roleInCodes(parsed.role, d.role_codes)),
        ),
        sheetTaskPhaseKey,
      )
      const catFolderPath = catKey != null ? (catPathMap.get(catKey) ?? null) : null
      const catDossier = buildCategoryDossierStatus(catFolderPath, pkgs, revMap)
      const rowLatest = pickLatestPackageForDiscipline(catFolderPath, pkgs)
      const revCurrent = catDossier.current_revision
      const primaryTask = pickPrimaryModelTask(relatedTasks)
      const revUpdated = modelMatrixRevisionUpdatedFromTasks(relatedTasks, pkgs, revMap)
      let revLag = 0
      if (revUpdated && revCurrent && rowLatest) {
        const updPkg = resolveTaskDesignPackage(primaryTask, pkgs, revMap)
        const curNum = revMap.get(rowLatest.id)?.revNum ?? 0
        const updNum = updPkg ? (revMap.get(updPkg.id)?.revNum ?? 0) : 0
        revLag = Math.max(0, curNum - updNum)
      }
      const hstkFlag = primaryTask
        ? compareHstkToPackages(primaryTask.hstk_date, pkgs, revMap, catFolderPath)
        : 'unmatched'
      const hstkReference = buildHstkReference(primaryTask, pkgs, revMap)
      const cvFields = modelMatrixCvFromTasks(relatedTasks)
      const taskAssigneeName = modelMatrixAssigneeFromTasks(relatedTasks)

      modelRows.push({
        model_id: m.id,
        model_name: m.name,
        category_id: catKey,
        category_code: vol,
        category_name: cat.name,
        category_folder_path: catFolderPath,
        category_latest_headline: catDossier.latest_headline,
        category_revision_change_count: catDossier.revision_change_count,
        category_package_updated_at: catDossier.package_updated_at,
        latest_package: rowLatest
          ? {
              id: rowLatest.id,
              folder_name: rowLatest.folder_name,
              package_date: rowLatest.package_date,
              description: rowLatest.description,
              updated_at: catDossier.package_updated_at,
            }
          : null,
        type: parsed.type,
        role: parsed.role,
        project_code_mismatch: modelBepProjectCodeMismatch(
          parsed.project,
          projectCode,
          outgoingLetterNumbers,
          projectCodeLetter,
        ),
        tasks: relatedTasks,
        primary_task_id: primaryTask?.id ?? null,
        ...cvFields,
        task_assignee_name: taskAssigneeName,
        hstk_reference: hstkReference,
        hstk_compare: hstkFlag,
        revision_updated: revUpdated,
        revision_current: revCurrent,
        revision_lag: revLag,
        default_task_type: MODEL_TYPES.has(parsed.type) ? 'model' : 'other',
      })
    }

    const enrichedPkgs = pkgs.map((p: any) => ({
      ...p,
      revision: displayRevision(p, revMap),
      revision_num: revMap.get(p.id)?.revNum ?? 0,
      open_path: folderPathNorm ? `${folderPathNorm}\\${p.folder_name}` : null,
    }))

    return {
      ...d,
      folder_path: folderPathNorm,
      category_paths: categoryPathsRecord,
      category_status: categoryStatus,
      can_configure: canConfigure,
      can_scan: canScanAny || d.leader_id === user.id,
      packages: enrichedPkgs,
      current_revision: currentRev,
      revision_change_count: revCount,
      latest_package: latest
        ? {
            id: latest.id,
            folder_name: latest.folder_name,
            package_date: latest.package_date,
            description: latest.description,
          }
        : null,
      model_matrix: modelRows,
      invalid_names: invalidNames,
      unassigned_models: unassigned,
    }
  })

  const scanLogs = await db.prepare(
    `SELECT l.*, u.full_name AS scanned_by_name FROM design_scan_log l
     LEFT JOIN users u ON u.id = l.scanned_by
     WHERE l.project_id = ?
     ORDER BY l.scanned_at DESC LIMIT 200`,
  ).bind(projectId).all()

  const nasRow = await db.prepare(`SELECT value FROM system_config WHERE key = 'nas_root_path'`).first() as any

  const legacyNullCount = (await db.prepare(
    `SELECT COUNT(*) AS c FROM project_design_disciplines WHERE project_id = ? AND phase_id IS NULL`,
  ).bind(projectId).first()) as { c?: number } | null
  let orphanDiscCount = 0
  if (orphan_phase_ids.length) {
    const oc = (await db
      .prepare(
        `SELECT COUNT(*) AS c FROM project_design_disciplines WHERE project_id = ? AND phase_id IN (${orphan_phase_ids.map(() => '?').join(',')})`,
      )
      .bind(projectId, ...orphan_phase_ids)
      .first()) as { c?: number } | null
    orphanDiscCount = Number(oc?.c) > 0 ? Number(oc?.c) : 0
  }

  return {
    project_id: projectId,
    nas_root: nasRow?.value || null,
    can_configure_disciplines: canConfigure,
    execution_phase_catalog: projectExecutionPhaseCatalog(),
    phases,
    legacy_sheet:
      Number(legacyNullCount?.c) > 0 || orphanDiscCount > 0 || (phases.length === 0 && Number(legacyNullCount?.c) > 0),
    active_phase_id: typeof opts?.phaseFilter === 'number' ? opts.phaseFilter : null,
    disciplines: disciplineBlocks,
    scan_logs: scanLogs.results || [],
    package_suggestions: Object.fromEntries(
      [...pkgByDisc.entries()].map(([code, pkgs]) => {
        const revMap = revMaps.get(code)!
        const sorted = sortPackagesNewestFirst(filterPresentPackages(pkgs))
        return [code, sorted.map(p => ({ id: p.id, label: displayRevision(p, revMap), folder_name: p.folder_name }))]
      }),
    ),
  }
}

type ProjectDashboardFilters = { memberId: number | null; statusFilter: string; stuckOnly: boolean }

function projectDashboardBaseQuery(
  user: any,
  filters: ProjectDashboardFilters,
): { sql: string; params: unknown[] } {
  let projectQuery = `
    SELECT p.id, p.code, p.name, p.status, p.start_date, p.end_date,
      COALESCE(ts.open_tasks, 0) AS open_tasks,
      COALESCE(ts.overdue_tasks, 0) AS overdue_tasks,
      COALESCE(ts.total_tasks, 0) AS total_tasks,
      COALESCE(ts.done_tasks, 0) AS done_tasks
    FROM projects p
    LEFT JOIN (
      SELECT project_id,
        SUM(CASE WHEN ${TASK_OPEN_TOTAL_SQL} AND status NOT IN ('completed','review') THEN 1 ELSE 0 END) AS open_tasks,
        SUM(CASE WHEN ${TASK_OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue_tasks,
        SUM(CASE WHEN ${TASK_OPEN_TOTAL_SQL} THEN 1 ELSE 0 END) AS total_tasks,
        SUM(CASE WHEN ${TASK_DONE_SQL} THEN 1 ELSE 0 END) AS done_tasks
      FROM tasks GROUP BY project_id
    ) ts ON ts.project_id = p.id
    WHERE 1=1
  `
  const params: unknown[] = []
  if (filters.statusFilter) {
    projectQuery += ` AND p.status = ?`
    params.push(filters.statusFilter)
  }
  if (filters.memberId) {
    projectQuery += ` AND p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
      UNION SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
    )`
    params.push(filters.memberId, filters.memberId, filters.memberId)
  }
  if (user.role !== 'system_admin') {
    projectQuery += ` AND p.id IN (
      SELECT project_id FROM project_members WHERE user_id = ?
      UNION SELECT id FROM projects WHERE admin_id = ? OR leader_id = ?
    )`
    params.push(user.id, user.id, user.id)
  }
  projectQuery += ` ORDER BY p.name`
  return { sql: projectQuery, params }
}

async function batchLightDashboardBlockers(
  db: D1Database,
  projects: Array<{ id: number; overdue_tasks: number }>,
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>()
  for (const p of projects) {
    const b: string[] = []
    if (p.overdue_tasks > 0) b.push('Có task trễ hạn')
    map.set(p.id, b)
  }
  if (!projects.length) return map

  const ids = projects.map(p => p.id)
  const placeholders = ids.map(() => '?').join(',')

  const discs = await db.prepare(
    `SELECT project_id, discipline_code, last_scanned_at FROM project_design_disciplines WHERE project_id IN (${placeholders})`,
  ).bind(...ids).all()

  for (const d of (discs.results || []) as Array<{ project_id: number; discipline_code: string; last_scanned_at?: string | null }>) {
    const list = map.get(d.project_id) || []
    if (d.last_scanned_at) {
      const days = (Date.now() - new Date(d.last_scanned_at).getTime()) / 86400000
      if (days > 14) list.push(`${d.discipline_code}: chưa quét >14 ngày`)
    } else if (d.discipline_code) {
      list.push(`${d.discipline_code}: chưa quét lần nào`)
    }
    map.set(d.project_id, list)
  }

  const pkgCounts = await db.prepare(
    `SELECT project_id, discipline_code, COUNT(*) AS c FROM design_packages
     WHERE project_id IN (${placeholders}) GROUP BY project_id, discipline_code`,
  ).bind(...ids).all()
  const pkgSet = new Set(
    ((pkgCounts.results || []) as Array<{ project_id: number; discipline_code: string }>).map(
      r => `${r.project_id}:${r.discipline_code}`,
    ),
  )
  for (const d of (discs.results || []) as Array<{ project_id: number; discipline_code: string }>) {
    if (!pkgSet.has(`${d.project_id}:${d.discipline_code}`)) {
      const list = map.get(d.project_id) || []
      list.push(`${d.discipline_code}: chưa có gói HSTK`)
      map.set(d.project_id, list)
    }
  }

  const overdueReviews = await db.prepare(
    `SELECT project_id, folder_name FROM design_packages
     WHERE project_id IN (${placeholders})
       AND review_due_date IS NOT NULL AND review_status != 'approved'
       AND review_due_date < date('now')`,
  ).bind(...ids).all()
  for (const r of (overdueReviews.results || []) as Array<{ project_id: number; folder_name: string }>) {
    const list = map.get(r.project_id) || []
    list.push(`Gói ${r.folder_name} quá hạn phản hồi`)
    map.set(r.project_id, list)
  }

  for (const [id, list] of map) {
    map.set(id, [...new Set(list)])
  }
  return map
}

export function summarizeDashboardFromOverview(overview: { disciplines: any[] }, p: { overdue_tasks?: number }) {
  const blockers: string[] = []
  if (p.overdue_tasks > 0) blockers.push('Có task trễ hạn')
  let totalRevChanges = 0
  const discSummaries: any[] = []
  const categoryMatrix: Record<string, Record<string, any>> = {}

  for (const d of overview.disciplines) {
    totalRevChanges += d.revision_change_count || 0
    if (d.last_scanned_at) {
      const days = (Date.now() - new Date(d.last_scanned_at).getTime()) / 86400000
      if (days > 14) blockers.push(`${d.discipline_code}: chưa quét >14 ngày`)
    } else if (d.discipline_code) {
      blockers.push(`${d.discipline_code}: chưa quét lần nào`)
    }
    if (!d.packages?.length && d.discipline_code) {
      blockers.push(`${d.discipline_code}: chưa có gói HSTK`)
    }
    for (const pkg of d.packages || []) {
      if (pkg.review_due_date && pkg.review_status !== 'approved') {
        const due = new Date(pkg.review_due_date)
        if (due < new Date()) blockers.push(`Gói ${pkg.folder_name} quá hạn phản hồi`)
      }
    }
    const latestPkgId = d.latest_package?.id ?? null
    for (const row of d.model_matrix || []) {
      if (row.revision_lag >= 1) {
        blockers.push(`Hạng mục ${row.category_code} chậm ${row.revision_lag} revision (${d.discipline_code})`)
      }
      if (row.hstk_compare === 'match_old') blockers.push(`Task chậm HS (${d.discipline_code})`)
      if (latestPkgId) {
        const hasLatestPkgTask = (row.tasks || []).some((t: any) => t.design_package_id === latestPkgId)
        if (!hasLatestPkgTask) {
          blockers.push(`Hạng mục ${row.category_code} chưa có task theo gói mới nhất (${d.discipline_code})`)
        }
      } else if (!row.tasks?.length) {
        blockers.push(`Hạng mục ${row.category_code} chưa giao task (${d.discipline_code})`)
      }
      const cat = row.category_code
      if (!categoryMatrix[cat]) categoryMatrix[cat] = {}
      categoryMatrix[cat][d.discipline_code] = {
        revision_updated: row.revision_updated,
        revision_current: row.revision_current,
        revision_lag: row.revision_lag,
        status:
          row.revision_lag >= 1
            ? 'lagging'
            : row.tasks?.some((t: any) => t.status === 'in_progress')
              ? 'in_progress'
              : row.tasks?.length
                ? 'done'
                : 'none',
      }
    }
    discSummaries.push({
      discipline_code: d.discipline_code,
      discipline_name: d.discipline_name,
      leader_name: d.leader_name,
      current_revision: d.current_revision,
      revision_change_count: d.revision_change_count,
      latest_hstk: d.latest_package,
      packages_timeline: dashboardTimelinePackages(d.packages || [], 3).map((pkg: any) => ({
        folder_name: pkg.folder_name,
        package_date: pkg.package_date,
        description: pkg.description,
        package_type: pkg.package_type,
        doc_stage: pkg.doc_stage,
        source: pkg.source,
        review_status: pkg.review_status,
        review_due_date: pkg.review_due_date,
        revision: pkg.revision,
        open_path: pkg.open_path,
        outgoing_letter_number: pkg.letter_number,
      })),
    })
  }

  return {
    totalRevChanges,
    discSummaries,
    categoryMatrix,
    blockers: [...new Set(blockers)],
  }
}

async function fetchOpenTaskPreviewForDashboard(
  db: D1Database,
  user: any,
  projectId: number,
  canAccessProject: (db: D1Database, user: any, projectId: number) => Promise<boolean>,
): Promise<any[]> {
  if (!(await canAccessProject(db, user, projectId))) return []
  const ot = await db.prepare(
    `SELECT t.id, t.title, t.discipline_code, t.category_id, t.due_date, t.status, t.hstk_date,
            u.full_name AS assigned_to_name, c.name AS category_name
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.project_id = ? AND t.status NOT IN ('completed','review','cancelled')
     ORDER BY t.due_date ASC LIMIT 50`,
  ).bind(projectId).all()
  return (ot.results || []) as any[]
}

export async function buildProjectDashboardList(
  db: D1Database,
  user: any,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
  canAccessProject: (db: D1Database, user: any, projectId: number) => Promise<boolean>,
  filters: ProjectDashboardFilters,
) {
  const { sql, params } = projectDashboardBaseQuery(user, filters)
  const projects = await db.prepare(sql).bind(...params).all()
  const raw = (projects.results || []) as any[]
  const lightBlockers = await batchLightDashboardBlockers(
    db,
    raw.map(p => ({ id: p.id, overdue_tasks: p.overdue_tasks })),
  )

  const rows: any[] = []
  for (const p of raw) {
    const blockers = lightBlockers.get(p.id) || []
    if (filters.stuckOnly && blockers.length === 0) continue
    rows.push({
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      progress: taskComputedProgress(p.total_tasks, p.done_tasks),
      open_tasks: p.open_tasks,
      overdue_tasks: p.overdue_tasks,
      blockers,
      detail_loaded: false,
    })
  }

  let workload: any = null
  if (filters.memberId) {
    workload = await buildMemberWorkload(db, filters.memberId, user, isProjectLeaderOrAdmin)
  }

  return { projects: rows, workload }
}

export async function buildProjectDashboardDetail(
  db: D1Database,
  user: any,
  projectId: number,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
  canAccessProject: (db: D1Database, user: any, projectId: number) => Promise<boolean>,
) {
  const p = await db.prepare(
    `SELECT p.id, p.code, p.name, p.status,
      COALESCE(ts.open_tasks, 0) AS open_tasks,
      COALESCE(ts.overdue_tasks, 0) AS overdue_tasks,
      COALESCE(ts.total_tasks, 0) AS total_tasks,
      COALESCE(ts.done_tasks, 0) AS done_tasks
     FROM projects p
     LEFT JOIN (
       SELECT project_id,
         SUM(CASE WHEN ${TASK_OPEN_TOTAL_SQL} AND status NOT IN ('completed','review') THEN 1 ELSE 0 END) AS open_tasks,
         SUM(CASE WHEN ${TASK_OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue_tasks,
         SUM(CASE WHEN ${TASK_OPEN_TOTAL_SQL} THEN 1 ELSE 0 END) AS total_tasks,
         SUM(CASE WHEN ${TASK_DONE_SQL} THEN 1 ELSE 0 END) AS done_tasks
       FROM tasks WHERE project_id = ? GROUP BY project_id
     ) ts ON ts.project_id = p.id
     WHERE p.id = ?`,
  ).bind(projectId, projectId).first() as any
  if (!p) return null

  const overview = await buildDesignOverview(db, projectId, user, isProjectLeaderOrAdmin, { forDashboard: true })
  const { totalRevChanges, discSummaries, categoryMatrix, blockers } = summarizeDashboardFromOverview(overview, p)
  const openTaskPreview = await fetchOpenTaskPreviewForDashboard(db, user, projectId, canAccessProject)

  return {
    id: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    phase: null,
    progress: taskComputedProgress(p.total_tasks, p.done_tasks),
    open_tasks: p.open_tasks,
    overdue_tasks: p.overdue_tasks,
    total_revision_changes: totalRevChanges,
    disciplines: discSummaries,
    category_matrix: categoryMatrix,
    blockers,
    open_tasks_preview: openTaskPreview,
    detail_loaded: true,
  }
}

/** @deprecated Use buildProjectDashboardList + buildProjectDashboardDetail */
export async function buildProjectDashboard(
  db: D1Database,
  user: any,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
  filters: ProjectDashboardFilters,
) {
  return buildProjectDashboardList(db, user, isProjectLeaderOrAdmin, async () => true, filters)
}

async function buildMemberWorkload(
  db: D1Database,
  memberId: number,
  viewer: any,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
) {
  const projCount = await db.prepare(
    `SELECT COUNT(DISTINCT project_id) AS c FROM (
      SELECT project_id FROM project_members WHERE user_id = ?
      UNION SELECT id AS project_id FROM projects WHERE admin_id = ? OR leader_id = ?
    )`,
  ).bind(memberId, memberId, memberId).first() as any

  const openStats = await db.prepare(
    `SELECT
      SUM(CASE WHEN status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) AS open_tasks,
      SUM(CASE WHEN ${TASK_OVERDUE_SQL} THEN 1 ELSE 0 END) AS overdue_tasks,
      SUM(CASE WHEN status NOT IN ('completed','review','cancelled') THEN COALESCE(estimated_hours,0) ELSE 0 END) AS open_hours,
      MIN(CASE WHEN status NOT IN ('completed','review','cancelled') AND due_date IS NOT NULL THEN due_date END) AS nearest_due
     FROM tasks WHERE assigned_to = ?`,
  ).bind(memberId).first() as any

  const byProject = await db.prepare(
    `SELECT t.project_id, p.name AS project_name,
      SUM(CASE WHEN t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) AS open_tasks,
      SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status NOT IN ('completed','review','cancelled') THEN 1 ELSE 0 END) AS overdue_tasks
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.assigned_to = ?
     GROUP BY t.project_id, p.name
     HAVING open_tasks > 0`,
  ).bind(memberId).all()

  const taskList = await fetchMemberDashboardTasks(db, viewer, memberId, isProjectLeaderOrAdmin)

  return {
    member_id: memberId,
    project_count: projCount?.c || 0,
    open_tasks: openStats?.open_tasks || 0,
    overdue_tasks: openStats?.overdue_tasks || 0,
    open_hours: openStats?.open_hours || 0,
    nearest_due: openStats?.nearest_due || null,
    by_project: byProject.results || [],
    tasks: taskList,
  }
}

export async function fetchMemberDashboardTasks(
  db: D1Database,
  viewer: any,
  memberId: number,
  isProjectLeaderOrAdmin: (db: D1Database, user: any, projectId?: number) => Promise<boolean>,
) {
  const globalSeeAll = ['system_admin', 'project_admin', 'project_leader'].includes(viewer.role)
  let managedProjectIds: number[] = []
  if (!globalSeeAll) {
    const mp = await db.prepare(
      `SELECT id AS project_id FROM projects WHERE admin_id = ? OR leader_id = ?
       UNION SELECT project_id FROM project_members WHERE user_id = ? AND role IN ('project_admin','project_leader','admin','leader')`,
    ).bind(viewer.id, viewer.id, viewer.id).all()
    managedProjectIds = (mp.results || []).map((r: any) => r.project_id)
  }

  const allTasks = await db.prepare(
    `SELECT t.id, t.title, t.project_id, t.discipline_code, t.due_date, t.status, t.progress,
            p.name AS project_name
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.assigned_to = ? AND t.status NOT IN ('completed','review','cancelled')
     ORDER BY t.due_date ASC`,
  ).bind(memberId).all()

  const out: any[] = []
  const hiddenByProject: Record<number, number> = {}

  for (const t of (allTasks.results || []) as any[]) {
    const canSeeTitle =
      globalSeeAll ||
      viewer.id === memberId ||
      managedProjectIds.includes(t.project_id)
    if (canSeeTitle) {
      out.push({
        id: t.id,
        title: t.title,
        project_id: t.project_id,
        project_name: t.project_name,
        discipline_code: t.discipline_code,
        due_date: t.due_date,
        status: t.status,
        progress: t.progress,
      })
    } else {
      hiddenByProject[t.project_id] = (hiddenByProject[t.project_id] || 0) + 1
    }
  }

  return { tasks: out, hidden_counts_by_project: hiddenByProject }
}

export function taskRequiresHstk(designPackageId: unknown, hstkDate: unknown): boolean {
  if (!designPackageId) return false
  return !String(hstkDate ?? '').trim()
}

export const HSTK_REQUIRED_BODY = {
  error: 'Phải điền Theo HSTK nào',
  field: 'hstk_date',
  required_fields: ['hstk_date'],
}
