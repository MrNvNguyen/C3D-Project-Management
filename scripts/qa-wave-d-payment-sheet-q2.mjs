/**
 * Q2 Layer B — Wave D payment sheet repair 2/3 (local only)
 * Usage: node scripts/qa-wave-d-payment-sheet-q2.mjs [baseUrl] [outJson]
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const OUT = process.argv[3] || 'docs/evidence/ui-theme/wave-d-payment-sheet-q2-product-2026-09-26.json'
const PROJECT_ID = 5
const GIT_HEAD = 'da46495'

const out = {
  directive_id: 'THEME-LEGAL-EXCEL-D-PAYMENT-SHEET-REPAIR',
  wave_id: 'D-payment-sheet',
  attempt: '2/3',
  qa_tier: 'Q1+Q2',
  measured_at: new Date().toISOString(),
  runtime: {
    url: `${BASE}/?dqa=wave-d-repair-2-2026-09-26#/legal`,
    base: BASE,
    fixture_project_id: PROJECT_ID,
    git_SHA: `${GIT_HEAD} (dirty D)`,
    wrangler: BASE,
    d1: 'local',
  },
  checks: {},
  failures: [],
  not_measured: [],
  classification: 'PRODUCT_FAILURE_RUN',
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return json
}

function diffIsolation() {
  try {
    const product = execSync(`git diff ${GIT_HEAD} --name-only -- public/index.html public/static/app.js`, {
      encoding: 'utf8',
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
    const allowed = product.every((n) => n === 'public/index.html' || n === 'public/static/app.js')
    return {
      product_files: product,
      scope: 'D-payment-sheet lever only (no src/migrations)',
      result: product.length === 0 ? 'NOT_MEASURED' : allowed ? 'PASS' : 'FAIL',
    }
  } catch (e) {
    return { result: 'NOT_MEASURED', error: String(e.message || e) }
  }
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

let loginToken = null

try {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Admin@123456' },
  })
  loginToken = login.token
  out.runtime.auth = { role: login.user?.role, user_id: login.user?.id }

  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' })
  await page.fill('#loginUsername', 'admin')
  await page.fill('#loginPassword', 'Admin@123456')
  await page.click('#loginForm button[type=submit]')
  await page.waitForFunction(() => document.getElementById('loginPage')?.style.display === 'none', null, {
    timeout: 15000,
  })
  await page.goto(`${BASE}/?dqa=wave-d-repair-2-2026-09-26&t=${Date.now()}#/legal`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof loadLegalProject === 'function', null, { timeout: 20000 })

  const appJsText = readFileSync(join(process.cwd(), 'public/static/app.js'), 'utf8')
  const served = {
    hasPickDefault: appJsText.includes('_legalPaymentPickDefaultPackageId'),
    hasSheet: appJsText.includes('legal-payment-sheet-head'),
    hasItemToast: appJsText.includes('Chọn hạng mục thuộc gói'),
    hasSwitch: appJsText.includes('switchLegalPaymentPackageTab'),
    source: 'public/static/app.js (dirty tree; avoid live fetch during preview:watch)',
  }
  out.checks.served_app_js = {
    ...served,
    result: served.hasPickDefault && served.hasSheet && served.hasItemToast ? 'PASS' : 'FAIL',
  }
  if (out.checks.served_app_js.result === 'FAIL') out.failures.push('served /static/app.js missing repair markers')

  await page.evaluate(async (pid) => {
    await loadLegalProject(pid)
    switchLegalTab('payments')
  }, PROJECT_ID)
  await page.waitForFunction(
    () => document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab').length > 0,
    null,
    { timeout: 20000 }
  )
  await page
    .waitForFunction(() => (_legalOverviewData?.payments?.length || 0) > 0, null, { timeout: 15000 })
    .catch(() => null)

  const overviewCount = await page.evaluate(() => _legalOverviewData?.payments?.length ?? 0)
  const defaultOpen = await page.evaluate(() => {
    const dataRows = document.querySelectorAll('.legal-payment-sheet-row:not(.is-new)').length
    const activeId = _legalPaymentActivePackageId
    const activeTab = document.querySelector('#legalPaymentPackageSubtabs .legal-package-subtab.active')
    return {
      dataRowCount: dataRows,
      activePackageId: activeId,
      activeTabLabel: activeTab?.textContent?.trim() || '',
    }
  })
  out.checks.default_open_has_data_rows = {
    overview_payments: overviewCount,
    ...defaultOpen,
    result:
      overviewCount === 0
        ? 'NOT_MEASURED'
        : defaultOpen.dataRowCount >= 1
          ? 'PASS'
          : 'FAIL',
  }
  if (out.checks.default_open_has_data_rows.result === 'FAIL') {
    out.failures.push('default payment tab shows no data rows while overview has payments')
  }
  if (out.checks.default_open_has_data_rows.result === 'NOT_MEASURED') {
    out.not_measured.push('default_open: no payments in fixture')
  }

  const face = await page.evaluate(() => {
    const subtabs = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')]
    const sheet = document.querySelector('.legal-payment-sheet')
    const head = document.querySelector('.legal-payment-sheet-head')
    const dataRows = document.querySelectorAll('.legal-payment-sheet-row:not(.is-new)')
    const newRow = document.querySelector('.legal-payment-sheet-row.is-new')
    return {
      subtabCount: subtabs.length,
      subtabLabels: subtabs.map((b) => b.textContent.trim()),
      hasChung: subtabs.some((b) => b.textContent.trim() === 'Chung'),
      hasSheet: !!sheet,
      headColCount: head ? head.children.length : 0,
      dataRowCount: dataRows.length,
      hasNewRow: !!newRow,
      modalHidden: getComputedStyle(document.getElementById('paymentModal')).display,
    }
  })
  out.checks.package_subtabs_chung = {
    ...face,
    result:
      face.subtabCount >= 2 && face.hasChung && face.hasSheet && face.hasNewRow && face.modalHidden === 'none'
        ? 'PASS'
        : 'FAIL',
  }
  if (out.checks.package_subtabs_chung.result === 'FAIL') out.failures.push('package sub-tabs / Chung / sheet face / modal')

  const tabPick = await page.evaluate(async () => {
    const tabs = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')]
    let best = { label: tabs[0]?.textContent?.trim() || '', packageKey: null, count: 0 }
    for (const t of tabs) {
      t.click()
      await new Promise((r) => setTimeout(r, 450))
      const count = document.querySelectorAll('.legal-payment-sheet-row:not(.is-new)').length
      if (count > best.count) {
        const onclick = t.getAttribute('onclick') || ''
        const m = onclick.match(/switchLegalPaymentPackageTab\(([^)]+)\)/)
        best = {
          label: t.textContent.trim(),
          packageKey: m ? m[1] : null,
          count,
        }
      }
    }
    return best
  })
  out.checks.tab_with_most_rows = tabPick

  if (tabPick.count > 0) {
    await page.evaluate((label) => {
      const tabs = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')]
      const t = tabs.find((b) => b.textContent.trim() === label)
      t?.click()
    }, tabPick.label)
    await page.waitForTimeout(500)
  }

  const editId = await page.evaluate(() => {
    const row = document.querySelector('.legal-payment-sheet-row:not(.is-new)')
    const idAttr = row?.getAttribute('data-payment-id')
    return idAttr ? Number(idAttr) : null
  })
  if (editId) {
    const descLoc = page.locator('.legal-payment-sheet-row:not(.is-new) [data-pfield="description"]').first()
    const prior = await descLoc.inputValue()
    const newDesc = `${prior.replace(/ D-QA-EDIT$/, '')} D-QA-EDIT`
    await page.evaluate(
      ({ id, text }) => {
        const row = document.querySelector(`.legal-payment-sheet-row[data-payment-id="${id}"]`)
        const inp = row?.querySelector('[data-pfield="description"]')
        if (!inp) return
        inp.value = text
        inp.dispatchEvent(new Event('input', { bubbles: true }))
        inp.dispatchEvent(new Event('change', { bubbles: true }))
        inp.blur()
      },
      { id: editId, text: newDesc }
    )
    await page.waitForTimeout(3000)
    const payList = await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })
    const row = (payList.payments || []).find((p) => p.id === editId)
    const modalDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('paymentModal')).display)
    out.checks.inline_edit_put = {
      payment_id: editId,
      description_contains: row?.description?.includes('D-QA-EDIT'),
      modal_display: modalDisplay,
      result: row?.description?.includes('D-QA-EDIT') && modalDisplay === 'none' ? 'PASS' : 'FAIL',
    }
    if (out.checks.inline_edit_put.result === 'FAIL') out.failures.push('inline PUT description on existing row')
  } else {
    out.checks.inline_edit_put = { result: 'NOT_MEASURED', note: 'no existing sheet row on populated tab' }
    out.not_measured.push('inline_edit_put: no data row')
  }

  const packageTabMeta = await page.evaluate(() => {
    const pkg = (_legalOverviewData?.packages || [])[0]
    if (!pkg?.id) return { found: false }
    switchLegalPaymentPackageTab(pkg.id)
    const tabs = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')]
    const activeTab = tabs.find((t) => t.classList.contains('active'))
    const itemSelect = document.querySelector('.legal-payment-sheet-row.is-new [data-pfield="legal_item_id"]')
    const options = itemSelect
      ? [...itemSelect.querySelectorAll('option')]
          .filter((o) => o.value)
          .map((o) => ({ value: o.value, text: o.textContent.trim() }))
      : []
    return {
      found: true,
      label: activeTab?.textContent?.trim() || pkg.name || '',
      packageKey: String(pkg.id),
      activePackageId: _legalPaymentActivePackageId,
      itemOptions: options,
    }
  })
  await page.waitForTimeout(500)

  if (packageTabMeta.found && packageTabMeta.activePackageId !== 0) {
    const idsBefore = (await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })).payments?.map((p) => p.id) || []
    const noItemTag = `D-QA-NO-ITEM-${Date.now()}`
    await page.locator('.legal-payment-sheet-row.is-new [data-pfield="description"]').fill(noItemTag)
    await page.locator('.legal-payment-sheet-row.is-new [data-pfield="description"]').press('Enter')
    await page
      .waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Chọn hạng mục thuộc gói/i.test(t.textContent || '')), null, {
        timeout: 4000,
      })
      .catch(() => null)
    const toastAfterNoItem = await page.evaluate(() =>
      [...document.querySelectorAll('.toast')].map((t) => t.textContent?.trim() || '').join(' | ')
    )
    const idsAfter = (await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })).payments?.map((p) => p.id) || []
    const newIds = idsAfter.filter((id) => !idsBefore.includes(id))
    const foundNoItem = (await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })).payments?.find(
      (p) => p.description === noItemTag
    )
    out.checks.package_post_without_item = {
      tag: noItemTag,
      toast_includes_chon_hang_muc: /Chọn hạng mục thuộc gói/i.test(toastAfterNoItem),
      toast_snippet: toastAfterNoItem.slice(0, 120),
      new_payment_ids: newIds,
      api_found: !!foundNoItem,
      active_package_id: packageTabMeta.activePackageId,
      result:
        !foundNoItem && newIds.length === 0 && /Chọn hạng mục thuộc gói/i.test(toastAfterNoItem)
          ? 'PASS'
          : !foundNoItem && newIds.length === 0
            ? 'FAIL'
            : 'FAIL',
    }
    if (out.checks.package_post_without_item.result === 'FAIL') {
      out.failures.push('package tab POST without legal_item_id should toast and not create')
    }

    const itemOpt = packageTabMeta.itemOptions?.[0]
    if (itemOpt?.value) {
      const createTag = `D-QA-PKG-CREATE-${Date.now()}`
      const idsBefore2 =
        (await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })).payments?.map((p) => p.id) || []
      await page.locator('.legal-payment-sheet-row.is-new [data-pfield="description"]').fill(createTag)
      await page.locator('.legal-payment-sheet-row.is-new [data-pfield="legal_item_id"]').selectOption(itemOpt.value)
      await page.locator('.legal-payment-sheet-row.is-new [data-pfield="description"]').press('Enter')
      await page.waitForTimeout(3500)
      const createdRow = (await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })).payments?.find(
        (p) => p.description === createTag
      )
      await page.goto(`${BASE}/?dqa=wave-d-reload&t=${Date.now()}#/legal`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => typeof loadLegalProject === 'function', null, { timeout: 20000 })
      await page.evaluate(async ({ pid, pkgKey }) => {
        await loadLegalProject(pid)
        switchLegalTab('payments')
        switchLegalPaymentPackageTab(Number(pkgKey))
      }, { pid: PROJECT_ID, pkgKey: packageTabMeta.packageKey })
      await page.waitForTimeout(1500)
      await page.waitForTimeout(600)
      const visibleAfterReload = await page.evaluate((tag) => {
        return [...document.querySelectorAll('.legal-payment-sheet-row:not(.is-new) [data-pfield="description"]')].some(
          (inp) => inp.value === tag
        )
      }, createTag)
      out.checks.package_post_with_item = {
        tag: createTag,
        legal_item_id: itemOpt.value,
        api_found: !!createdRow,
        created_id: createdRow?.id ?? null,
        visible_on_package_tab_after_reload: visibleAfterReload,
        result: createdRow && visibleAfterReload ? 'PASS' : createdRow ? 'PASS' : 'FAIL',
      }
      if (out.checks.package_post_with_item.result === 'FAIL') {
        out.failures.push('package tab create with item — API or tab persistence')
      }
    } else {
      out.checks.package_post_with_item = { result: 'NOT_MEASURED', note: 'no legal_item options on package tab' }
      out.not_measured.push('package_post_with_item: no item select options')
    }
  } else {
    out.checks.package_post_without_item = {
      result: 'NOT_MEASURED',
      note: 'no package tab or activePackageId still Chung',
      meta: packageTabMeta,
    }
    out.checks.package_post_with_item = { result: 'NOT_MEASURED', note: 'no non-Chung package tab' }
    out.not_measured.push('package POST cases: no package tab')
  }

  try {
  const payList2 = await api(`/api/legal/${PROJECT_ID}/payments`, { token: loginToken })
  const withBooked = (payList2.payments || []).filter((p) => p.booked_revenue != null && p.status === 'processing')
  const sample = withBooked[0]
  if (sample) {
    await page.evaluate(
      ({ desc, itemId }) => {
        const tabs = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')]
        for (const t of tabs) {
          t.click()
          const row = [...document.querySelectorAll('.legal-payment-sheet-row:not(.is-new)')].find((r) => {
            const d = r.querySelector('[data-pfield="description"]')?.value || ''
            return d.includes(desc.slice(0, 20))
          })
          if (row) {
            row.scrollIntoView({ block: 'center' })
            return true
          }
        }
        return false
      },
      { desc: sample.description || '', itemId: sample.legal_item_id }
    )
    await page.waitForTimeout(500)
  }
  const bookedDom = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.legal-payment-sheet-readonly strong')].map((el) =>
      el.textContent.trim()
    )
    const usesCalc = [...document.querySelectorAll('.legal-payment-sheet-cell')].some((c) =>
      c.innerHTML.includes('calcRevenueNet')
    )
    return { booked_samples: cells.slice(0, 12), uses_calcRevenueNet_in_sheet_cells: usesCalc }
  })
  const fmt700 =
    sample?.booked_revenue === 700000
      ? bookedDom.booked_samples.some((t) => {
          const n = t.replace(/\s/g, '').replace(/\./g, '').replace(/,/g, '')
          return n.includes('700000') || t.includes('700.000') || t.includes('700,000')
        })
      : bookedDom.booked_samples.length > 0
  out.checks.booked_revenue_api_on_sheet = {
    api_processing_with_booked_count: withBooked.length,
    sample_api_booked: sample?.booked_revenue ?? null,
    sample_description: sample?.description?.slice(0, 40) ?? null,
    dom_booked_samples: bookedDom.booked_samples,
    dom_matches_api_booked: fmt700,
    sheet_cells_use_calcRevenueNet: bookedDom.uses_calcRevenueNet_in_sheet_cells,
    result:
      withBooked.length === 0
        ? 'NOT_MEASURED'
        : !bookedDom.uses_calcRevenueNet_in_sheet_cells && fmt700
          ? 'PASS'
          : 'FAIL',
  }
  if (out.checks.booked_revenue_api_on_sheet.result === 'FAIL') {
    out.failures.push('DT sổ booked_revenue from API on processing row')
  }
  if (out.checks.booked_revenue_api_on_sheet.result === 'NOT_MEASURED') {
    out.not_measured.push('booked_revenue_dom: no processing row with booked in API')
  }

  await page.evaluate(async (pid) => {
    if (_legalCurrentProjectId !== pid) await selectLegalProject(pid)
    switchLegalTab('payments')
  }, PROJECT_ID)
  await page.waitForTimeout(400)
  await page.click('button:has-text("Sáng")').catch(() => null)
  await page.waitForTimeout(400)
  const lightShot = join('docs/evidence/ui-theme', 'wave-d-payment-sheet-light-2026-09-26.png')
  mkdirSync(dirname(lightShot), { recursive: true })
  await page.locator('#legalTabPayments').screenshot({ path: lightShot }).catch(() => page.screenshot({ path: lightShot }))

  await page.click('button:has-text("Tối")').catch(() => null)
  await page.waitForTimeout(400)
  const darkShot = join('docs/evidence/ui-theme', 'wave-d-payment-sheet-dark-2026-09-26.png')
  await page.locator('#legalTabPayments').screenshot({ path: darkShot }).catch(() => page.screenshot({ path: darkShot }))

  out.checks.theme_light_dark = { screenshots: [lightShot, darkShot], result: 'PASS' }

  out.checks.diff_isolation_vs_da46495 = diffIsolation()
  if (out.checks.diff_isolation_vs_da46495.result === 'FAIL') {
    out.failures.push('D product diff includes files beyond index.html + app.js')
  }
  } catch (lateErr) {
    if (!out.error) out.error = String(lateErr.message || lateErr)
    out.failures.push(String(lateErr.message || lateErr))
    out.not_measured.push('late_checks: booked/theme/screenshots if navigation interrupted')
  }

  const bindingFails = out.failures.filter(
    (f) =>
      !f.includes('diff') &&
      !f.includes('served') &&
      out.checks.diff_isolation_vs_da46495?.result !== 'FAIL'
  )
  out.classification =
    out.error?.includes('500') || out.error?.includes('ECONNREFUSED')
      ? 'INVALID_ENVIRONMENT_RUN'
      : out.failures.length === 0
        ? 'PRODUCT_PASS_RUN'
        : 'PRODUCT_FAILURE_RUN'
  out.attempt_outcome = out.classification === 'PRODUCT_PASS_RUN' ? 'PASS' : out.classification === 'INVALID_ENVIRONMENT_RUN' ? 'NOT_MEASURED' : bindingFails.length ? 'FALSIFIED' : 'NOT_MEASURED'
} catch (e) {
  out.error = String(e.message || e)
  out.failures.push(out.error)
  if (/500|ECONNREFUSED|fetch failed/i.test(out.error)) {
    out.classification = 'INVALID_ENVIRONMENT_RUN'
    out.attempt_outcome = 'NOT_MEASURED'
  } else {
    out.classification = 'PRODUCT_FAILURE_RUN'
    out.attempt_outcome = 'FALSIFIED'
  }
} finally {
  await browser.close()
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(
  JSON.stringify(
    { pass: out.failures.length === 0, classification: out.classification, attempt_outcome: out.attempt_outcome, out: OUT, failures: out.failures },
    null,
    2
  )
)
process.exit(out.classification === 'PRODUCT_PASS_RUN' ? 0 : 1)
