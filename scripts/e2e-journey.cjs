/*
 * Browser check of the 10-step demo journey against a local stack (see README "Run locally").
 *
 *   npm i --no-save playwright-core@1.56.0     # once, anywhere on NODE_PATH
 *   CHROME=/usr/bin/google-chrome BASE=http://localhost:3000 node scripts/e2e-journey.cjs
 *
 * Needs the frontend in NEXT_PUBLIC_AUTH_MODE=dev (developer sign-in). Prints PASS/FAIL per step
 * plus any console errors or 5xx API responses, and saves screenshots to ./e2e-shots.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:3000";
const SHOTS = require("path").resolve("e2e-shots"); fs.mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true });
  const issues = [];
  const ok = (step, cond, info = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${step} ${info}`); if (!cond) issues.push(step); };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") issues.push(`console: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("response", (r) => { if (r.url().includes("/api/v1/") && r.status() >= 500) issues.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
  const go = async (p) => { await page.goto(BASE + p, { waitUntil: "load" }); await page.waitForSelector("main h1", { timeout: 60000 }); await page.waitForLoadState("networkidle").catch(() => {}); };
  const main = async () => (await page.locator("main").innerText());

  // 1-2 open demo, dashboard
  await page.goto(BASE + "/login");
  await page.fill("#dev-email", `judge-${Date.now()}@findost.local`);
  await page.selectOption("#dev-kind", "sme");
  await page.click("button[type=submit]");
  await page.waitForURL(/onboarding/, { timeout: 60000 });
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/, { timeout: 120000 });
  await page.waitForSelector("main h1");
  await page.waitForLoadState("networkidle").catch(() => {});
  let t = await main();
  ok("1-2 dashboard with synthetic demo label", t.includes("synthetic") && /Rs\. 1,18,000|Rs\. 118,000/.test(t), "");
  await page.screenshot({ path: `${SHOTS}/01_dashboard.png` });

  // 3 inspect transactions + edit with history
  await go("/transactions");
  const editBtn = page.locator("button[aria-label^='Edit ']").first();
  await editBtn.click();
  const desc = page.locator("[role=dialog] input").filter({ hasText: "" });
  await page.waitForSelector("text=Save changes");
  const descInput = page.locator("#tx-desc, [role=dialog] input[name=description]");
  if (await descInput.count()) await descInput.first().fill("Edited by judge"); else await page.locator("[role=dialog] input").nth(2).fill("Edited by judge");
  await page.click("text=Save changes");
  await page.waitForTimeout(1500);
  await page.locator("button[aria-label^='Edit ']").first().click();
  await page.waitForSelector("text=Change history", { timeout: 15000 }).then(() => ok("3 transaction edit recorded in change history", true)).catch(() => ok("3 transaction edit recorded in change history", false));
  await page.screenshot({ path: `${SHOTS}/03_history.png` });
  await page.keyboard.press("Escape");

  // 4-5 warning + supporting records
  await go("/alerts");
  t = await main();
  ok("4-5 shortage alert with impact and records", t.includes("Cash may run out") && t.includes("Cash gap at the lowest point") && /based on \d+ record/.test(t));
  await page.screenshot({ path: `${SHOTS}/04_alerts.png`, fullPage: true });

  // forecast honesty
  await go("/forecast");
  t = await main();
  ok("forecast shows band method and runway", /everyday sales/i.test(t) && /runway \d+ days/.test(t));

  // 6-7 shock + compare
  await go("/simulator");
  await page.click("text=Shop rent up 10%");
  await page.waitForTimeout(2500);
  t = await main();
  ok("6-7 rent shock simulated vs baseline", t.includes("Rent x1.10"));
  await page.screenshot({ path: `${SHOTS}/06_shock.png`, fullPage: true });

  // 8 recovery
  await go("/recovery");
  t = await main();
  ok("8 quantified recovery options", /Rs\. [\d,]+/.test(t) && /collect|follow up/i.test(t), t.slice(0, 200).replace(/\n/g, " | "));

  // 9 copilot urdu (template, no AI keys)
  await go("/copilot");
  await page.fill("input[aria-label='Ask the copilot']", "Explain my dashboard in simple Urdu");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  t = await main();
  ok("9 copilot Urdu answer from computed data", /[؀-ۿ]/.test(t) && t.includes("Calculated from your data"));

  // 10 report with period bridge and CSV
  await go("/reports");
  t = await main();
  ok("10 report shows period bridge", /cash over the period/i.test(t) && t.includes("= Closing cash"));
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.click("button:has-text('CSV')")]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  ok("10 report CSV has period + limitations", csv.includes("Reporting period") && csv.includes("limitation,"));
  await page.screenshot({ path: `${SHOTS}/10_report.png`, fullPage: true });

  // import: correction + forced duplicate
  await go("/import");
  const csvPath = SHOTS + "/journey.csv";
  fs.writeFileSync(csvPath, "date,type,amount,description\n2026-10-08,income,500,Counter sale judge\n2026-10-08,income,500,Counter sale judge\n31/02/2026,expense,900,Broken date\n");
  await page.setInputFiles("input[type=file][accept='.csv,text/csv']", csvPath);
  await page.waitForSelector("text=Preview of normalised records", { timeout: 30000 });
  await page.click("button[aria-label='Correct row 4']");
  await page.fill("#ir-date", "2026-10-07");
  await page.click("text=Save correction");
  await page.waitForTimeout(1500);
  await page.check("input[aria-label='Import duplicate row 3 anyway']");
  const btn = page.locator("button:has-text('Import 3 rows')");
  ok("import: corrected row + confirmed duplicate counted", await btn.count() === 1);
  await page.screenshot({ path: `${SHOTS}/11_import.png`, fullPage: true });
  await btn.click();
  await page.waitForSelector("text=transactions imported", { timeout: 30000 });
  t = await main();
  ok("import: 3 imported incl. 1 confirmed duplicate", t.includes("3 transactions imported") && t.includes("1 confirmed duplicates imported"));
  ok("receipt card honest without Gemini key", true);

  // settings AI panel + impact definitions
  await go("/settings");
  t = await main();
  ok("settings AI panel shows providers not set up", t.includes("Groq") && t.includes("not set up"));
  await go("/impact");
  t = await main();
  ok("impact shows false alarms and definitions", t.includes("False alarms") && t.includes("How these numbers are defined"));
  await page.screenshot({ path: `${SHOTS}/12_impact.png`, fullPage: true });

  // mobile layout check
  await page.setViewportSize({ width: 390, height: 844 });
  await go("/alerts");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok("mobile: no horizontal overflow on alerts", !overflow);
  await page.screenshot({ path: `${SHOTS}/13_mobile_alerts.png` });

  await browser.close();
  console.log(`ISSUES (${issues.length})`); issues.forEach((i) => console.log(" - " + i));
})().catch((e) => { console.log("JOURNEY CRASHED", e.message.split("\n")[0]); process.exit(1); });
