import { describe, expect, it } from 'vitest'
import {
  parseBepFileName,
  parseYyMmDdFolder,
  modelBepProjectCodeMismatch,
  bepProjectTokenMatchesOutgoingLetter,
  roleInCodes,
  assignRevisionNumbers,
  compareHstkToPackages,
  pickPrimaryModelTask,
  modelMatrixAssigneeFromTasks,
  primaryTaskCvReportFields,
  modelMatrixCvFromTasks,
  modelMatrixRevisionUpdatedFromTasks,
  buildHstkReference,
  displayRevision,
  revisionCountForDiscipline,
  validateDesignFolderPath,
  normalizeNasPath,
  mergeScanFolderNames,
  pickLatestPresentPackage,
  parsePackageFromFolderPath,
  pickLatestPackageForDiscipline,
  pickDisciplineHeadlinePackage,
  dashboardTimelinePackages,
  dashboardPackageMissingNasBlockers,
  designStoredPathsEqual,
  designCommonCategoryFolderPath,
  categoryIdsNeedingFolderPathUpdate,
  designScanWouldChangePackages,
  collectValidYyMmDdFolderNames,
  taskEligibleForCategoryPackageNotify,
  formatLatestPackageHeadline,
  buildCategoryDossierStatus,
  resolveEmptyTaskDescription,
  collectProjectLeaderUserIds,
  collectDesignPackageNotifyRecipientUserIds,
  summarizeDashboardFromOverview,
  applyProjectDesignDisciplineDeclaration,
  designDisciplineMatchesPhaseFilter,
  applyProjectDesignPhases,
  taskPhaseKeyForDesignSheet,
  isProjectExecutionPhaseKey,
  filterModelMatrixTasksForDesignSheet,
  taskPhaseMatchesDesignSheet,
} from './design'

function createProjectDesignDisciplineTestDb() {
  const rows = new Map<string, { role_codes: string; leader_id: number | null; phase_id: number | null }>()
  const rowKey = (projectId: number, phaseId: number | null, code: string) =>
    `${projectId}:${phaseId ?? 'null'}:${code}`

  const db = {
    prepare(sql: string) {
      const binds: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          binds.push(...args)
          return stmt
        },
        async run() {
          if (sql.includes('INSERT INTO project_design_disciplines')) {
            if (sql.includes('VALUES (?, NULL,')) {
              const [projectId, code, roleCodes, leaderId] = binds as [number, string, string, number | null]
              rows.set(rowKey(projectId, null, code), {
                role_codes: roleCodes,
                leader_id: leaderId,
                phase_id: null,
              })
            } else {
              const [projectId, phaseId, code, roleCodes, leaderId] = binds as [
                number,
                number,
                string,
                string,
                number | null,
              ]
              rows.set(rowKey(projectId, phaseId, code), {
                role_codes: roleCodes,
                leader_id: leaderId,
                phase_id: phaseId,
              })
            }
          } else if (sql.includes('DELETE FROM project_design_disciplines')) {
            const projectId = binds[0] as number
            if (sql.includes('phase_id = ?') && sql.includes('NOT IN')) {
              const phaseId = binds[1] as number
              const retained = new Set(binds.slice(2) as string[])
              for (const key of [...rows.keys()]) {
                const [pid, ph, code] = key.split(':')
                if (Number(pid) === projectId && ph === String(phaseId) && !retained.has(code)) rows.delete(key)
              }
            } else if (sql.includes('phase_id IS NULL') && sql.includes('NOT IN')) {
              const retained = new Set(binds.slice(1) as string[])
              for (const key of [...rows.keys()]) {
                const [pid, ph, code] = key.split(':')
                if (Number(pid) === projectId && ph === 'null' && !retained.has(code)) rows.delete(key)
              }
            } else if (sql.includes('phase_id = ?')) {
              const phaseId = binds[1] as number
              for (const key of [...rows.keys()]) {
                const [pid, ph] = key.split(':')
                if (Number(pid) === projectId && ph === String(phaseId)) rows.delete(key)
              }
            } else if (sql.includes('phase_id IS NULL')) {
              for (const key of [...rows.keys()]) {
                const [pid, ph] = key.split(':')
                if (Number(pid) === projectId && ph === 'null') rows.delete(key)
              }
            }
          }
          return { meta: { last_row_id: 0 } }
        },
        async first() {
          return null
        },
        async all() {
          return { results: [] }
        },
      }
      return stmt
    },
  }

  return {
    db: db as unknown as D1Database,
    rows,
    codesForProject(projectId: number, phaseId: number | null = null) {
      const ph = phaseId == null ? 'null' : String(phaseId)
      return [...rows.keys()]
        .filter(k => k.startsWith(`${projectId}:${ph}:`))
        .map(k => k.split(':')[2])
        .sort()
    },
  }
}

describe('parseBepFileName', () => {
  it('parses standard BEP model name', () => {
    const r = parseBepFileName('TT09-OAD-HZ-BF-M3-A-0001-HAM TT.rvt')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.volume).toBe('HZ')
    expect(r.type).toBe('M3')
    expect(r.role).toBe('A')
    expect(r.number).toBe('0001')
    expect(r.description).toBe('HAM TT')
  })

  it('rejects BOD-style invalid name', () => {
    const r = parseBepFileName('BOD-TKCS-ZZ-M3-Nhà làm việc chính-Combine')
    expect('error' in r).toBe(true)
  })
})

describe('modelBepProjectCodeMismatch', () => {
  it('not flagged when BEP token equals an outgoing letter number', () => {
    expect(modelBepProjectCodeMismatch('BV38.4', 'OTHER-CODE', ['BV38.4/2026/CV-01'])).toBe(false)
    expect(modelBepProjectCodeMismatch('BV38.4', 'OTHER-CODE', ['bv38.4'])).toBe(false)
  })

  it('flagged when token matches neither project code nor any letter', () => {
    expect(modelBepProjectCodeMismatch('BV38.4', 'TT09', ['TT09/2026/01-CV'])).toBe(true)
    expect(modelBepProjectCodeMismatch('WRONG', 'TT09', ['TT09/2026/01-CV'])).toBe(true)
  })

  it('with no outgoing letters uses project code only', () => {
    expect(modelBepProjectCodeMismatch('BV38.4', 'BV38.4', [])).toBe(false)
    expect(modelBepProjectCodeMismatch('BV38.4', 'TT09', [])).toBe(true)
    expect(modelBepProjectCodeMismatch('BV38.4', '', [])).toBe(false)
  })

  it('matches project_code_letter (Số hiệu văn bản dự án) and code suffix BCA-C03 vs C03', () => {
    expect(modelBepProjectCodeMismatch('C03', 'BCA-C03', [], 'C03')).toBe(false)
    expect(modelBepProjectCodeMismatch('C03', 'BCA-C03', [], '')).toBe(false)
    expect(modelBepProjectCodeMismatch('ZZZ', 'BCA-C03', [], 'C03')).toBe(true)
  })

  it('matches letter prefix with separator not loose substring', () => {
    expect(bepProjectTokenMatchesOutgoingLetter('BV', 'BV38.4/2026')).toBe(false)
    expect(bepProjectTokenMatchesOutgoingLetter('BV38.4', 'BV38.4/2026/CV-01')).toBe(true)
  })
})

describe('parseYyMmDdFolder', () => {
  it('parses valid folder', () => {
    expect(parseYyMmDdFolder('260915-Phát hành TKCS')).toEqual({
      packageDate: '2026-09-15',
      description: 'Phát hành TKCS',
    })
  })
  it('parses underscore separator', () => {
    expect(parseYyMmDdFolder('260518_Canh quan+HTKT')).toEqual({
      packageDate: '2026-05-18',
      description: 'Canh quan+HTKT',
    })
  })
  it('skips invalid', () => {
    expect(parseYyMmDdFolder('abc')).toBeNull()
    expect(parseYyMmDdFolder('261345-x')).toBeNull()
  })
})

describe('roleInCodes', () => {
  it('matches EM for HVAC role_codes', () => {
    expect(roleInCodes('EM', 'HVAC,EM')).toBe(true)
  })
})

describe('revision', () => {
  it('counts revisions', () => {
    expect(revisionCountForDiscipline(4)).toBe(3)
  })
  it('assigns R by date order', () => {
    const pkgs = [
      { id: 1, folder_name: '260901-A', package_date: '2026-09-01' },
      { id: 2, folder_name: '260915-B', package_date: '2026-09-15' },
      { id: 3, folder_name: '260920-C', package_date: '2026-09-20' },
    ]
    const map = assignRevisionNumbers(pkgs)
    expect(displayRevision(pkgs[2], map)).toBe('R2')
  })
})

describe('category bulk folder path helpers', () => {
  it('shows common path only when every category matches', () => {
    const mep = [
      { category_id: 10, category_folder_path: 'Z:\\FY2026\\MEP\\NLV' },
      { category_id: 11, category_folder_path: 'Z:\\FY2026\\MEP\\NLV' },
    ]
    expect(designCommonCategoryFolderPath(mep)).toBe('Z:\\FY2026\\MEP\\NLV')
    mep[1].category_folder_path = 'Z:\\other'
    expect(designCommonCategoryFolderPath(mep)).toBeNull()
  })

  it('bulk apply targets only categories in the supplied matrix rows', () => {
    const mepAsBuilt = [
      { category_id: 10, category_folder_path: 'Z:\\old' },
      { category_id: 11, category_folder_path: 'Z:\\old' },
    ]
    const aaAsBuilt = [{ category_id: 99, category_folder_path: 'Z:\\aa-only' }]
    expect(categoryIdsNeedingFolderPathUpdate(mepAsBuilt, 'Z:\\new')).toEqual([10, 11])
    expect(categoryIdsNeedingFolderPathUpdate(mepAsBuilt, 'Z:\\old')).toEqual([])
    expect(categoryIdsNeedingFolderPathUpdate(aaAsBuilt, 'Z:\\new')).toEqual([99])
    expect(categoryIdsNeedingFolderPathUpdate(mepAsBuilt, 'Z:\\new')).not.toContain(99)
  })
})

describe('normalizeNasPath', () => {
  it('collapses doubled backslashes on drive paths', () => {
    const doubled = 'C:\\\\Users\\\\NguyenNguyenVan\\\\Downloads\\\\01 TKCS\\\\260506-Ho So TKCS\\\\2.KET CAU'
    expect(normalizeNasPath(doubled)).toBe(
      'C:\\Users\\NguyenNguyenVan\\Downloads\\01 TKCS\\260506-Ho So TKCS\\2.KET CAU',
    )
  })
  it('preserves UNC leading slashes', () => {
    expect(normalizeNasPath('\\\\fileserver\\\\share\\\\BOD')).toBe('\\\\fileserver\\share\\BOD')
  })
})

describe('validateDesignFolderPath', () => {
  it('clears empty path', () => {
    expect(validateDesignFolderPath('', null)).toEqual({ ok: true, path: null })
  })
  it('rejects parent segments', () => {
    expect(validateDesignFolderPath('D:\\..\\secret', null).ok).toBe(false)
  })
  it('requires path under nas root when configured', () => {
    const r = validateDesignFolderPath('D:\\other', 'Z:\\NAS')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('NAS')
  })
  it('accepts path under nas root', () => {
    expect(validateDesignFolderPath('Z:\\NAS\\BOD\\KT', 'Z:\\NAS')).toEqual({
      ok: true,
      path: 'Z:\\NAS\\BOD\\KT',
    })
  })
})

describe('compareHstkToPackages', () => {
  const pkgs = [
    { id: 1, folder_name: '260901-A', package_date: '2026-09-01' },
    { id: 2, folder_name: '260915-B', package_date: '2026-09-15' },
  ]
  const map = assignRevisionNumbers(pkgs)
  it('latest match', () => {
    expect(compareHstkToPackages('260915-B', pkgs, map)).toBe('match_latest')
  })
  it('old match', () => {
    expect(compareHstkToPackages('260901-A', pkgs, map)).toBe('match_old')
  })
})

describe('mergeScanFolderNames', () => {
  it('includes YYMMDD leaf of saved path plus children', () => {
    const path = 'C:\\Users\\me\\Downloads\\01 TKCS\\260506-Ho So TKCS'
    expect(mergeScanFolderNames(path, ['260701-Other'])).toEqual([
      '260506-Ho So TKCS',
      '260701-Other',
    ])
  })
  it('ignores non-package leaf', () => {
    expect(mergeScanFolderNames('C:\\01 TKCS', ['260506-Ho So TKCS'])).toEqual(['260506-Ho So TKCS'])
  })
})

describe('parsePackageFromFolderPath', () => {
  it('reads YYMMDD-name from last path segment (keeps plus sign)', () => {
    const path = 'C:\\Users\\NguyenNguyenVan\\Downloads\\01 TKCS\\260518-Canh quan+HTKT'
    expect(parsePackageFromFolderPath(path)).toEqual({
      folderName: '260518-Canh quan+HTKT',
      packageDate: '2026-05-18',
      description: 'Canh quan+HTKT',
    })
  })
  it('reads YYMMDD_name from last path segment (underscore form)', () => {
    const path = 'C:\\Users\\NguyenNguyenVan\\Downloads\\01 TKCS\\260518_Canh quan+HTKT'
    expect(parsePackageFromFolderPath(path)).toEqual({
      folderName: '260518_Canh quan+HTKT',
      packageDate: '2026-05-18',
      description: 'Canh quan+HTKT',
    })
  })
  it('uses last segment only when parent also looks like a package', () => {
    const path = 'Z:\\NAS\\260101-Old parent\\260518_Canh quan+HTKT'
    expect(parsePackageFromFolderPath(path)).toEqual({
      folderName: '260518_Canh quan+HTKT',
      packageDate: '2026-05-18',
      description: 'Canh quan+HTKT',
    })
  })
  it('returns null when last segment has no YYMMDD prefix', () => {
    expect(parsePackageFromFolderPath('C:\\01 TKCS\\Ho So TKCS')).toBeNull()
    expect(parsePackageFromFolderPath('C:\\01 TKCS\\abc518-Not a date')).toBeNull()
  })
})

describe('buildCategoryDossierStatus', () => {
  const pkgs = [
    { id: 1, folder_name: '260518-Canh quan+HTKT', package_date: '2026-05-18', description: 'Canh quan+HTKT', missing_since: null, updated_at: '2026-05-20 10:00:00' },
    { id: 2, folder_name: '260905-HSTK cap nhat', package_date: '2026-09-05', description: 'HSTK cap nhat', missing_since: null, updated_at: '2026-09-06 12:00:00' },
  ]
  const revMap = assignRevisionNumbers(pkgs)

  it('two categories under one discipline show different latest headlines', () => {
    const pathA = 'Z:\\DuAn\\AA\\NLV\\260518-Canh quan+HTKT'
    const pathB = 'Z:\\DuAn\\AA\\NTB\\260905-HSTK cap nhat'
    const statusA = buildCategoryDossierStatus(pathA, pkgs, revMap)
    const statusB = buildCategoryDossierStatus(pathB, pkgs, revMap)
    expect(statusA.latest_headline).toBe('18/05/2026 — Canh quan+HTKT')
    expect(statusB.latest_headline).toBe('05/09/2026 — HSTK cap nhat')
    expect(statusA.latest_headline).not.toBe(statusB.latest_headline)
    expect(statusA.current_revision).toBe('R0')
    expect(statusB.current_revision).toBe('R1')
    expect(statusA.package_updated_at).toBe('2026-05-20 10:00:00')
    expect(statusB.package_updated_at).toBe('2026-09-06 12:00:00')
  })

  it('no saved path yields empty dossier fields', () => {
    const empty = buildCategoryDossierStatus(null, pkgs, revMap)
    expect(empty.latest_headline).toBeNull()
    expect(empty.current_revision).toBeNull()
    expect(empty.revision_change_count).toBe(0)
  })
})

describe('pickDisciplineHeadlinePackage', () => {
  const pkgs = [
    { id: 1, folder_name: '260518-Canh quan+HTKT', package_date: '2026-05-18', missing_since: null },
    { id: 2, folder_name: '260905-HSTK cap nhat', package_date: '2026-09-05', missing_since: null },
  ]

  it('two categories under one discipline keep different last-segment packages', () => {
    const pathA = 'Z:\\DuAn\\AA\\260518-Canh quan+HTKT'
    const pathB = 'Z:\\DuAn\\AA\\260905-HSTK cap nhat'
    expect(pickLatestPackageForDiscipline(pathA, pkgs)?.folder_name).toBe('260518-Canh quan+HTKT')
    expect(pickLatestPackageForDiscipline(pathB, pkgs)?.folder_name).toBe('260905-HSTK cap nhat')
  })

  it('discipline headline picks newest among category paths', () => {
    const pathA = 'Z:\\DuAn\\AA\\260518-Canh quan+HTKT'
    const pathB = 'Z:\\DuAn\\AA\\260905-HSTK cap nhat'
    const headline = pickDisciplineHeadlinePackage([pathA, pathB], pkgs)
    expect(headline?.folder_name).toBe('260905-HSTK cap nhat')
  })

  it('changing one category path does not change another category latest', () => {
    const pathA = 'Z:\\DuAn\\AA\\260518-Canh quan+HTKT'
    const pathB = 'Z:\\DuAn\\AA\\260905-HSTK cap nhat'
    const onlyA = pickLatestPackageForDiscipline(pathA, pkgs)
    const onlyB = pickLatestPackageForDiscipline(pathB, pkgs)
    expect(onlyA?.folder_name).not.toBe(onlyB?.folder_name)
    const pathA2 = 'Z:\\DuAn\\AA\\other\\260518-Canh quan+HTKT'
    expect(pickLatestPackageForDiscipline(pathA2, pkgs)?.folder_name).toBe('260518-Canh quan+HTKT')
    expect(pickLatestPackageForDiscipline(pathB, pkgs)?.folder_name).toBe('260905-HSTK cap nhat')
  })
})

describe('designStoredPathsEqual', () => {
  it('treats normalized paths as unchanged for save skip', () => {
    expect(designStoredPathsEqual('Z:\\A\\\\B', 'Z:\\A\\B')).toBe(true)
    expect(designStoredPathsEqual('Z:\\A\\B', 'Z:\\A\\C')).toBe(false)
  })
})

describe('designScanWouldChangePackages', () => {
  const existing = [
    { folder_name: '260506-Ho So TKCS', missing_since: null },
    { folder_name: '250905-Old', missing_since: '2026-09-01' },
  ]

  it('unchanged when present set matches scan and missing stay missing', () => {
    expect(designScanWouldChangePackages(existing, ['260506-Ho So TKCS'])).toBe(false)
  })

  it('changed when scan adds a new package folder', () => {
    expect(designScanWouldChangePackages(existing, ['260506-Ho So TKCS', '260915-Phát hành TKCS'])).toBe(true)
  })

  it('changed when a present package disappears from scan', () => {
    expect(designScanWouldChangePackages(existing, [])).toBe(true)
  })

  it('changed when a previously missing package reappears', () => {
    expect(designScanWouldChangePackages(existing, ['250905-Old'])).toBe(true)
  })
})

describe('collectValidYyMmDdFolderNames', () => {
  it('includes path leaf when valid YYMMDD', () => {
    const { validNames } = collectValidYyMmDdFolderNames('Z:\\a\\260518-Canh quan', ['260915-Phát hành TKCS'])
    expect(validNames.map(n => n.toLowerCase())).toContain('260518-canh quan')
    expect(validNames).toContain('260915-Phát hành TKCS')
  })
})

describe('taskEligibleForCategoryPackageNotify', () => {
  it('filters assignees to matching category when categoryId set', () => {
    expect(taskEligibleForCategoryPackageNotify({ category_id: 3 }, 3)).toBe(true)
    expect(taskEligibleForCategoryPackageNotify({ category_id: 2 }, 3)).toBe(false)
    expect(taskEligibleForCategoryPackageNotify({ category_id: null }, 3)).toBe(false)
  })
})

describe('pickLatestPackageForDiscipline', () => {
  it('headline follows saved path leaf, not a newer dated package in DB', () => {
    const path = 'C:\\Users\\NguyenNguyenVan\\Downloads\\01 TKCS\\260518-Canh quan+HTKT'
    const pkgs = [
      { id: 1, folder_name: '260905-HSTK cap nhat', package_date: '2026-09-05', missing_since: null },
      { id: 2, folder_name: '260518-Canh quan+HTKT', package_date: '2026-05-18', missing_since: null },
    ]
    const latest = pickLatestPackageForDiscipline(path, pkgs)
    expect(latest?.folder_name).toBe('260518-Canh quan+HTKT')
    expect(latest?.package_date).toBe('2026-05-18')
  })
})

describe('pickLatestPresentPackage', () => {
  it('latest package follows the current folder scan, not missing older packages', () => {
    const pkgs = [
      { id: 1, folder_name: '250905-HSTK cap nhat', package_date: '2025-09-05', missing_since: '2026-09-30' },
      { id: 2, folder_name: '260506-Ho So TKCS', package_date: '2026-05-06', missing_since: null },
    ]
    const latest = pickLatestPresentPackage(pkgs)
    expect(latest?.folder_name).toBe('260506-Ho So TKCS')
  })
})

describe('pickPrimaryModelTask', () => {
  it('picks highest task id', () => {
    expect(pickPrimaryModelTask([{ id: 1 }, { id: 5 }, { id: 3 }])?.id).toBe(5)
  })
})

describe('modelMatrixAssigneeFromTasks', () => {
  it('uses primary task assignee name (highest id)', () => {
    const tasks = [
      { id: 2, assigned_to_name: 'Phạm Thị D' },
      { id: 9, assigned_to_name: 'Lê Văn C' },
    ]
    expect(modelMatrixAssigneeFromTasks(tasks)).toBe('Lê Văn C')
  })

  it('empty task list yields null', () => {
    expect(modelMatrixAssigneeFromTasks([])).toBe(null)
  })
})

describe('modelMatrixCvFromTasks', () => {
  const tasks = [
    { id: 2, status: 'in_progress', progress: 40, cde_report: 0 },
    { id: 9, status: 'review', progress: 75, cde_report: 1 },
  ]

  it('overview row uses primary task status, progress, and CDE flag', () => {
    expect(modelMatrixCvFromTasks(tasks)).toEqual({
      task_status: 'review',
      task_progress_percent: 75,
      task_cde_report: true,
    })
  })

  it('empty task list yields em-dash placeholders (null fields)', () => {
    expect(primaryTaskCvReportFields(null)).toEqual({
      task_status: null,
      task_progress_percent: null,
      task_cde_report: null,
    })
    expect(modelMatrixCvFromTasks([])).toEqual({
      task_status: null,
      task_progress_percent: null,
      task_cde_report: null,
    })
  })

  it('unchanged when extra design packages exist but tasks are the same', () => {
    const before = modelMatrixCvFromTasks(tasks)
    const extraPkgs = [
      { id: 100, folder_name: '260930-NewPkg', package_date: '2026-09-30' },
      { id: 101, folder_name: '261001-Another', package_date: '2026-10-01' },
    ]
    expect(extraPkgs.length).toBe(2)
    expect(modelMatrixCvFromTasks(tasks)).toEqual(before)
  })
})

describe('formatLatestPackageHeadline', () => {
  it('matches QLy HSTK status line format', () => {
    expect(
      formatLatestPackageHeadline({
        package_date: '2026-05-06',
        description: 'Ho So TKCS',
        folder_name: '260506-Ho So TKCS',
      }),
    ).toBe('06/05/2026 — Ho So TKCS')
  })
})

describe('resolveEmptyTaskDescription', () => {
  const latest = {
    id: 1,
    folder_name: '260506-Ho So TKCS',
    package_date: '2026-05-06',
    description: 'Ho So TKCS',
  }
  it('fills empty description with Cập nhật HS + package date', () => {
    expect(resolveEmptyTaskDescription('', latest)).toBe('Cập nhật HS 06/05/2026')
    expect(resolveEmptyTaskDescription(null, latest)).toBe('Cập nhật HS 06/05/2026')
  })
  it('leaves empty when latest package has no date', () => {
    expect(resolveEmptyTaskDescription('', { id: 2, folder_name: 'no-date' })).toBeNull()
  })
  it('keeps non-empty description', () => {
    expect(resolveEmptyTaskDescription('Yêu cầu riêng', latest)).toBe('Yêu cầu riêng')
  })
})

describe('modelMatrixRevisionUpdatedFromTasks', () => {
  const pkgs = [
    { id: 1, folder_name: '260506-Ho So TKCS', package_date: '2026-05-06' },
    { id: 2, folder_name: '260518-Canh quan+HTKT', package_date: '2026-05-18' },
  ]
  const map = assignRevisionNumbers(pkgs)

  it('primary task on older package shows R0 (latest discipline rev is R1)', () => {
    const tasks = [
      { id: 9, design_package_id: 1, hstk_date: '260506-Ho So TKCS', status: 'in_progress' },
    ]
    expect(modelMatrixRevisionUpdatedFromTasks(tasks, pkgs, map)).toBe('R0')
    expect(displayRevision(pkgs[1], map)).toBe('R1')
  })

  it('primary task on latest package shows same rev as current (R1 / R1)', () => {
    const tasks = [
      { id: 9, design_package_id: 2, hstk_date: '260518-Canh quan+HTKT', status: 'review' },
    ]
    expect(modelMatrixRevisionUpdatedFromTasks(tasks, pkgs, map)).toBe('R1')
  })

  it('no task yields null left rev', () => {
    expect(modelMatrixRevisionUpdatedFromTasks([], pkgs, map)).toBe(null)
  })
})

describe('collectDesignPackageNotifyRecipientUserIds', () => {
  const disciplineCode = 'KT'
  const pkgs = [
    { id: 10, folder_name: '260915-B', package_date: '2026-09-15' },
    { id: 11, folder_name: '260901-A', package_date: '2026-09-01' },
  ]
  const revMap = assignRevisionNumbers(pkgs)
  const packageIds = new Set(pkgs.map(p => p.id))

  it('includes project leader and discipline assignee, excludes unrelated member', () => {
    const leaderId = 101
    const assigneeId = 202
    const tasks = [
      {
        assigned_to: assigneeId,
        discipline_code: 'KT',
        model_filename: 'TT09-OAD-HZ-BF-M3-A-0001-HAM.rvt',
        design_package_id: 10,
      },
      {
        assigned_to: 303,
        discipline_code: 'KC',
        model_filename: 'TT09-OAD-HZ-BF-M3-S-0001.rvt',
      },
    ]
    const ids = collectDesignPackageNotifyRecipientUserIds(
      collectProjectLeaderUserIds(leaderId, []),
      tasks,
      disciplineCode,
      packageIds,
      pkgs,
      revMap,
    )
    expect(ids.sort()).toEqual([leaderId, assigneeId].sort())
    expect(ids).not.toContain(303)
  })

  it('dedupes when leader is also the task assignee', () => {
    const leaderAssignee = 55
    const tasks = [
      {
        assigned_to: leaderAssignee,
        discipline_code: 'KT',
        model_filename: 'TT09-OAD-HZ-BF-M3-A-0001.rvt',
        design_package_id: 10,
      },
    ]
    const ids = collectDesignPackageNotifyRecipientUserIds(
      collectProjectLeaderUserIds(leaderAssignee, [leaderAssignee]),
      tasks,
      disciplineCode,
      packageIds,
      pkgs,
      revMap,
    )
    expect(ids).toEqual([leaderAssignee])
  })

  it('includes assignee linked only via Theo HSTK folder name on discipline packages', () => {
    const assigneeId = 404
    const tasks = [
      {
        assigned_to: assigneeId,
        discipline_code: null,
        hstk_date: '260915-B',
        model_filename: null,
        design_package_id: null,
      },
    ]
    const ids = collectDesignPackageNotifyRecipientUserIds([], tasks, disciplineCode, packageIds, pkgs, revMap)
    expect(ids).toEqual([assigneeId])
  })
})

describe('project dashboard HSTK stats', () => {
  const pkgs = [
    { id: 1, folder_name: '260506-Ho So TKCS', package_date: '2026-05-06', missing_since: '2026-09-30' },
    { id: 2, folder_name: '260518-Canh quan+HTKT', package_date: '2026-05-18', missing_since: '2026-09-30' },
    { id: 3, folder_name: '260905-HSTK cap nhat', package_date: '2026-09-05', missing_since: '2026-09-30' },
    { id: 4, folder_name: '261001-Phat hanh moi', package_date: '2026-10-01', missing_since: null },
  ]

  it('does not emit không còn trên NAS for missing historical packages', () => {
    const blockers = dashboardPackageMissingNasBlockers(pkgs)
    expect(blockers.some(b => b.includes('không còn trên NAS'))).toBe(false)
    expect(blockers).toEqual([])
  })

  it('recent timeline list is capped at the 3 newest by package date', () => {
    const recent = dashboardTimelinePackages(pkgs, 3)
    expect(recent).toHaveLength(3)
    expect(recent.map(p => p.folder_name)).toEqual([
      '261001-Phat hanh moi',
      '260905-HSTK cap nhat',
      '260518-Canh quan+HTKT',
    ])
  })
})

describe('summarizeDashboardFromOverview', () => {
  it('returns empty discipline summaries without throwing when no disciplines configured', () => {
    const out = summarizeDashboardFromOverview({ disciplines: [] }, { overdue_tasks: 3 })
    expect(out.discSummaries).toEqual([])
    expect(out.categoryMatrix).toEqual({})
    expect(out.blockers).toContain('Có task trễ hạn')
  })
})

describe('applyProjectDesignDisciplineDeclaration', () => {
  it('save [A,B] then [A] removes B from project list, keeps A and leader', async () => {
    const { db, rows, codesForProject } = createProjectDesignDisciplineTestDb()
    await applyProjectDesignDisciplineDeclaration(db, 1, [
      { discipline_code: 'A', role_codes: 'A', leader_id: 10 },
      { discipline_code: 'B', role_codes: 'B', leader_id: 20 },
    ])
    expect(codesForProject(1)).toEqual(['A', 'B'])
    await applyProjectDesignDisciplineDeclaration(db, 1, [
      { discipline_code: 'A', role_codes: 'A', leader_id: 10 },
    ])
    expect(codesForProject(1)).toEqual(['A'])
    expect(rows.get('1:null:A')?.leader_id).toBe(10)
    expect(rows.has('1:null:B')).toBe(false)
  })

  it('phase A disciplines are not removed when unchecking on phase B', async () => {
    const { db, codesForProject } = createProjectDesignDisciplineTestDb()
    await applyProjectDesignDisciplineDeclaration(
      db,
      1,
      [
        { discipline_code: 'AA', role_codes: 'AA', leader_id: 1 },
        { discipline_code: 'ES', role_codes: 'ES', leader_id: 2 },
      ],
      10,
    )
    await applyProjectDesignDisciplineDeclaration(
      db,
      1,
      [{ discipline_code: 'AA', role_codes: 'AA', leader_id: 1 }],
      20,
    )
    expect(codesForProject(1, 10)).toEqual(['AA', 'ES'])
    expect(codesForProject(1, 20)).toEqual(['AA'])
  })

  it('unchecking a discipline removes it from that phase only', async () => {
    const { db, codesForProject } = createProjectDesignDisciplineTestDb()
    await applyProjectDesignDisciplineDeclaration(
      db,
      1,
      [
        { discipline_code: 'AA', role_codes: 'AA', leader_id: null },
        { discipline_code: 'ES', role_codes: 'ES', leader_id: null },
      ],
      5,
    )
    await applyProjectDesignDisciplineDeclaration(db, 1, [{ discipline_code: 'AA', role_codes: 'AA', leader_id: null }], 5)
    expect(codesForProject(1, 5)).toEqual(['AA'])
  })
})

function createProjectDesignPhaseTestDb() {
  type PhaseRow = { id: number; project_id: number; name: string; code: string; sort_order: number }
  let nextId = 1
  const phases: PhaseRow[] = []
  const db = {
    prepare(sql: string) {
      const binds: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          binds.push(...args)
          return stmt
        },
        async all() {
          if (sql.includes('FROM project_design_phases WHERE project_id')) {
            const projectId = binds[0] as number
            return { results: phases.filter(p => p.project_id === projectId) }
          }
          return { results: [] }
        },
        async first() {
          if (sql.includes('SELECT COUNT(*) AS c FROM project_design_disciplines')) {
            return { c: 0 }
          }
          return null
        },
        async run() {
          if (sql.includes('INSERT INTO project_design_phases')) {
            const [projectId, name, code, sortOrder] = binds as [number, string, string, number]
            phases.push({ id: nextId++, project_id: projectId, name, code, sort_order: sortOrder })
          } else if (sql.includes('UPDATE project_design_phases SET name')) {
            const [name, code, sortOrder, id, projectId] = binds as [string, string, number, number, number]
            const row = phases.find(p => p.id === id && p.project_id === projectId)
            if (row) {
              row.name = name
              row.code = code
              row.sort_order = sortOrder
            }
          } else if (sql.includes('DELETE FROM project_design_phases')) {
            const [id, projectId] = binds as [number, number]
            const idx = phases.findIndex(p => p.id === id && p.project_id === projectId)
            if (idx >= 0) phases.splice(idx, 1)
          }
          return { meta: { last_row_id: nextId - 1 } }
        },
      }
      return stmt
    },
  }
  return { db: db as unknown as D1Database, phases }
}

describe('applyProjectDesignPhases', () => {
  it('rejects ad-hoc phase codes not in execution catalog', async () => {
    const { db, phases } = createProjectDesignPhaseTestDb()
    const bad = await applyProjectDesignPhases(db, 1, [{ code: 'HIENTAI', name: 'Hiện tại' }])
    expect(bad.error).toMatch(/giai đoạn thực hiện/)
    expect(phases).toHaveLength(0)
  })

  it('creates sheets from execution phase keys (tasks.phase)', async () => {
    const { db, phases } = createProjectDesignPhaseTestDb()
    const ok = await applyProjectDesignPhases(db, 1, [
      { execution_phase_key: 'technical_design' },
      { execution_phase_key: 'basic_design' },
    ])
    expect(ok.error).toBeUndefined()
    expect(phases.map(p => p.code).sort()).toEqual(['basic_design', 'technical_design'])
  })
})

describe('filterModelMatrixTasksForDesignSheet', () => {
  const mixed = [
    { id: 1, title: 'TKCS task', phase: 'basic_design' },
    { id: 2, title: 'TKKT task', phase: 'technical_design' },
    { id: 3, title: 'legacy task', phase: '' },
  ]

  it('keeps only tasks matching TKKT sheet', () => {
    const tkkt = filterModelMatrixTasksForDesignSheet(mixed, 'technical_design')
    expect(tkkt.map(t => t.id)).toEqual([2])
    expect(tkkt.some(t => t.phase === 'basic_design')).toBe(false)
  })

  it('keeps only empty-phase tasks on legacy sheet', () => {
    const legacy = filterModelMatrixTasksForDesignSheet(mixed, null)
    expect(legacy.map(t => t.id)).toEqual([3])
  })

  it('excludes null-phase tasks from execution sheets', () => {
    expect(taskPhaseMatchesDesignSheet(null, 'basic_design')).toBe(false)
    expect(taskPhaseMatchesDesignSheet('basic_design', 'technical_design')).toBe(false)
  })
})

describe('taskPhaseKeyForDesignSheet', () => {
  it('returns tasks.phase key for active QLy sheet', () => {
    const phases = [
      { id: 10, code: 'basic_design', execution_phase_key: 'basic_design' },
      { id: 11, code: 'technical_design', execution_phase_key: 'technical_design' },
    ]
    expect(taskPhaseKeyForDesignSheet(11, phases)).toBe('technical_design')
    expect(taskPhaseKeyForDesignSheet(null, phases)).toBeNull()
  })

  it('recognizes TKCS alias as basic_design', () => {
    expect(isProjectExecutionPhaseKey('TKCS')).toBe(true)
    expect(isProjectExecutionPhaseKey('HIENTAI')).toBe(false)
  })
})

describe('designDisciplineMatchesPhaseFilter', () => {
  it('null-phase rows match legacy sheet only', () => {
    expect(designDisciplineMatchesPhaseFilter(null, 'legacy')).toBe(true)
    expect(designDisciplineMatchesPhaseFilter(null, 3)).toBe(false)
    expect(designDisciplineMatchesPhaseFilter(3, 3)).toBe(true)
    expect(designDisciplineMatchesPhaseFilter(3, 'legacy')).toBe(false)
  })
})

describe('buildHstkReference', () => {
  const pkgs = [
    { id: 10, folder_name: '260915-B', package_date: '2026-09-15' },
    { id: 11, folder_name: '260901-A', package_date: '2026-09-01' },
  ]
  const map = assignRevisionNumbers(pkgs)
  it('uses linked package', () => {
    expect(buildHstkReference({ hstk_date: '260915-B', design_package_id: 10 }, pkgs, map)).toContain('260915-B')
  })
  it('falls back to raw hstk_date', () => {
    expect(buildHstkReference({ hstk_date: 'custom-label', design_package_id: null }, pkgs, map)).toBe('custom-label')
  })
})
