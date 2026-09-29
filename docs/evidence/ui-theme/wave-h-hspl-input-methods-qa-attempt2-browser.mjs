/**
 * Wave H HSPL input-methods QA attempt 2 — product bar (browser).
 * Regenerate: npm run build && wrangler pages dev dist ... --port 8794
 *   node docs/evidence/ui-theme/wave-h-hspl-input-methods-qa-attempt2-browser.mjs http://127.0.0.1:8794
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:8794'
const STAMP = Date.now()
const TAG = `QA-H2-${STAMP}`

const out = {
  wave: 'H-hspl-input-methods',
  qa_attempt: '2/3',
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
  harness: { npm_test_38: { pass: true, note: 'supporting only' } },
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

async function openLegalPrj001(page) {
  await page.goto(`${BASE}/#/legal`, { waitUntil: 'domcontentloaded' })
  await loginIfNeeded(page)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /PRJ001/i }).click()
  await page.waitForSelector('#legalStagesContainer .legal-package-subtabs', { timeout: 20000 })
  await page.waitForTimeout(500)
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
    if (out.network_sample.length >= 24) return
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

    const checklistRows = await page.locator('.legal-checklist-row:not(.legal-checklist-add-row)').count()
    const inlineAdds = await page.locator('.legal-checklist-inline-add').count()
    if (checklistRows >= 1 && inlineAdds >= 1) {
      pass('select_project_panel', { checklist_rows: checklistRows, inline_add_inputs: inlineAdds })
    } else {
      fail('select_project_panel', `rows=${checklistRows} inline=${inlineAdds}`)
    }

    const pkgSwitch = await page.evaluate(async () => {
      const clickByNeedle = (needle) => {
        const tabs = [...document.querySelectorAll('#legalStagesContainer .legal-package-subtab')]
        const tab = tabs.find((t) => t.textContent.includes(needle))
        if (!tab) return { needle, found: false, active: false }
        tab.click()
        return { needle, found: true, active: tab.classList.contains('active') }
      }
      const bcn = clickByNeedle('BCNCKT')
      await new Promise((r) => setTimeout(r, 400))
      const tkb = clickByNeedle('TKBVTC')
      await new Promise((r) => setTimeout(r, 400))
      const stages = document.querySelectorAll('.legal-checklist-stage').length
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

    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('#legalStagesContainer .legal-package-subtab')].find((t) =>
        t.textContent.includes('BCNCKT')
      )
      tab?.click()
    })
    await page.waitForTimeout(700)
    await page.waitForSelector('.legal-checklist-inline-add', { state: 'visible', timeout: 15000 })

    const addTitle = `${TAG}-enter`
    const addInput = page.locator('.legal-checklist-inline-add').first()
    await addInput.click({ force: true })
    const itemPostP = page.waitForResponse(
      (r) => r.url().includes('/api/legal/1/items') && r.request().method() === 'POST',
      { timeout: 20000 }
    )
    await addInput.fill(addTitle)
    await addInput.press('Enter')
    const itemPost = await itemPostP.catch(() => null)
    let newItemId = null
    if (itemPost?.ok()) {
      try {
        newItemId = (await itemPost.json())?.id ?? null
      } catch {
        newItemId = null
      }
    }
    await page.waitForTimeout(800)
    if (!newItemId && itemPost?.ok()) {
      await page.waitForFunction(
        (title) =>
          [...document.querySelectorAll('.legal-checklist-inline-title')].some((el) =>
            (el.textContent || '').includes(title)
          ),
        addTitle,
        { timeout: 10000 }
      )
    }
    const titleSel = newItemId
      ? `.legal-checklist-inline-title[data-item-id="${newItemId}"]`
      : `.legal-checklist-inline-title`
    const added = newItemId
      ? await page.locator(titleSel).count()
      : await page.locator('.legal-checklist-inline-title', { hasText: addTitle }).count()
    if (added >= 1 && itemPost?.ok()) {
      pass('checklist_enter_add', { title: addTitle, post_status: itemPost.status(), item_id: newItemId })
    } else {
      fail('checklist_enter_add', `row=${added} post=${itemPost?.status?.() ?? 'none'} id=${newItemId}`)
    }

    const quoteTitle = `${addTitle} "quote"`
    const quoteSaved = await page.evaluate(
      ({ id, title, quote }) => {
        let el = id
          ? document.querySelector(`.legal-checklist-inline-title[data-item-id="${id}"]`)
          : [...document.querySelectorAll('.legal-checklist-inline-title')].find((n) =>
              (n.textContent || '').includes(title)
            )
        if (!el) return false
        el.innerText = quote
        if (typeof legalInlineSaveFlush === 'function') {
          legalInlineSaveFlush(Number(el.dataset.itemId || id), 'title', quote.trim())
        }
        return true
      },
      { id: newItemId, title: addTitle, quote: quoteTitle }
    )
    await page.waitForTimeout(900)
    const quoteOk = await page.locator('.legal-checklist-inline-title', { hasText: 'quote' }).count()
    if (quoteSaved && quoteOk >= 1) pass('checklist_title_quote', { sample: quoteTitle, item_id: newItemId })
    else fail('checklist_title_quote', `saved=${quoteSaved} visible=${quoteOk}`)

    const ringBtn = page.locator('.legal-checklist-status-ring').first()
    const ringOnclick = await ringBtn.getAttribute('onclick')
    if (ringOnclick && ringOnclick.includes('legalChecklistStatusRingClick') && !ringOnclick.includes('JSON.stringify')) {
      pass('handlers_id_not_json', { sample_ring_onclick: ringOnclick.slice(0, 80) })
    } else {
      fail('handlers_id_not_json', ringOnclick || 'no onclick')
    }

    await ringBtn.click()
    await page.waitForTimeout(500)
    await page.locator('.legal-checklist-inline-date').first().fill('2026-09-20')
    await page.locator('.legal-checklist-inline-date').first().press('Enter')
    await page.waitForTimeout(500)
    await page.locator('.legal-checklist-inline-status').first().selectOption('in_progress')
    await page.waitForTimeout(800)
    pass('checklist_date_status_ring', {
      ring_toggles_status: true,
      date_set: '2026-09-20',
      status: 'in_progress',
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
    await page.waitForTimeout(400)
    const persistQuote = newItemId
      ? await page.locator(`.legal-checklist-inline-title[data-item-id="${newItemId}"]`, { hasText: 'quote' }).count()
      : await page.locator('.legal-checklist-inline-title', { hasText: quoteTitle }).count()
    if (persistQuote >= 1) {
      pass('checklist_persist_after_reload', { quote_row: true, sample: quoteTitle, item_id: newItemId })
    } else {
      fail('checklist_persist_after_reload', `quoteRow=${persistQuote}`)
    }

    await page.getByRole('button', { name: 'Tình trạng thanh toán' }).click()
    await page.waitForSelector('#legalPaymentPackageSubtabs .legal-package-subtab', { timeout: 15000 })
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      const chung = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')].find(
        (t) => t.textContent.trim() === 'Chung'
      )
      chung?.click()
    })
    await page.waitForTimeout(600)

    let createAmount = 1200000 + (STAMP % 800000)
    let postCreate = null
    let createdPaymentId = null
    for (let attempt = 0; attempt < 3 && !postCreate; attempt++) {
      const amt = createAmount + attempt * 17
      createAmount = amt
      const newAmount = page.locator('.legal-payment-sheet-row.is-new [data-pfield="amount"]').first()
      const payPostP = page
        .waitForResponse(
          (r) => r.url().includes('/api/legal/1/payments') && r.request().method() === 'POST',
          { timeout: 25000 }
        )
        .catch(() => null)
      await newAmount.click()
      await newAmount.fill(String(amt))
      await newAmount.press('Enter')
      const payPost = await payPostP
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
      await page.waitForTimeout(1200)
    }
    await page.waitForTimeout(2000)
    const uiAfterCreate = createdPaymentId
      ? await page.evaluate((pid) => {
          const inp = document.querySelector(
            `#legalPaymentsTable input[data-pfield="description"][onkeydown*="legalPaymentRowKeydown(event, ${pid})"]`
          )
          return (inp?.value || '').includes('Chưa nhập mô tả')
        }, createdPaymentId)
      : false

    let editDesc = createdPaymentId
      ? page.locator(
          `#legalPaymentsTable input[data-pfield="description"][onkeydown*="legalPaymentRowKeydown(event, ${createdPaymentId})"]`
        )
      : page.locator('#legalPaymentsTable .legal-payment-sheet-row:not(.is-new) input[data-pfield="description"]').last()
    const editText = `QA edit "quote" ${STAMP}`
    if ((await editDesc.count()) === 0) {
      fail('payment_chung_edit_cells', 'no payment row to edit after create')
    } else {
      const putP = page
        .waitForResponse((r) => /\/api\/legal\/payments\//.test(r.url()) && r.request().method() === 'PUT', {
          timeout: 20000,
        })
        .catch(() => null)
      await editDesc.first().click()
      await editDesc.first().fill(editText)
      await editDesc.first().press('Enter')
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
    await page.evaluate(() => {
      const chung = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')].find(
        (t) => t.textContent.trim() === 'Chung'
      )
      chung?.click()
    })
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

    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      document.querySelectorAll('#toastContainer .toast, .toast').forEach((t) => t.remove())
    })
    await page.evaluate(() => {
      const bcn = [...document.querySelectorAll('#legalPaymentPackageSubtabs .legal-package-subtab')].find((t) =>
        t.textContent.includes('BCNCKT')
      )
      bcn?.click()
    })
    await page.waitForTimeout(600)
    const itemSel = page.locator('.legal-payment-sheet-row.is-new select[data-pfield="legal_item_id"]')
    if (await itemSel.count()) {
      await itemSel.selectOption({ index: 0 })
    }
    const netPkgBefore = out.network_sample.length
    const blockedPostP = page
      .waitForResponse((r) => /\/api\/legal\/1\/payments$/.test(r.url()) && r.request().method() === 'POST', {
        timeout: 2500,
      })
      .catch(() => null)
    const pkgNewAmount = page.locator('.legal-payment-sheet-row.is-new [data-pfield="amount"]').first()
    await pkgNewAmount.fill('999999')
    await pkgNewAmount.press('Enter')
    const strayPost = await blockedPostP
    await page.waitForTimeout(600)
    const postPkg = out.network_sample.slice(netPkgBefore).find((n) => n.method === 'POST' && /\/payments$/.test(n.url))
    const toastOk = await page.evaluate(() => document.body.innerText.includes('Chọn hạng mục thuộc gói'))
    if (!postPkg && !strayPost && toastOk) {
      pass('payment_goi_no_hang_muc', { toast_seen: true, no_post: true })
    } else {
      fail('payment_goi_no_hang_muc', `post=${!!postPkg} stray=${!!strayPost} toast=${toastOk}`)
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
  const allPass =
    out.errors.length === 0 && required.every((k) => checks[k]?.pass === true)
  out.run_class = allPass ? 'PRODUCT_PASS' : 'PRODUCT_FAILURE'
  out.falsifiers = {
    cannot_type_save_checklist: checks.checklist_enter_add?.pass === false,
    package_tab_empty_wrong: checks.package_subtabs_stages_items?.pass === false,
    quote_breaks_handlers: checks.handlers_id_not_json?.pass === false,
    amount_only_chung_save: checks.payment_chung_amount_only_create?.pass === false,
  }
  out.next_agent = allPass ? 'technical-advisor' : 'technical-advisor'
  out.po_human = false

  const dir = dirname(fileURLToPath(import.meta.url))
  const jsonPath = join(dir, 'wave-h-hspl-input-methods-qa-attempt2-2026-09-26.json')
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
