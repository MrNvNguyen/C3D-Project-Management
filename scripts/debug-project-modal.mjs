import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('console', m => {
  const t = String(m.text())
  if (t.includes('DEBUG') || t.includes('agent') || m.type() === 'error') {
    console.log('CONSOLE', m.type(), t)
  }
})

await page.goto('http://127.0.0.1:8788/', { waitUntil: 'networkidle' })
await page.fill('#loginUsername', 'admin')
await page.fill('#loginPassword', 'Admin@123456')
await page.click('#loginPage button[type=submit], #loginForm button[type=submit], button[type=submit]')
await page.waitForTimeout(2000)

await page.evaluate(() => {
  if (typeof navigateTo === 'function') navigateTo('projects')
  else if (typeof showPage === 'function') showPage('projects')
})
await page.waitForTimeout(1000)

await page.evaluate(() => {
  if (typeof openProjectModal === 'function') openProjectModal()
})
await page.waitForTimeout(500)

const before = await page.evaluate(() => {
  const el = document.getElementById('projectModal')
  return { display: el?.style.display, computed: el ? getComputedStyle(el).display : null }
})
console.log('modal_before', JSON.stringify(before))

const code = 'UI' + Date.now().toString().slice(-6)
await page.fill('#projectCode', code)
await page.fill('#projectName', 'UI Modal Debug')
await page.fill('#projectClient', 'Client')
const contract = page.locator('#projectContractValue')
if (await contract.count()) await contract.fill('1.000.000')
const fee = page.locator('#projectMgmtFeePct')
if (await fee.count()) await fee.fill('30')

await page.click('#projectForm button[type=submit]')
await page.waitForTimeout(3000)

const after = await page.evaluate(() => {
  const el = document.getElementById('projectModal')
  return {
    display: el?.style.display,
    computed: el ? getComputedStyle(el).display : null,
    toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent.trim()).slice(-3),
  }
})
console.log('modal_after', JSON.stringify(after))
await browser.close()
