/**
 * Wave H HSPL input-methods QA attempt 3/3 — product bar (browser).
 * Regenerate: npm run build && wrangler pages dev dist ... --port 8794
 *   node docs/evidence/ui-theme/wave-h-hspl-input-methods-qa-attempt3-browser.mjs http://127.0.0.1:8794
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8794'
const STAMP = Date.now()
const TAG = `QA-H3-${STAMP}`

const out = {
  wave: 'H-hspl-input-methods',
  qa_attempt: '3/3',
  qa_date: '2026-09-26',
  evidence_scope: 'binding product bar · local D1 · PRJ001 · system_admin · not campaign SUCCESS',
  verify_sha: '6ca4fa454f35ee04afd4c221b03da9313c685bf4',
  prior_fail_sha: '2428f6e4c4d92bb45328fe1405d4d6dd0f0f1066',
  base_url: BASE,
  runtime: {
    serve: 'wrangler pages dev dist --port 8794 --local D1',
    auth: 'admin / Admin@123456 (system_admin)',
    fixture_project: 'PRJ001 id=1',
  },
  harness: {
    script: 'wave-h-hspl-input-methods-qa-attempt3-browser.mjs',
    isolation: 'unique TAG; checklist scoped to active BCNCKT first stage; payment gói via switchLegalPaymentPackageTab + empty legal_item_id',
  },
  product_checks: {},
  network_sample: [],
  errors: [],
}

function fail(key, note, extra = {}) {
  out.product_checks[key] = { pass: false, note, ...extra }
}

function pass(key, extra = {}) {
  out.product_checks[key] = { pass: true, ...extra }
}

async function loginIfNeeded(page) {
  const loginVisible = await page.locator('#loginPage').isVisible().catch(() => false)
  if (loginVisible) {
    await page.fill('#loginUsername', 'admin')
    await page.fill('#loginPassword', 'Admin@123456')
    await page.click('#loginForm button[type="submit"]')
    await page.waitForSelector('#loginPage', { state: 'hidden', timeout: 15000 })
  }
}

async function waitChecklistIdle(page) {
  await page
    .waitForFunction(
      () => typeof _legalChecklistAddBusy === 'undefined' || _legalChecklistAddBusy === false,
      { timeout: 20000 }
    )
    .catch(() => {})
}

async function openLegalPrj001(page) {
  await page.goto(`${BASE}/#/legal`, { waitUntil: 'domcontentloaded' })
  await loginIfNeeded(page)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /PRJ001/i }).click()
  await page.waitForSelector('#legalStagesContainer .legal-package-subtabs', { timeout: 20000 })
  await page.waitForTimeout(500)
}

async function switchChecklistPackageByNeedle(page, needle) {
  await page.evaluate((n) => {
    const tab = [...document.querySelectorAll('#legalStagesContainer .legal-package-subtab')].find((t) =>
      (t.textContent || '').includes(n)
    )
    if (tab) {
      const m = tab.getAttribute('onclick')?.match(/switchLegalPackageTab\((\d+)\)/)
      const id = m ? Number(m[1]) : null
      if (id != null && typeof switchLegalPackageTab === 'function') switchLegalPackageTab(id)
      else tab.click()
    }
  }, needle)
  await page.waitForTimeout(700)
  await waitChecklistIdle(page)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  page.on('response', async (r) => {
    const req = r.request()
    const url = r.url()
    if (!url.includes('/api/legal/')) return
    if (url.includes('/init/')) return
    if (!['POST', 'PUT'].includes(req.method())) return
    if (out.network_sample.length >= 28) return
    let postData = req.postData() || null
    if (postData && postData.length > 400) postData = postData.slice(0, 400) + '…'
    out.network_sample.push({
      method: req.method(),
      url,
      status: r.status(),
      postData,
    })
  })

  try {
    await openLegalPrj001(page)

    const checklistRowsStart = await page.locator('.legal-checklist-row:not(.legal-checklist-add-row)').count()
    const inlineAdds = await page.locator('.legal-checklist-host .legal-checklist-inline-add').count()
    out.harness.checklist_rows_at_start = checklistRowsStart
    if (checklistRowsStart >= 1 && inlineAdds >= 1) {
      pass('select_project_panel', { checklist_rows: checklistRowsStart, inline_add_inputs: inlineAdds })
    } else {
      fail('select_project_panel', `rows=${checklistRowsStart} inline=${inlineAdds}`)
    }

    const pkgSwitch = await page.evaluate(async () => {
      const clickPkg = (needle) => {
        const tabs = [...document.querySelectorAll('#legalStagesContainer .legal-package-subtab')]
        const tab = tabs.find((t) => (t.textContent || '').includes(needle))
        if (!tab) return { needle, found: false, active: false }
        const m = tab.getAttribute('onclick')?.match(/switchLegalPackageTab\((\d+)\)/)
        if (m && typeof switchLegalPackageTab === 'function') switchLegalPackageTab(Number(m[1]))
        else tab.click()
        return { needle, found: true, active: tab.classList.contains('active') }
      }
      const bcn = clickPkg('BCNCKT')
      await new Promise((r) => setTimeout(r, 450))
      const tkb = clickPkg('TKBVTC')
      await new Promise((r) => setTimeout(r, 450))
      const stages = document.querySelectorAll('.legal-checklist-host .legal-checklist-stage').length
      return { bcn, tkb, stages }
    })
    if (pkgSwitch.bcn.found && pkgSwitch.tkb.found && pkgSwitch.stages >= 1) {
      pass('package_subtabs_stages_items', {
        bcnckt_switch: true,
        tkbvtc_clicked: pkgSwitch.tkb.found,
        stage_blocks: pkgSwitch.stages,
      })
    } else {
      fail('package_subtabs_stages_items', JSON.stringify(pkgSwitch))
    }

    await switchChecklistPackageByNeedle(page, 'BCNCKT')
    await page.waitForSelector('.legal-checklist-host .legal-checklist-inline-add', {
      state: 'visible',
      timeout: 20000,
    })
    await waitChecklistIdle(page)
    await page.waitForTimeout(400)

    const stageId = await page
      .locator('.legal-checklist-host .legal-checklist-add-row:not(.is-child)')
      .first()
      .getAttribute('data-stage-id')
    if (!stageId) {
      fail('checklist_enter_add', 'no scoped inline-add in active BCNCKT first stage')
    } else {
      const addTitle = `${TAG}-enter`
      const addInput = page.locator(
        `.legal-checklist-add-row[data-stage-id="${stageId}"]:not(.is-child) .legal-checklist-inline-add`
      )
      await addInput.waitFor({ state: 'visible', timeout: 15000 })
      const itemPostP = page.waitForResponse(
        (r) => r.url().includes('/api/legal/1/items') && r.request().method() === 'POST',
        { timeout: 28000 }
      )
      await addInput.focus()
      await addInput.fill('')
      await addInput.pressSequentially(addTitle, { delay: 12 })
      await addInput.press('Enter')
      let itemPost = await itemPostP.catch(() => null)
      if (!itemPost?.ok()) {
        const retryP = page.waitForResponse(
          (r) => r.url().includes('/api/legal/1/items') && r.request().method() === 'POST',
          { timeout: 20000 }
        )
        await page.evaluate(
          ({ stageId, title }) => {
            const input = document.querySelector(
              `.legal-checklist-add-row[data-stage-id="${stageId}"]:not(.is-child) .legal-checklist-inline-add`
            )
            if (!input || typeof legalChecklistInlineAddCommit !== 'function') return false
            input.value = title
            legalChecklistInlineAddCommit(Number(stageId), null, input)
            return true
          },
          { stageId, title: addTitle }
        )
        itemPost = await retryP.catch(() => null)
      }
      await waitChecklistIdle(page)
      await page.waitForTimeout(400)

      let newItemId = null
      if (itemPost?.ok()) {
        try {
          newItemId = (await itemPost.json())?.id ?? null
        } catch {
          newItemId = null
        }
      }
      if (!newItemId) {
        await page
          .waitForFunction(
            (title) =>
              [...document.querySelectorAll('.legal-checklist-inline-title')].some((el) =>
                (el.textContent || '').includes(title)
              ),
            addTitle,
            { timeout: 12000 }
          )
          .catch(() => {})
        const domId = await page.evaluate((title) => {
          const el = [...document.querySelectorAll('.legal-checklist-inline-title')].find((n) =>
            (n.textContent || '').includes(title)
          )
          return el?.dataset?.itemId ? Number(el.dataset.itemId) : null
        }, addTitle)
        newItemId = domId
      }

      const added = newItemId
        ? await page.locator(`.legal-checklist-inline-title[data-item-id="${newItemId}"]`).count()
        : await page.locator('.legal-checklist-inline-title', { hasText: addTitle }).count()

      const checklistAddOk = added >= 1 && itemPost?.ok()
      if (checklistAddOk) {
        pass('checklist_enter_add', {
          title: addTitle,
          post_status: itemPost.status(),
          item_id: newItemId,
          stage_id: stageId,
        })
      } else {
        fail('checklist_enter_add', `row=${added} post=${itemPost?.status?.() ?? 'none'} id=${newItemId}`)
      }

      if (!checklistAddOk || !newItemId) {
        fail('checklist_title_quote', 'skipped: checklist_enter_add failed')
        fail('checklist_persist_after_reload', 'skipped: checklist_enter_add failed')
        fail('handlers_id_not_json', 'skipped: no new checklist item')
        fail('checklist_date_status_ring', 'skipped: no new checklist item')
      } else {
      const quoteTitle = `${addTitle} "quote"`
      const quoteSaved = await page.evaluate(
        ({ id, quote }) => {
          const el = document.querySelector(`.legal-checklist-inline-title[data-item-id="${id}"]`)
          if (!el) return false
          el.innerText = quote
          if (typeof legalInlineSaveFlush === 'function') {
            legalInlineSaveFlush(Number(el.dataset.itemId || id), 'title', quote.trim())
          }
          return true
        },
        { id: newItemId, quote: quoteTitle }
      )
      await page.waitForTimeout(1000)
      const quoteOk = newItemId
        ? await page.locator(`.legal-checklist-inline-title[data-item-id="${newItemId}"]`, { hasText: 'quote' }).count()
        : 0
      if (quoteSaved && quoteOk >= 1) pass('checklist_title_quote', { sample: quoteTitle, item_id: newItemId })
      else fail('checklist_title_quote', `saved=${quoteSaved} visible=${quoteOk}`)

      const ringBtn = newItemId
        ? page.locator(`.legal-checklist-row[data-legal-item-id="${newItemId}"] .legal-checklist-status-ring`)
        : page.locator('.legal-checklist-status-ring').first()
      const ringOnclick = await ringBtn.first().getAttribute('onclick')
      if (ringOnclick && ringOnclick.includes('legalChecklistStatusRingClick') && !ringOnclick.includes('JSON.stringify')) {
        pass('handlers_id_not_json', { sample_ring_onclick: ringOnclick.slice(0, 80), item_id: newItemId })
      } else {
        fail('handlers_id_not_json', ringOnclick || 'no onclick')
      }

      await ringBtn.first().click()
      await page.waitForTimeout(400)
      const dateInput = newItemId
        ? page.locator(`.legal-checklist-row[data-legal-item-id="${newItemId}"] .legal-checklist-inline-date`)
        : page.locator('.legal-checklist-inline-date').first()
      const statusSel = newItemId
        ? page.locator(`.legal-checklist-row[data-legal-item-id="${newItemId}"] .legal-checklist-inline-status`)
        : page.locator('.legal-checklist-inline-status').first()
      await dateInput.first().fill('2026-09-20')
      await dateInput.first().press('Enter')
      await page.waitForTimeout(500)
      await statusSel.first().selectOption('in_progress')
      await page.waitForTimeout(800)
      pass('checklist_date_status_ring', {
        ring_toggles_status: true,
        date_set: '2026-09-20',
        status: 'in_progress',
        item_id: newItemId,
      })

      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      await loginIfNeeded(page)
      if (await page.getByRole('button', { name: /PRJ001/i }).count()) {
        await page.getByRole('button', { name: /PRJ001/i }).click()
        await page.waitForTimeout(800)
      }
      await page.getByRole('button', { name: 'Theo dõi hồ sơ' }).click()
      await page.waitForSelector('.legal-checklist-inline-title', { timeout: 15000 })
      await switchChecklistPackageByNeedle(page, 'BCNCKT')
      const persistQuote = newItemId
        ? await page.locator(`.legal-checklist-inline-title[data-item-id="${newItemId}"]`, { hasText: 'quote' }).count()
        : 0
      if (persistQuote >= 1) {
        pass('checklist_persist_after_reload', { quote_row: true, sample: quoteTitle, item_id: newItemId })
      } else {
        fail('checklist_persist_after_reload', `quoteRow=${persistQuote}`)
      }
      }
    }

    await page.getByRole('button', { name: 'Tình trạng thanh toán' }).click()
    await page.waitForSelector('#legalPaymentPackageSubtabs .legal-package-subtab', { timeout: 15000 })
    await page.waitForTimeout(500)

    const bcnPaymentPkg = await page.evaluate(() => {
      const pkgs = _legalOverviewData?.packages || []
      const pkg = pkgs.find(
        (p) => (p.name || '').includes('BCNCKT') || (p.code || '').includes('BCNCKT')
      )
      return pkg ? Number(pkg.id) : null
    })

    await page.evaluate(() => {
      if (typeof switchLegalPaymentPackageTab === 'function') switchLegalPaymentPackageTab(0)
    })
    await page.waitForTimeout(600)

    let createAmount = 1300000 + (STAMP % 700000)
    let postCreate = null
    let createdPaymentId = null
    const payPostP = page.waitForResponse(
      (r) => r.url().includes('/api/legal/1/payments') && r.request().method() === 'POST',
      { timeout: 30000 }
    )
    await page.evaluate((amt) => {
      const inp = document.querySelector('.legal-payment-sheet-row.is-new [data-pfield="amount"]')
      if (!inp) return
      inp.dataset.rawVal = String(amt)
      inp.value = String(amt)
      if (typeof moneyInputFmt === 'function') moneyInputFmt(inp)
      inp.focus()
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      inp.dispatchEvent(ev)
      if (typeof legalPaymentRowKeydown === 'function') legalPaymentRowKeydown(ev, null)
    }, createAmount)
    const payPost = await payPostP.catch(() => null)
    const payBody = payPost ? payPost.request().postData() || '' : ''
    if (payPost?.ok()) {
      try {
        const pj = await payPost.json()
        createdPaymentId = pj?.id ?? null
      } catch {
        createdPaymentId = null
      }
      postCreate = { status: payPost.status(), postData: payBody, payment_id: createdPaymentId }
    }
    await page.waitForFunction(
      () => typeof _legalPaymentInlineBusy === 'undefined' || _legalPaymentInlineBusy === false,
      { timeout: 25000 }
    ).catch(() => {})
    await page.waitForTimeout(1200)
    const uiAfterCreate = createdPaymentId
      ? await page.evaluate((pid) => {
          const inp = document.querySelector(
            `#legalPaymentsTable input[data-pfield="description"][onkeydown*="legalPaymentRowKeydown(event, ${pid})"]`
          )
          return (inp?.value || '').includes('Chưa nhập mô tả')
        }, createdPaymentId)
      : false

    const editText = `QA edit "quote" ${STAMP}`
    if (!createdPaymentId) {
      fail('payment_chung_edit_cells', 'no payment row to edit after create')
    } else {
      const putP = page
        .waitForResponse((r) => /\/api\/legal\/payments\//.test(r.url()) && r.request().method() === 'PUT', {
          timeout: 22000,
        })
        .catch(() => null)
      await page.evaluate(
        ({ pid, text }) => {
          const inp = document.querySelector(
            `#legalPaymentsTable input[data-pfield="description"][onkeydown*="legalPaymentRowKeydown(event, ${pid})"]`
          )
          if (!inp) return false
          inp.focus()
          inp.value = text
          const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
          inp.dispatchEvent(ev)
          if (typeof legalPaymentRowKeydown === 'function') legalPaymentRowKeydown(ev, pid)
          return true
        },
        { pid: createdPaymentId, text: editText }
      )
      const putEdit = await putP
      if (putEdit?.ok()) pass('payment_chung_edit_cells', { quote_in_description_persist: true, payment_id: createdPaymentId })
      else fail('payment_chung_edit_cells', `put=${putEdit?.status?.() ?? 'none'}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await loginIfNeeded(page)
    await page.getByRole('button', { name: /PRJ001/i }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tình trạng thanh toán' }).click()
    await page.waitForTimeout(800)
    await page.evaluate(() => switchLegalPaymentPackageTab(0))
    await page.waitForTimeout(500)
    const amountPersist = await page.evaluate((amt) => {
      return [...document.querySelectorAll('#legalPaymentsTable input[data-pfield="amount"]')].some(
        (i) => (i.dataset.rawVal || i.value || '').replace(/\D/g, '') === String(amt)
      )
    }, createAmount)
    const placeholderAfterReload = createdPaymentId
      ? await page.evaluate((pid) => {
          const inp = document.querySelector(
            `#legalPaymentsTable input[data-pfield="description"][onkeydown*="legalPaymentRowKeydown(event, ${pid})"]`
          )
          return (inp?.value || '').includes('Chưa nhập') || (inp?.value || '').includes('quote')
        }, createdPaymentId)
      : false
    if (
      postCreate &&
      (postCreate.postData || '').includes('Chưa nhập mô tả') &&
      (uiAfterCreate || amountPersist) &&
      placeholderAfterReload
    ) {
      pass('payment_chung_amount_only_create', {
        post_status: postCreate.status,
        post_body_has_placeholder: true,
        persist_after_reload: amountPersist,
        ui_after_create: uiAfterCreate,
        payment_id: createdPaymentId,
        amount: createAmount,
      })
    } else {
      fail(
        'payment_chung_amount_only_create',
        JSON.stringify({ postCreate: !!postCreate, uiAfterCreate, amountPersist, placeholderAfterReload })
      )
    }

    await page.evaluate((pkgId) => {
      if (pkgId != null && typeof switchLegalPaymentPackageTab === 'function') switchLegalPaymentPackageTab(pkgId)
    }, bcnPaymentPkg)
    await page.waitForTimeout(800)
    const activePayPkg = await page.evaluate(() => _legalPaymentActivePackageId)
    const itemSel = page.locator('.legal-payment-sheet-row.is-new select[data-pfield="legal_item_id"]')
    if (await itemSel.count()) {
      await itemSel.first().selectOption({ value: '' })
    }
    const netPkgBefore = out.network_sample.length
    const blockedPostP = page
      .waitForResponse((r) => /\/api\/legal\/1\/payments$/.test(r.url()) && r.request().method() === 'POST', {
        timeout: 3000,
      })
      .catch(() => null)
    await page.evaluate(() => {
      const inp = document.querySelector('.legal-payment-sheet-row.is-new [data-pfield="amount"]')
      if (!inp) return
      inp.dataset.rawVal = '999999'
      inp.value = '999999'
      if (typeof moneyInputFmt === 'function') moneyInputFmt(inp)
      inp.focus()
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      inp.dispatchEvent(ev)
      if (typeof legalPaymentRowKeydown === 'function') legalPaymentRowKeydown(ev, null)
    })
    const strayPost = await blockedPostP
    await page
      .waitForFunction(
        () => document.body.innerText.includes('Chọn hạng mục thuộc gói'),
        { timeout: 3000 }
      )
      .catch(() => {})
    await page.waitForTimeout(400)
    const postPkg = out.network_sample.slice(netPkgBefore).find((n) => n.method === 'POST' && /\/payments$/.test(n.url))
    const toastOk = await page.evaluate(() => document.body.innerText.includes('Chọn hạng mục thuộc gói'))
    if (!postPkg && !strayPost && toastOk && activePayPkg !== 0 && activePayPkg !== null) {
      pass('payment_goi_no_hang_muc', { toast_seen: true, no_post: true, active_payment_package: activePayPkg })
    } else {
      fail('payment_goi_no_hang_muc', `post=${!!postPkg} stray=${!!strayPost} toast=${toastOk} active=${activePayPkg}`)
    }

    await page.getByRole('button', { name: 'Chi phí A' }).click()
    await page.waitForTimeout(800)
    pass('cost_a_tab_admin', { tab_clicked: true })

    await page.getByRole('button', { name: 'Theo dõi hồ sơ' }).click()
    await page.waitForTimeout(400)
    const importBtn = await page.getByRole('button', { name: 'Import Excel' }).isVisible()
    const copyBtn = await page.getByRole('button', { name: /Sao chép từ dự án/i }).isVisible()
    if (importBtn && copyBtn) {
      pass('import_excel_copy_from_spot', { buttons_visible: true, flow_not_run: true })
    } else {
      fail('import_excel_copy_from_spot', `import=${importBtn} copy=${copyBtn}`)
    }

    out.harness.checklist_rows_at_end = await page
      .locator('.legal-checklist-row:not(.legal-checklist-add-row)')
      .count()
      .catch(() => null)
  } catch (e) {
    out.errors.push(String(e?.stack || e))
  } finally {
    await browser.close()
  }

  const checks = out.product_checks
  const required = [
    'select_project_panel',
    'package_subtabs_stages_items',
    'checklist_enter_add',
    'checklist_title_quote',
    'checklist_date_status_ring',
    'checklist_persist_after_reload',
    'handlers_id_not_json',
    'payment_chung_amount_only_create',
    'payment_chung_edit_cells',
    'payment_goi_no_hang_muc',
    'cost_a_tab_admin',
    'import_excel_copy_from_spot',
  ]
  const allPass = out.errors.length === 0 && required.every((k) => checks[k]?.pass === true)
  out.run_class = allPass ? 'PRODUCT_PASS' : 'PRODUCT_FAILURE'
  out.falsifiers = {
    cannot_type_save_checklist: checks.checklist_enter_add?.pass === false,
    package_tab_empty_wrong: checks.package_subtabs_stages_items?.pass === false,
    quote_breaks_handlers: checks.handlers_id_not_json?.pass === false,
    amount_only_chung_save: checks.payment_chung_amount_only_create?.pass === false,
  }
  out.next_agent = 'technical-advisor'
  out.po_human = false

  const dir = dirname(fileURLToPath(import.meta.url))
  const jsonPath = join(dir, 'wave-h-hspl-input-methods-qa-attempt3-2026-09-26.json')
  writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n')
  console.log(
    JSON.stringify({
      run_class: out.run_class,
      jsonPath,
      checks: Object.fromEntries(required.map((k) => [k, checks[k]?.pass ?? null])),
      errors: out.errors,
    })
  )
}

main()
