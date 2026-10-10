/*
 * Browser check of the enterprise workflow, floating Copilot, roles and per-account-type navigation.
 * Local stack with NEXT_PUBLIC_AUTH_MODE=dev (see scripts/e2e-journey.cjs for setup).
 *   CHROME=/usr/bin/google-chrome BASE=http://localhost:3000 node scripts/e2e-enterprise.cjs
 */
const { chromium } = require("playwright-core");
const BASE = process.env.BASE || "http://localhost:3000";
const stamp = Date.now();
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true });
  const issues = [];
  const ok = (step, cond, info = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${step} ${info}`); if (!cond) issues.push(step); };
  const newPage = async (tag, viewport = { width: 1440, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" && !/403|404|409/.test(m.text())) issues.push(`[${tag}] console: ${m.text().slice(0, 160)}`); });
    page.on("pageerror", (e) => issues.push(`[${tag}] pageerror: ${e.message.slice(0, 160)}`));
    page.on("response", (r) => { if (r.url().includes("/api/v1/") && r.status() >= 500) issues.push(`[${tag}] ${r.status()} ${r.url().replace(BASE, "")}`); });
    return page;
  };
  const login = async (page, email, kind, onboard = true) => {
    await page.goto(BASE + "/login");
    await page.fill("#dev-email", email);
    await page.selectOption("#dev-kind", kind);
    await page.click("button[type=submit]");
    // a new user lands on /dashboard and is then sent to onboarding by the app
    await page.waitForURL(/onboarding/, { timeout: 60000 });
    if (onboard) {
      await page.waitForSelector("text=Start with demo data", { timeout: 60000 });
      await page.click("button[type=submit]");
      await page.waitForURL(/dashboard/, { timeout: 120000 });
    }
  };
  const go = async (page, p) => { await page.goto(BASE + p, { waitUntil: "load" }); await page.waitForSelector("main h1", { timeout: 60000 }); await page.waitForLoadState("networkidle").catch(() => {}); };
  const main = async (page) => page.locator("main").innerText();

  // ---------------- owner (enterprise)
  const owner = await newPage("owner");
  await login(owner, `cfo-${stamp}@indus.pk`, "enterprise");
  await owner.waitForSelector("main h1");
  await owner.waitForLoadState("networkidle").catch(() => {});
  const nav = await owner.locator("nav[aria-label=Main]").first().innerText();
  ok("enterprise nav: workflow sections", ["Tasks & Approvals", "Team & Access", "Data Checks", "Budget vs Actual", "Imports"].every((x) => nav.includes(x)) && !nav.includes("SDG"));
  ok("enterprise dashboard: workflow tiles", /Approvals[\s\S]*Data checks/i.test(await main(owner)));

  // floating copilot
  await owner.click("button[aria-label='Open Copilot']");
  await owner.waitForSelector("[role=dialog][aria-label='Financial Copilot']");
  await owner.fill("[role=dialog] input[aria-label='Ask the copilot']", "hi");
  await owner.keyboard.press("Enter");
  await owner.waitForFunction(() => /Hello!/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
  ok("floating copilot answers a greeting", /Hello!/.test(await owner.locator("[role=dialog]").innerText()));
  await owner.fill("[role=dialog] input[aria-label='Ask the copilot']", "Which payments are overdue?");
  await owner.keyboard.press("Enter");
  await owner.waitForFunction(() => /overdue \(oldest/.test(document.querySelector("[role=dialog]")?.textContent || ""), null, { timeout: 60000 }).catch(() => {});
  ok("floating copilot answers from records", /overdue \(oldest/.test(await owner.locator("[role=dialog]").innerText()));
  await owner.keyboard.press("Escape");
  ok("copilot closes with Escape and keeps the launcher", !(await owner.locator("[role=dialog]").isVisible()) && await owner.locator("button[aria-label='Open Copilot']").isVisible());

  // budget
  await go(owner, "/budget");
  await owner.fill("#b-cat", "Rent");
  await owner.fill("#b-amt", "50000");
  await owner.click("text=Save budget");
  await owner.waitForSelector("text=of Rs. 50,000", { timeout: 20000 }).catch(() => {});
  ok("budget saved and compared with actual", /Rent[\s\S]*of Rs\. 50,000/.test(await main(owner)));

  // data checks
  await go(owner, "/controls");
  ok("data checks page lists checks", /Cash totals are internally consistent/.test(await main(owner)));

  // recovery -> action -> approval
  await go(owner, "/recovery");
  // the top-ranked option opens with its details expanded
  await owner.waitForSelector("text=Propose as action", { timeout: 60000 });
  await owner.locator("button:has-text('Propose as action')").first().click();
  await owner.waitForSelector("text=Added as a proposed action", { timeout: 20000 }).catch(() => {});
  ok("recovery option proposed as action", await owner.locator("text=Added as a proposed action").count() > 0);
  await go(owner, "/actions");
  await owner.click("button:has-text('Submit for approval')");
  await owner.click("button:has-text('Waiting for approval')");
  await owner.click("button:has-text('Approve')");
  await owner.waitForTimeout(1200);
  await owner.click("button:has-text('Open')");
  await owner.locator("input[aria-label^='Note for']").first().fill("Called the top customers");
  await owner.click("button:has-text('Mark completed')");
  await owner.waitForTimeout(1200);
  await owner.click("button:has-text('Closed')");
  ok("action approved and completed", /completed[\s\S]*Outcome: Called the top customers/.test(await main(owner)));

  // team invite
  await go(owner, "/team");
  await owner.fill("#inv-email", `ed-${stamp}@indus.pk`);
  await owner.selectOption("#inv-role", "editor");
  await owner.click("button:has-text('Send invitation')");
  await owner.waitForSelector("code", { timeout: 20000 });
  const link = await owner.locator("code").innerText();
  ok("invitation honest about email delivery", /no email was sent/i.test(await main(owner)) && link.includes("/invite?token="));

  // ---------------- editor accepts
  const editor = await newPage("editor");
  await login(editor, `ed-${stamp}@indus.pk`, "enterprise", false);
  await editor.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await editor.waitForSelector("text=Accept and open the workspace", { timeout: 30000 });
  await editor.click("text=Accept and open the workspace");
  await editor.waitForURL(/dashboard/, { timeout: 60000 });
  await editor.waitForSelector("main h1");
  ok("editor joined the company workspace", /your role: editor/.test(await editor.locator("header").innerText()));
  await go(editor, "/team");
  ok("editor cannot manage the team", !(await editor.locator("#inv-email").count()));
  await go(editor, "/settings");
  ok("editor sees owner-only settings as read-only", /managed by the workspace owner/.test(await main(editor)));

  // ---------------- student
  const student = await newPage("student", { width: 390, height: 844 });
  await login(student, `stud-${stamp}@uni.pk`, "student");
  await student.waitForSelector("main h1");
  await student.click("button[aria-label='Open menu']");
  const snav = await student.locator("[role=dialog] nav").innerText();
  ok("student nav is personal finance", ["My Money", "Monthly Budget", "Savings Goals", "What-if Planner", "Spending Adjustment Plan"].every((x) => snav.includes(x))
    && !/Inventory|Khata|Shock|Supplier|Team/.test(snav));
  await go(student, "/inventory");
  ok("student blocked from inventory by URL", /Not part of your account type/.test(await main(student)));
  await go(student, "/simulator");
  ok("student scenarios are personal", /allowance arrives 10 days late/i.test(await main(student)) && !/Shop rent|Supplier prices/.test(await main(student)));
  const overflow = await student.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok("mobile: no horizontal overflow", !overflow);
  ok("mobile: copilot launcher visible", await student.locator("button[aria-label='Open Copilot']").isVisible());

  // ---------------- one login, two workspaces: the student is invited to the company as a viewer
  const studEmail = `stud-${stamp}@uni.pk`;
  await go(owner, "/team");
  await owner.fill("#inv-email", studEmail);
  await owner.selectOption("#inv-role", "viewer");
  await owner.click("button:has-text('Send invitation')");
  await owner.waitForFunction((e) => [...document.querySelectorAll("code")].some((c) => c.textContent.includes("/invite?token=")) && document.body.innerText.includes(e), studEmail, { timeout: 20000 });
  const studLink = (await owner.locator("code").last().innerText()).replace(/^https?:\/\/[^/]+/, BASE);
  await student.goto(studLink);
  await student.waitForSelector("text=Accept and open the workspace", { timeout: 30000 });
  await student.click("text=Accept and open the workspace");
  await student.waitForURL(/dashboard/, { timeout: 60000 });
  await student.waitForSelector("main h1");
  const header = async (pg) => (await pg.locator("button[aria-label^='Workspace:']").getAttribute("aria-label")) || "";
  ok("invited student opens the company as viewer", /My Company/.test(await header(student)) && /viewer/.test(await header(student)));
  await student.click("button[aria-label^='Workspace:']");
  const menu = await student.locator("[role=menu]").innerText();
  ok("switcher lists own account and the company", /My Student Budget/.test(menu) && /My Company/.test(menu) && /your account/.test(menu));
  await student.click("[role=menu] button:has-text('My Student Budget')");
  await student.waitForFunction(() => /My Student Budget/.test(document.querySelector("header")?.textContent || ""), null, { timeout: 60000 });
  await student.waitForSelector("main h1");
  await student.waitForLoadState("networkidle").catch(() => {});
  const ownMain = await main(student);
  ok("switched to own account without signing out; no company data shown", !/My Company|Indus|Northline/.test(ownMain) && /owner/.test(await header(student)), /My Company|Indus|Northline/.exec(ownMain)?.[0] ?? "");
  ok("own account kept its type after joining", /My Student Budget/.test(await header(student)) && (await student.locator("header").first().innerText()).toLowerCase().includes("student"));

  // a new sign-in asks again instead of reopening the last workspace
  await student.goto(BASE + "/workspaces");
  await student.waitForSelector("text=Where would you like to work today?");
  await student.click("button:has-text('Sign out')");
  await student.waitForURL(/login/);
  await student.fill("#dev-email", studEmail);
  await student.selectOption("#dev-kind", "student");
  await student.click("button[type=submit]");
  await student.waitForURL(/workspaces/, { timeout: 60000 });
  await student.waitForSelector("text=Shared with you", { timeout: 30000 });
  const sel = await student.locator("main").innerText();
  ok("selection screen after sign-in lists both, labelled", /Your account[\s\S]*My Student Budget/i.test(sel) && /Shared with you[\s\S]*My Company[\s\S]*Viewer/i.test(sel));
  await student.click("main button:has-text('My Company')");
  await student.waitForURL(/dashboard/, { timeout: 60000 });
  await student.waitForSelector("main h1");
  ok("chosen workspace opens", /My Company/.test(await header(student)));

  // the owner removes the student: the next request sends them back to the selector
  const studId = await student.evaluate(async () => {
    const t = localStorage.getItem("findost_dev_token");
    return (await (await fetch("/api/v1/me", { headers: { Authorization: "Bearer " + t } })).json()).user.id;
  });
  const removed = await owner.evaluate(async (uid) => {
    const t = localStorage.getItem("findost_dev_token");
    const sel = JSON.parse(localStorage.getItem("findost_workspace_selection") || "{}");
    const r = await fetch(`/api/v1/team/members/${uid}`, { method: "DELETE", headers: { Authorization: "Bearer " + t, "X-Workspace-Id": sel.id } });
    return r.status;
  }, studId);
  await student.goto(BASE + "/budget");
  await student.waitForURL(/workspaces\?notice=no_access/, { timeout: 60000 });
  await student.waitForSelector("text=You no longer have access", { timeout: 30000 });
  ok("revoked member is sent back to the selector", removed === 204 && !/My Company/.test(await student.locator("main").innerText()));

  // ---------------- landing
  const visitor = await newPage("visitor");
  await visitor.goto(BASE + "/", { waitUntil: "load" });
  await visitor.waitForTimeout(2500);
  await visitor.locator("#impact").scrollIntoViewIfNeeded();
  await visitor.waitForTimeout(1500);
  const impact = await visitor.locator("#impact").innerText();
  ok("SDG section on landing page with honest framing", /Hypothetical impact pathway/.test(impact) && /target 8\.3/i.test(impact));

  await browser.close();
  console.log(`ISSUES (${issues.length})`); issues.forEach((i) => console.log(" - " + i));
})().catch((e) => { console.log("CRASHED", e.message.split("\n").slice(0, 4).join(" | ")); process.exit(1); });
