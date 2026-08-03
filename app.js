"use strict";

const CONFIG = window.APP_CONFIG || {};
const CACHE_PREFIX = "expenseShareCloudCache:";
const ACTIVE_WORKSPACE_KEY = "expenseShareActiveWorkspace";
const APP_VERSION = "15.0.0";

const state = {
  session: null,
  user: null,
  memberships: [],
  workspace: null,
  role: null,
  partners: [],
  expenses: [],
  participants: [],
  members: [],
  feedback: [],
  feedbackReady: false,
  feedbackError: "",
  realtimeChannel: null,
  authMode: "login",
  reloadTimer: null
};

let deferredInstallPrompt = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function getSupabaseConfiguration() {
  const currentConfig = window.APP_CONFIG || {};

  return {
    url: String(currentConfig.SUPABASE_URL || "").trim(),
    key: String(currentConfig.SUPABASE_PUBLISHABLE_KEY || "").trim()
  };
}

function isConfigured() {
  const { url, key } = getSupabaseConfiguration();

  return (
    url.startsWith("https://") &&
    url.endsWith(".supabase.co") &&
    key.startsWith("sb_publishable_") &&
    !url.includes("YOUR-PROJECT") &&
    !key.includes("REPLACE_ME")
  );
}

let db = null;
let databaseConnectionError = "";

function connectDatabase() {
  const { url, key } = getSupabaseConfiguration();

  if (!isConfigured()) {
    databaseConnectionError =
      "Supabase Project URL or Publishable Key is missing or invalid.";
    return null;
  }

  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    databaseConnectionError =
      "The Supabase JavaScript library could not be loaded.";
    return null;
  }

  try {
    const client = window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    databaseConnectionError = "";
    return client;
  } catch (error) {
    databaseConnectionError =
      error?.message || "The Supabase client could not be created.";
    console.error("Supabase connection error:", error);
    return null;
  }
}

db = connectDatabase();

/*
  Expose the client for troubleshooting in Chrome DevTools.
  You can test it with: window.db !== null
*/
window.db = db;

function getAuthRedirectUrl() {
  const configuredUrl = String(
    window.APP_CONFIG?.PUBLIC_APP_URL || ""
  ).trim();

  if (configuredUrl.startsWith("https://")) {
    return configuredUrl.replace(/\/+$/, "");
  }

  return window.location.origin;
}

function isAppInstalled() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function getPlatformInstallMessage() {
  const userAgent = navigator.userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(userAgent);
  const isWindows = /Windows/i.test(userAgent);
  const isMac = /Macintosh|Mac OS X/i.test(userAgent);

  if (isAppInstalled()) {
    return "ExpenseSplitter is already installed on this device.";
  }
  if (isIOS) {
    return "On iPhone or iPad, open this page in Safari, tap Share, and choose Add to Home Screen.";
  }
  if (isAndroid) {
    return "On Android, use Install now when available, or choose Install app from Chrome’s menu.";
  }
  if (isWindows) {
    return "On Windows, use Install now or select the install icon in Edge or Chrome.";
  }
  if (isMac) {
    return "On Mac, use Chrome’s install icon or choose File → Add to Dock in Safari.";
  }
  return "Install from your browser menu to open ExpenseSplitter in its own app window.";
}

function openInstallModal() {
  const modal = $("#install-modal");
  if (!modal) return;

  $("#install-platform-message").textContent = getPlatformInstallMessage();
  $("#install-now-button").hidden =
    !deferredInstallPrompt || isAppInstalled();

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeInstallModal() {
  const modal = $("#install-modal");
  if (!modal) return;

  modal.hidden = true;
  document.body.style.overflow = "";
}

async function requestAppInstall() {
  if (isAppInstalled()) {
    showToast("ExpenseSplitter is already installed.");
    return;
  }

  if (!deferredInstallPrompt) {
    openInstallModal();
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;

  if (choice.outcome === "accepted") {
    showToast("ExpenseSplitter installation started.");
  } else {
    openInstallModal();
  }
}

async function shareAppLink() {
  const shareData = {
    title: "ExpenseSplitter",
    text: "Install ExpenseSplitter and join our shared business workspace.",
    url: window.location.href.split("#")[0]
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    await navigator.clipboard.writeText(shareData.url);
    showToast("App link copied.");
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast("Could not share the app link.");
    }
  }
}

function todayIso() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function currentMonth() {
  return todayIso().slice(0, 7);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(amount) {
  const currency = state.workspace?.currency || "INR";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatDateTime(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getDeviceSummary() {
  const userAgent = navigator.userAgent || "Unknown browser";
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const screenSize = `${window.screen?.width || 0}x${window.screen?.height || 0}`;
  const installed = isAppInstalled() ? "installed" : "browser";
  const online = navigator.onLine ? "online" : "offline";

  return `${userAgent} | viewport ${viewport} | screen ${screenSize} | ${installed} | ${online}`
    .slice(0, 1000);
}

function feedbackTypeLabel(type) {
  const labels = {
    bug: "Bug",
    usability: "Usability",
    calculation: "Calculation",
    performance: "Performance",
    suggestion: "Suggestion",
    other: "Other"
  };

  return labels[type] || "Feedback";
}

function paymentInterestLabel(value) {
  const labels = {
    yes_99: "Would pay ₹99/month",
    yes_199: "Would pay ₹199/month",
    maybe: "Maybe after more features",
    no: "Would not pay",
    not_sure: "Not sure"
  };

  return labels[value] || "Not answered";
}

function featureLabel(value) {
  const labels = {
    pdf_excel: "PDF and Excel reports",
    receipt_photos: "Receipt photographs",
    approval: "Expense approval workflow",
    audit: "Complete audit history",
    reminders: "Payment reminders",
    categories: "Custom categories",
    gst_tax: "GST and tax reports",
    member_permissions: "Member permissions",
    other: "Other"
  };

  return labels[value] || "Other";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setConnectionStatus(mode, text) {
  const status = $("#connection-status");
  status.className = `status-pill ${mode}`;
  status.textContent = text;
}

function setScreen(screen) {
  $("#configuration-screen").hidden = screen !== "configuration";
  $("#auth-screen").hidden = screen !== "auth";
  $("#workspace-screen").hidden = screen !== "workspace";
  $("#app").hidden = screen !== "app";
}

function partnerName(partnerId) {
  return state.partners.find((partner) => partner.id === partnerId)?.name || "Unknown";
}

function allPartners() {
  return [...state.partners].sort((a, b) => a.name.localeCompare(b.name));
}

function activePartners() {
  return allPartners().filter((partner) => partner.is_active !== false);
}

function participantIdsForExpense(expenseId) {
  return state.participants
    .filter((item) => item.expense_id === expenseId)
    .map((item) => item.partner_id);
}

function expensesForMonth(month) {
  return state.expenses.filter((expense) => !month || expense.expense_date.startsWith(month));
}

function calculateSummary(expenses) {
  const summaryMap = new Map(
    allPartners().map((partner) => [
      partner.id,
      {
        partnerId: partner.id,
        name: partner.name,
        paid: 0,
        share: 0,
        balance: 0
      }
    ])
  );

  expenses.forEach((expense) => {
    const amount = Number(expense.amount);
    const payer = summaryMap.get(expense.paid_by);
    if (payer) payer.paid += amount;

    const participantIds = participantIdsForExpense(expense.id);
    if (!participantIds.length) return;

    const share = amount / participantIds.length;
    participantIds.forEach((partnerId) => {
      const partner = summaryMap.get(partnerId);
      if (partner) partner.share += share;
    });
  });

  return [...summaryMap.values()].map((row) => ({
    ...row,
    paid: roundMoney(row.paid),
    share: roundMoney(row.share),
    balance: roundMoney(row.paid - row.share)
  }));
}

function calculateSettlements(summary) {
  const creditors = summary
    .filter((row) => row.balance > 0.009)
    .map((row) => ({ name: row.name, amount: row.balance }))
    .sort((a, b) => b.amount - a.amount);

  const debtors = summary
    .filter((row) => row.balance < -0.009)
    .map((row) => ({ name: row.name, amount: Math.abs(row.balance) }))
    .sort((a, b) => b.amount - a.amount);

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundMoney(Math.min(creditor.amount, debtor.amount));

    if (amount > 0) {
      settlements.push({ from: debtor.name, to: creditor.name, amount });
    }

    creditor.amount = roundMoney(creditor.amount - amount);
    debtor.amount = roundMoney(debtor.amount - amount);

    if (creditor.amount <= 0.009) creditorIndex += 1;
    if (debtor.amount <= 0.009) debtorIndex += 1;
  }

  return settlements;
}

function switchView(viewId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === viewId));
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viewId === "dashboard") renderDashboard();
  if (viewId === "add-expense") renderExpenseForm();
  if (viewId === "history") renderHistory();
  if (viewId === "partners") renderPartners();
  if (viewId === "team") renderTeam();
}

function cacheKey() {
  return `${CACHE_PREFIX}${state.workspace?.id || "none"}`;
}

function saveWorkspaceCache() {
  if (!state.workspace) return;
  localStorage.setItem(cacheKey(), JSON.stringify({
    version: APP_VERSION,
    savedAt: new Date().toISOString(),
    workspace: state.workspace,
    role: state.role,
    partners: state.partners,
    expenses: state.expenses,
    participants: state.participants,
    members: state.members
  }));
}

function loadWorkspaceCache(workspaceId) {
  try {
    const cached = JSON.parse(localStorage.getItem(`${CACHE_PREFIX}${workspaceId}`));
    if (!cached) return false;

    state.workspace = cached.workspace;
    state.role = cached.role;
    state.partners = cached.partners || [];
    state.expenses = cached.expenses || [];
    state.participants = cached.participants || [];
    state.members = cached.members || [];
    return true;
  } catch {
    return false;
  }
}

function renderHeader() {
  $("#business-title").textContent = state.workspace?.name || "ExpenseSplitter";
  $("#signed-in-email").textContent = state.user
    ? `Signed in as ${state.user.email}`
    : "";
  document.title = `${state.workspace?.name || "ExpenseSplitter"} – Shared Expenses`;

  const selector = $("#workspace-selector");
  selector.innerHTML = state.memberships.map((membership) => `
    <option value="${membership.workspace.id}"
      ${membership.workspace.id === state.workspace?.id ? "selected" : ""}>
      ${escapeHtml(membership.workspace.name)}
    </option>
  `).join("");
}

function renderDashboard() {
  if (!state.workspace) return;

  const month = $("#dashboard-month").value || currentMonth();
  const expenses = expensesForMonth(month);
  const summary = calculateSummary(expenses);
  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);

  $("#metric-total").textContent = formatMoney(total);
  $("#metric-count").textContent = String(expenses.length);
  $("#metric-partners").textContent = String(activePartners().length);
  $("#metric-average").textContent = formatMoney(expenses.length ? total / expenses.length : 0);

  $("#summary-body").innerHTML = summary.map((row) => {
    const balanceClass = row.balance > 0.009
      ? "positive"
      : row.balance < -0.009
        ? "negative"
        : "neutral";

    const balanceLabel = row.balance > 0.009
      ? `Receive ${formatMoney(row.balance)}`
      : row.balance < -0.009
        ? `Pay ${formatMoney(Math.abs(row.balance))}`
        : "Settled";

    return `
      <tr>
        <td data-label="Partner">${escapeHtml(row.name)}</td>
        <td data-label="Paid">${formatMoney(row.paid)}</td>
        <td data-label="Share">${formatMoney(row.share)}</td>
        <td data-label="Balance" class="${balanceClass}">${escapeHtml(balanceLabel)}</td>
      </tr>
    `;
  }).join("");

  $("#summary-empty").hidden = expenses.length > 0;
  $("#summary-table-wrap").hidden = expenses.length === 0;

  const settlements = calculateSettlements(summary);
  $("#settlement-list").innerHTML = settlements.map((item) => `
    <div class="settlement-item">
      <span><b>${escapeHtml(item.from)}</b> pays <b>${escapeHtml(item.to)}</b></span>
      <strong>${formatMoney(item.amount)}</strong>
    </div>
  `).join("");

  const settlementEmpty = $("#settlement-empty");
  settlementEmpty.hidden = settlements.length > 0;
  settlementEmpty.textContent = expenses.length > 0
    ? "Everyone is already settled."
    : "Add expenses to calculate settlements.";

  renderCategoryChart(expenses);
}

function renderCategoryChart(expenses) {
  const totals = new Map();
  expenses.forEach((expense) => {
    totals.set(expense.category, (totals.get(expense.category) || 0) + Number(expense.amount));
  });

  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 0;

  $("#category-chart").innerHTML = rows.map(([category, amount]) => `
    <div class="category-row">
      <span class="category-name" title="${escapeHtml(category)}">${escapeHtml(category)}</span>
      <div class="category-track">
        <div class="category-fill" style="width:${max ? (amount / max) * 100 : 0}%"></div>
      </div>
      <strong>${formatMoney(amount)}</strong>
    </div>
  `).join("");

  $("#category-chart").hidden = rows.length === 0;
  $("#category-empty").hidden = rows.length > 0;
}

function renderExpenseForm() {
  const partners = activePartners();
  $("#expense-form").hidden = partners.length === 0;
  $("#no-partner-message").hidden = partners.length > 0;

  $("#expense-payer").innerHTML = partners.map((partner) => `
    <option value="${partner.id}">${escapeHtml(partner.name)}</option>
  `).join("");

  $("#participant-list").innerHTML = partners.map((partner) => `
    <label class="participant-option">
      <input type="checkbox" name="participant" value="${partner.id}" checked>
      <span>${escapeHtml(partner.name)}</span>
    </label>
  `).join("");

  updateSharePreview();
  updateWriteAvailability();
}

function updateSharePreview() {
  const amount = Number($("#expense-amount").value || 0);
  const selected = $$('input[name="participant"]:checked');
  const preview = $("#share-preview");

  if (!selected.length) {
    preview.textContent = "Select at least one partner.";
  } else if (amount <= 0) {
    preview.textContent = `${selected.length} partner${selected.length === 1 ? "" : "s"} selected.`;
  } else {
    preview.textContent = `${formatMoney(amount / selected.length)} per selected partner.`;
  }
}

function renderPartners() {
  const partners = allPartners();
  const usedIds = new Set();

  state.expenses.forEach((expense) => usedIds.add(expense.paid_by));
  state.participants.forEach((participant) => usedIds.add(participant.partner_id));

  $("#partner-list").innerHTML = partners.map((partner) => {
    const used = usedIds.has(partner.id);
    const archived = partner.is_active === false;

    let actionButton = "";

    if (archived) {
      actionButton = `
        <button class="partner-action-button restore-partner" type="button"
                data-id="${partner.id}" ${!navigator.onLine ? "disabled" : ""}>
          Restore
        </button>
        ${
          state.role === "owner"
            ? `
              <button class="partner-action-button delete-archived-partner danger"
                      type="button" data-id="${partner.id}"
                      ${!navigator.onLine ? "disabled" : ""}>
                Delete data
              </button>
            `
            : ""
        }
      `;
    } else if (used) {
      actionButton = `
        <button class="partner-action-button archive-partner" type="button"
                data-id="${partner.id}" ${!navigator.onLine ? "disabled" : ""}>
          Archive
        </button>
      `;
    } else {
      actionButton = `
        <button class="partner-action-button delete-partner danger" type="button"
                data-id="${partner.id}" ${!navigator.onLine ? "disabled" : ""}>
          Delete
        </button>
      `;
    }

    return `
      <div class="partner-item ${archived ? "partner-archived" : ""}">
        <div class="partner-info">
          <div class="partner-name-row">
            <strong>${escapeHtml(partner.name)}</strong>
            ${archived ? '<span class="archived-badge">Archived</span>' : ""}
          </div>
          ${
            archived
              ? '<p class="helper-text">Excluded from all new expenses. Restore or permanently delete after final settlement.</p>'
              : used
                ? '<p class="helper-text">Used in expense records — archive instead of deleting.</p>'
                : '<p class="helper-text">Not used in any expense; safe to delete permanently.</p>'
          }
        </div>
        <div class="partner-actions">
          ${actionButton}
        </div>
      </div>
    `;
  }).join("");

  $("#partner-empty").hidden = partners.length > 0;

  $$(".delete-partner").forEach((button) => {
    button.addEventListener("click", () => deletePartner(button.dataset.id));
  });

  $$(".archive-partner").forEach((button) => {
    button.addEventListener("click", () => archivePartner(button.dataset.id));
  });

  $$(".restore-partner").forEach((button) => {
    button.addEventListener("click", () => restorePartner(button.dataset.id));
  });

  $$(".delete-archived-partner").forEach((button) => {
    button.addEventListener("click", () =>
      deleteArchivedPartnerData(button.dataset.id)
    );
  });

  updateWriteAvailability();
}

function filteredHistory() {
  const month = $("#history-month").value;
  const query = $("#history-search").value.trim().toLowerCase();

  return [...state.expenses]
    .filter((expense) => !month || expense.expense_date.startsWith(month))
    .filter((expense) => {
      if (!query) return true;
      const searchable = [
        expense.description,
        expense.category,
        partnerName(expense.paid_by),
        ...participantIdsForExpense(expense.id).map(partnerName)
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    })
    .sort((a, b) =>
      b.expense_date.localeCompare(a.expense_date) ||
      b.created_at.localeCompare(a.created_at)
    );
}

function renderHistory() {
  const expenses = filteredHistory();

  $("#history-list").innerHTML = expenses.map((expense) => {
    const participants = participantIdsForExpense(expense.id).map(partnerName).join(", ");
    const addedBy = state.members.find((member) => member.user_id === expense.created_by)?.email;

    return `
      <div class="history-item">
        <div class="history-main">
          <div class="history-title">
            <strong>${escapeHtml(expense.description || expense.category)}</strong>
            <span class="badge">${escapeHtml(expense.category)}</span>
          </div>
          <p class="history-meta">
            ${formatDate(expense.expense_date)} · Paid by ${escapeHtml(partnerName(expense.paid_by))}
          </p>
          <p class="history-meta">Shared by: ${escapeHtml(participants)}</p>
          ${addedBy ? `<p class="history-meta">Entered by: ${escapeHtml(addedBy)}</p>` : ""}
        </div>
        <div>
          <div class="history-amount">${formatMoney(expense.amount)}</div>
          <button class="icon-button delete-expense" type="button"
                  data-id="${expense.id}" ${!navigator.onLine ? "disabled" : ""}>
            Delete
          </button>
        </div>
      </div>
    `;
  }).join("");

  $("#history-empty").hidden = expenses.length > 0;

  $$(".delete-expense").forEach((button) => {
    button.addEventListener("click", () => deleteExpense(button.dataset.id));
  });

  updateWriteAvailability();
}

function renderTeam() {
  if (!state.workspace) return;

  $("#invite-code").textContent = state.workspace.invite_code || "--------";
  $("#workspace-name").value = state.workspace.name || "";
  $("#workspace-currency").value = state.workspace.currency || "INR";

  const isOwner = state.role === "owner";
  $("#workspace-name").disabled = !isOwner;
  $("#workspace-currency").disabled = !isOwner;
  $("#save-workspace-settings").disabled = !isOwner || !navigator.onLine;
  $("#owner-only-message").textContent = isOwner
    ? "Only the workspace owner can change these settings."
    : "You are a member. Only the workspace owner can change these settings.";

  $("#member-list").innerHTML = state.members.map((member) => `
    <div class="member-item">
      <div>
        <strong>${escapeHtml(member.email || "Member")}</strong>
        ${member.user_id === state.user?.id ? '<p class="helper-text">This device</p>' : ""}
      </div>
      <span class="member-role">${escapeHtml(member.role)}</span>
    </div>
  `).join("");
}

function renderFeedback() {
  if (!state.workspace || !state.user) return;

  const emailInput = $("#feedback-email");
  if (emailInput && !emailInput.value) {
    emailInput.value = state.user.email || "";
  }

  const devicePreview = $("#feedback-device-preview");
  if (devicePreview) {
    devicePreview.textContent =
      `Device details will be attached automatically. App version ${APP_VERSION}.`;
  }

  const availability = $("#feedback-availability-message");
  const submitButton = $("#submit-feedback-button");

  if (!state.feedbackReady) {
    if (availability) {
      availability.textContent = state.feedbackError
        ? "Feedback storage is not enabled yet. The workspace owner must run the included Supabase feedback SQL."
        : "Checking feedback storage…";
    }
    if (submitButton) submitButton.disabled = true;
  } else {
    if (availability) {
      availability.textContent = navigator.onLine
        ? "Your submission is private to you and the workspace owner."
        : "Connect to the internet before submitting feedback.";
    }
    if (submitButton) submitButton.disabled = !navigator.onLine;
  }

  const inboxPanel = $("#feedback-inbox-panel");
  if (inboxPanel) inboxPanel.hidden = state.role !== "owner";

  if (state.role !== "owner") return;

  const feedbackList = $("#feedback-list");
  const feedbackEmpty = $("#feedback-empty");

  const rows = [...state.feedback].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );

  feedbackList.innerHTML = rows.map((item) => {
    const rating = Math.max(1, Math.min(5, Number(item.rating || 0)));
    const stars = "★".repeat(rating) + "☆".repeat(5 - rating);

    return `
      <article class="feedback-card">
        <div class="feedback-card-head">
          <div>
            <span class="feedback-type-badge">${escapeHtml(feedbackTypeLabel(item.feedback_type))}</span>
            <strong class="feedback-stars" aria-label="${rating} out of 5">${stars}</strong>
          </div>
          <time>${escapeHtml(formatDateTime(item.created_at))}</time>
        </div>

        <p class="feedback-message">${escapeHtml(item.message)}</p>

        <div class="feedback-meta-grid">
          <span><b>Screen:</b> ${escapeHtml(item.screen_name || "Other")}</span>
          <span><b>User:</b> ${escapeHtml(item.contact_email || item.user_email || "Anonymous")}</span>
          <span><b>Payment:</b> ${escapeHtml(paymentInterestLabel(item.payment_interest))}</span>
          <span><b>Feature:</b> ${escapeHtml(featureLabel(item.desired_feature))}</span>
        </div>

        <details class="feedback-device-details">
          <summary>Technical details</summary>
          <p>${escapeHtml(item.device_info || "Not available")}</p>
          <p>App version: ${escapeHtml(item.app_version || "")}</p>
        </details>
      </article>
    `;
  }).join("");

  feedbackEmpty.hidden = rows.length > 0;
  $("#export-feedback-csv").disabled = rows.length === 0;
}

function renderAll() {
  renderHeader();
  renderDashboard();
  renderExpenseForm();
  renderHistory();
  renderPartners();
  renderTeam();
  renderFeedback();
}

function updateWriteAvailability() {
  const offline = !navigator.onLine;
  $("#save-expense-button").disabled = offline || state.partners.length === 0;
  $("#partner-form").querySelector("button").disabled = offline;
  $("#manual-refresh").disabled = offline;
  const feedbackButton = $("#submit-feedback-button");
  if (feedbackButton) {
    feedbackButton.disabled = offline || !state.feedbackReady;
  }
  if (offline) {
    setConnectionStatus("offline", "Offline – view only");
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = $("#auth-email").value.trim();
  const password = $("#auth-password").value;
  const button = $("#auth-submit");
  const message = $("#auth-message");

  button.disabled = true;
  message.textContent = "";

  try {
    if (state.authMode === "signup") {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthRedirectUrl()
        }
      });
      if (error) throw error;

      if (data.session) {
        showToast("Account created and signed in.");
      } else {
        message.textContent = "Account created. Check your email and confirm the account, then sign in.";
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    message.textContent = error.message || "Authentication failed.";
  } finally {
    button.disabled = false;
  }
}

async function resetPassword() {
  const email = $("#auth-email").value.trim();
  if (!email) {
    showToast("Enter your email address first.");
    return;
  }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl()
  });

  if (error) {
    showToast(error.message);
  } else {
    showToast("Password reset email sent.");
  }
}

async function loadMemberships() {
  const { data, error } = await db
    .from("workspace_members")
    .select(`
      workspace_id,
      role,
      email,
      workspaces (
        id,
        name,
        currency,
        invite_code,
        created_at
      )
    `)
    .eq("user_id", state.user.id)
    .order("joined_at", { ascending: true });

  if (error) throw error;

  state.memberships = (data || [])
    .filter((item) => item.workspaces)
    .map((item) => ({
      workspaceId: item.workspace_id,
      role: item.role,
      email: item.email,
      workspace: item.workspaces
    }));
}

async function chooseWorkspace(workspaceId) {
  const membership = state.memberships.find((item) => item.workspace.id === workspaceId);
  if (!membership) return;

  state.workspace = membership.workspace;
  state.role = membership.role;
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspaceId);

  setScreen("app");
  renderHeader();
  await loadWorkspaceData();
  subscribeToWorkspace();
}

async function handleSignedIn(session) {
  state.session = session;
  state.user = session.user;

  try {
    setConnectionStatus("syncing", "Loading");
    await loadMemberships();

    if (!state.memberships.length) {
      setScreen("workspace");
      return;
    }

    const preferredId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const membership = state.memberships.find((item) => item.workspace.id === preferredId)
      || state.memberships[0];

    await chooseWorkspace(membership.workspace.id);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not load your workspace.");
    setScreen("workspace");
  }
}


async function loadFeedbackData() {
  if (!state.workspace || !state.user) return;

  try {
    const { data, error } = await db
      .from("app_feedback")
      .select(`
        id,
        workspace_id,
        user_id,
        user_email,
        contact_email,
        feedback_type,
        screen_name,
        rating,
        message,
        payment_interest,
        desired_feature,
        device_info,
        app_version,
        status,
        created_at
      `)
      .eq("workspace_id", state.workspace.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    state.feedback = data || [];
    state.feedbackReady = true;
    state.feedbackError = "";
  } catch (error) {
    console.error("Feedback storage is unavailable:", error);
    state.feedback = [];
    state.feedbackReady = false;
    state.feedbackError = error.message || "Feedback table unavailable.";
  }

  renderFeedback();
}

async function loadWorkspaceData() {
  if (!state.workspace) return;

  setConnectionStatus("syncing", "Synchronizing");

  try {
    const workspaceId = state.workspace.id;

    const [partnersResult, expensesResult, participantsResult, membersResult, workspaceResult] =
      await Promise.all([
        db.from("partners")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("name", { ascending: true }),

        db.from("expenses")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false }),

        db.from("expense_participants")
          .select("*")
          .eq("workspace_id", workspaceId),

        db.from("workspace_members")
          .select("workspace_id,user_id,email,role,joined_at")
          .eq("workspace_id", workspaceId)
          .order("joined_at", { ascending: true }),

        db.from("workspaces")
          .select("id,name,currency,invite_code,created_at")
          .eq("id", workspaceId)
          .single()
      ]);

    const firstError = [
      partnersResult.error,
      expensesResult.error,
      participantsResult.error,
      membersResult.error,
      workspaceResult.error
    ].find(Boolean);

    if (firstError) throw firstError;

    state.partners = partnersResult.data || [];
    state.expenses = expensesResult.data || [];
    state.participants = participantsResult.data || [];
    state.members = membersResult.data || [];
    state.workspace = workspaceResult.data;

    const membership = state.memberships.find((item) => item.workspace.id === workspaceId);
    if (membership) membership.workspace = state.workspace;

    saveWorkspaceCache();
    renderAll();
    await loadFeedbackData();
    setConnectionStatus("online", "Live");
  } catch (error) {
    console.error(error);
    const loadedCache = loadWorkspaceCache(state.workspace.id);
    if (loadedCache) {
      renderAll();
      setConnectionStatus("offline", "Cached data");
      showToast("Cloud unavailable. Showing the most recently synchronized data.");
    } else {
      setConnectionStatus("offline", "Sync failed");
      showToast(error.message || "Could not synchronize data.");
    }
  }
}

function scheduleReload() {
  clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(() => loadWorkspaceData(), 350);
}

function subscribeToWorkspace() {
  if (!state.workspace) return;

  if (state.realtimeChannel) {
    db.removeChannel(state.realtimeChannel);
  }

  const workspaceId = state.workspace.id;
  state.realtimeChannel = db
    .channel(`expense-share-${workspaceId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "partners",
      filter: `workspace_id=eq.${workspaceId}`
    }, scheduleReload)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "expenses",
      filter: `workspace_id=eq.${workspaceId}`
    }, scheduleReload)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "expense_participants",
      filter: `workspace_id=eq.${workspaceId}`
    }, scheduleReload)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "workspace_members",
      filter: `workspace_id=eq.${workspaceId}`
    }, scheduleReload)
    .subscribe((status, error) => {
      if (status === "SUBSCRIBED") setConnectionStatus("online", "Live");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error(status, error);
        setConnectionStatus("offline", "Reconnect needed");
      }
    });
}

async function createWorkspace(event) {
  event.preventDefault();
  const name = $("#new-workspace-name").value.trim();
  const currency = $("#new-workspace-currency").value;

  try {
    const { data, error } = await db.rpc("create_workspace", {
      p_name: name,
      p_currency: currency
    });
    if (error) throw error;

    await loadMemberships();
    await chooseWorkspace(data[0].workspace_id);
    showToast(`Workspace created. Invite code: ${data[0].invite_code}`);
  } catch (error) {
    showToast(error.message || "Could not create workspace.");
  }
}

async function joinWorkspace(event) {
  event.preventDefault();
  const code = $("#join-invite-code").value.trim().toUpperCase();

  try {
    const { data, error } = await db.rpc("join_workspace", {
      p_invite_code: code
    });
    if (error) throw error;

    await loadMemberships();
    await chooseWorkspace(data[0].workspace_id);
    showToast("You joined the shared workspace.");
  } catch (error) {
    showToast(error.message || "Could not join workspace.");
  }
}

async function addPartner(event) {
  event.preventDefault();

  if (!navigator.onLine) {
    showToast("Connect to the internet to add a partner.");
    return;
  }

  const input = $("#partner-name");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (!name) return;

  const existingPartner = state.partners.find(
    (partner) => partner.name.toLowerCase() === name.toLowerCase()
  );

  if (existingPartner) {
    if (existingPartner.is_active === false) {
      const restoreConfirmed = window.confirm(
        `${existingPartner.name} is archived. Restore this partner?`
      );
      if (!restoreConfirmed) return;

      await restorePartner(existingPartner.id);
      input.value = "";
      return;
    }

    showToast("This partner already exists.");
    return;
  }

  const { error } = await db.from("partners").insert({
    workspace_id: state.workspace.id,
    name,
    is_active: true,
    created_by: state.user.id
  });

  if (error) {
    showToast(error.code === "23505" ? "This partner already exists." : error.message);
    return;
  }

  input.value = "";
  showToast("Partner added for everyone.");
  await loadWorkspaceData();
}

async function deletePartner(partnerId) {
  const partner = state.partners.find((item) => item.id === partnerId);
  if (!partner) return;

  const isUsed =
    state.expenses.some((expense) => expense.paid_by === partnerId) ||
    state.participants.some((participant) => participant.partner_id === partnerId);

  if (isUsed) {
    showToast("This partner has expense history. Archive the partner instead.");
    return;
  }

  const confirmed = window.confirm(
    `Permanently delete ${partner.name}? This cannot be undone.`
  );
  if (!confirmed) return;

  const { error } = await db
    .from("partners")
    .delete()
    .eq("id", partnerId)
    .eq("workspace_id", state.workspace.id);

  if (error) {
    showToast(error.message || "This partner could not be deleted.");
  } else {
    showToast("Partner permanently deleted.");
    await loadWorkspaceData();
  }
}

async function archivePartner(partnerId) {
  const partner = state.partners.find((item) => item.id === partnerId);
  if (!partner) return;

  const confirmed = window.confirm(
    `Archive ${partner.name}? They will be removed from new expense forms, but all previous records and calculations will remain.`
  );
  if (!confirmed) return;

  const { error } = await db
    .from("partners")
    .update({ is_active: false })
    .eq("id", partnerId)
    .eq("workspace_id", state.workspace.id);

  if (error) {
    showToast(error.message || "This partner could not be archived.");
  } else {
    showToast("Partner archived. Previous expense history is preserved.");
    await loadWorkspaceData();
  }
}

async function restorePartner(partnerId) {
  const partner = state.partners.find((item) => item.id === partnerId);
  if (!partner) return;

  const { error } = await db
    .from("partners")
    .update({ is_active: true })
    .eq("id", partnerId)
    .eq("workspace_id", state.workspace.id);

  if (error) {
    showToast(error.message || "This partner could not be restored.");
  } else {
    showToast("Partner restored.");
    await loadWorkspaceData();
  }
}

async function deleteArchivedPartnerData(partnerId) {
  const partner = state.partners.find((item) => item.id === partnerId);
  if (!partner) return;

  if (state.role !== "owner") {
    showToast("Only the workspace owner can permanently delete partner data.");
    return;
  }

  if (partner.is_active !== false) {
    showToast("Archive the partner before permanently deleting their data.");
    return;
  }

  const relatedExpenses = state.expenses.filter((expense) => {
    if (expense.paid_by === partnerId) return true;
    return state.participants.some(
      (participant) =>
        participant.expense_id === expense.id &&
        participant.partner_id === partnerId
    );
  });

  const relatedTotal = relatedExpenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0
  );

  const warning =
    `${partner.name} is involved in ${relatedExpenses.length} expense record(s) ` +
    `totalling ${formatMoney(relatedTotal)}.\n\n` +
    `This action will permanently delete the archived partner and every expense ` +
    `where they paid or shared the cost. Other partners' historical totals may change.\n\n` +
    `Continue only after the final settlement is complete.\n\n` +
    `Type DELETE to confirm:`;

  const confirmation = window.prompt(warning);
  if (confirmation !== "DELETE") {
    showToast("Permanent deletion cancelled.");
    return;
  }

  try {
    const { data, error } = await db.rpc(
      "delete_archived_partner_data",
      {
        p_workspace_id: state.workspace.id,
        p_partner_id: partnerId
      }
    );

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    const deletedExpenses = Number(result?.deleted_expenses || 0);

    showToast(
      `${partner.name} and ${deletedExpenses} related expense record(s) were permanently deleted.`
    );
    await loadWorkspaceData();
  } catch (error) {
    console.error(error);
    showToast(
      error.message ||
      "Could not permanently delete this archived partner."
    );
  }
}

async function addExpense(event) {
  event.preventDefault();

  if (!navigator.onLine) {
    showToast("Connect to the internet to save an expense.");
    return;
  }

  const participantIds = $$('input[name="participant"]:checked').map(
    (checkbox) => checkbox.value
  );
  const amount = Number($("#expense-amount").value);

  if (!participantIds.length) {
    showToast("Select at least one partner.");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("Enter a valid amount.");
    return;
  }

  const button = $("#save-expense-button");
  button.disabled = true;

  try {
    const { error } = await db.rpc("add_expense", {
      p_workspace_id: state.workspace.id,
      p_expense_date: $("#expense-date").value,
      p_category: $("#expense-category").value,
      p_description: $("#expense-description").value.trim(),
      p_amount: roundMoney(amount),
      p_paid_by: $("#expense-payer").value,
      p_participant_ids: participantIds
    });

    if (error) throw error;

    event.target.reset();
    $("#expense-date").value = todayIso();
    showToast("Expense saved and shared with everyone.");
    await loadWorkspaceData();
    switchView("dashboard");
  } catch (error) {
    showToast(error.message || "Could not save expense.");
  } finally {
    button.disabled = false;
  }
}

async function deleteExpense(expenseId) {
  if (!window.confirm("Delete this expense for every workspace member?")) return;

  const { error } = await db
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("workspace_id", state.workspace.id);

  if (error) {
    showToast(error.message || "Could not delete expense.");
  } else {
    showToast("Expense deleted for everyone.");
    await loadWorkspaceData();
  }
}

async function saveWorkspaceSettings(event) {
  event.preventDefault();
  if (state.role !== "owner") return;

  const updates = {
    name: $("#workspace-name").value.trim(),
    currency: $("#workspace-currency").value,
    updated_at: new Date().toISOString()
  };

  const { error } = await db
    .from("workspaces")
    .update(updates)
    .eq("id", state.workspace.id);

  if (error) {
    showToast(error.message);
    return;
  }

  await loadMemberships();
  const membership = state.memberships.find((item) => item.workspace.id === state.workspace.id);
  if (membership) {
    state.workspace = membership.workspace;
  }
  await loadWorkspaceData();
  showToast("Workspace settings updated.");
}

function exportCsv() {
  const expenses = filteredHistory();
  if (!expenses.length) {
    showToast("No expenses to export.");
    return;
  }

  const rows = [
    ["Date", "Category", "Description", "Amount", "Paid By", "Shared By", "Entered By"]
  ];

  expenses.forEach((expense) => {
    const enteredBy = state.members.find((member) => member.user_id === expense.created_by)?.email || "";
    rows.push([
      expense.expense_date,
      expense.category,
      expense.description || "",
      Number(expense.amount).toFixed(2),
      partnerName(expense.paid_by),
      participantIdsForExpense(expense.id).map(partnerName).join("; "),
      enteredBy
    ]);
  });

  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shared-expenses-${$("#history-month").value || "all"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}


async function submitFeedback(event) {
  event.preventDefault();

  if (!navigator.onLine) {
    showToast("Connect to the internet before submitting feedback.");
    return;
  }

  if (!state.feedbackReady) {
    showToast("Feedback storage is not enabled yet.");
    return;
  }

  const message = $("#feedback-message").value.trim();
  if (message.length < 3) {
    showToast("Please describe the problem or suggestion.");
    return;
  }

  const button = $("#submit-feedback-button");
  button.disabled = true;

  const payload = {
    workspace_id: state.workspace.id,
    user_id: state.user.id,
    user_email: state.user.email || "",
    contact_email: $("#feedback-email").value.trim(),
    feedback_type: $("#feedback-type").value,
    screen_name: $("#feedback-screen").value,
    rating: Number($("#feedback-rating").value),
    message,
    payment_interest: $("#feedback-payment").value,
    desired_feature: $("#feedback-feature").value,
    device_info: getDeviceSummary(),
    app_version: String(APP_VERSION)
  };

  try {
    const { error } = await db.from("app_feedback").insert(payload);
    if (error) throw error;

    event.target.reset();
    $("#feedback-rating").value = "3";
    $("#feedback-payment").value = "maybe";
    $("#feedback-email").value = state.user.email || "";

    showToast("Thank you. Your feedback was submitted.");
    await loadFeedbackData();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not submit feedback.");
  } finally {
    button.disabled = !navigator.onLine || !state.feedbackReady;
  }
}

function exportFeedbackCsv() {
  if (state.role !== "owner" || !state.feedback.length) {
    showToast("No feedback is available to export.");
    return;
  }

  const rows = [[
    "Date",
    "Type",
    "Rating",
    "Screen",
    "Message",
    "User Email",
    "Contact Email",
    "Payment Interest",
    "Desired Feature",
    "App Version",
    "Device Information"
  ]];

  state.feedback.forEach((item) => {
    rows.push([
      item.created_at || "",
      feedbackTypeLabel(item.feedback_type),
      item.rating || "",
      item.screen_name || "",
      item.message || "",
      item.user_email || "",
      item.contact_email || "",
      paymentInterestLabel(item.payment_interest),
      featureLabel(item.desired_feature),
      item.app_version || "",
      item.device_info || ""
    ]);
  });

  const csv = rows
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `expensesplitter-feedback-${todayIso()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function openFeedbackSection() {
  switchView("team");

  window.setTimeout(() => {
    $("#feedback-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    $("#feedback-message")?.focus({ preventScroll: true });
  }, 180);
}

async function signOut() {
  if (state.realtimeChannel) {
    await db.removeChannel(state.realtimeChannel);
    state.realtimeChannel = null;
  }
  await db.auth.signOut();
}

function setAuthMode(mode) {
  state.authMode = mode;
  $$(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.authMode === mode));
  $("#auth-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
  $("#auth-password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#forgot-password").hidden = mode === "signup";
  $("#auth-message").textContent = "";
}

function setupEvents() {
  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => setAuthMode(tab.dataset.authMode));
  });

  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#forgot-password").addEventListener("click", resetPassword);
  $("#create-workspace-form").addEventListener("submit", createWorkspace);
  $("#join-workspace-form").addEventListener("submit", joinWorkspace);
  $("#workspace-signout").addEventListener("click", signOut);
  $("#signout-button").addEventListener("click", signOut);

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });
  $$("[data-go-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.goView));
  });

  $("#workspace-selector").addEventListener("change", async (event) => {
    await chooseWorkspace(event.target.value);
  });

  $("#dashboard-month").addEventListener("change", renderDashboard);
  $("#history-month").addEventListener("change", renderHistory);
  $("#history-search").addEventListener("input", renderHistory);
  $("#expense-amount").addEventListener("input", updateSharePreview);
  $("#participant-list").addEventListener("change", updateSharePreview);

  $("#select-all-partners").addEventListener("click", () => {
    $$('input[name="participant"]').forEach((checkbox) => checkbox.checked = true);
    updateSharePreview();
  });
  $("#clear-all-partners").addEventListener("click", () => {
    $$('input[name="participant"]').forEach((checkbox) => checkbox.checked = false);
    updateSharePreview();
  });

  $("#partner-form").addEventListener("submit", addPartner);
  $("#expense-form").addEventListener("submit", addExpense);
  $("#workspace-settings-form").addEventListener("submit", saveWorkspaceSettings);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#manual-refresh").addEventListener("click", loadWorkspaceData);
  $("#feedback-form").addEventListener("submit", submitFeedback);
  $("#export-feedback-csv").addEventListener("click", exportFeedbackCsv);
  $("#feedback-shortcut").addEventListener("click", openFeedbackSection);

  $("#copy-invite-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.workspace.invite_code);
      showToast("Invite code copied.");
    } catch {
      showToast(`Invite code: ${state.workspace.invite_code}`);
    }
  });

  window.addEventListener("online", () => {
    setConnectionStatus("syncing", "Reconnecting");
    updateWriteAvailability();
    loadWorkspaceData();
  });

  window.addEventListener("offline", () => {
    setConnectionStatus("offline", "Offline – view only");
    updateWriteAvailability();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine && state.workspace) {
      loadWorkspaceData();
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#install-now-button").hidden = false;
  });

  $$("[data-open-install]").forEach((button) => {
    button.addEventListener("click", requestAppInstall);
  });

  $$("[data-close-install]").forEach((button) => {
    button.addEventListener("click", closeInstallModal);
  });

  $("#install-now-button").addEventListener("click", requestAppInstall);
  $("#share-app-button").addEventListener("click", shareAppLink);

  $("#install-modal").addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeInstallModal();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    closeInstallModal();
    showToast("ExpenseSplitter installed successfully.");
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(console.error);
    });
  }
}

async function initialize() {
  $("#expense-date").value = todayIso();
  $("#dashboard-month").value = currentMonth();
  $("#history-month").value = currentMonth();
  setupEvents();

  /*
    Disable service-worker registration on localhost while developing.
    This prevents an old app.js or config.js from remaining in the cache.
    It is enabled automatically after the app is published on HTTPS.
  */
  const isLocalDevelopment =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (!isLocalDevelopment) {
    registerServiceWorker();
  }

  if (!isConfigured() || !db) {
    setScreen("configuration");

    const details = document.querySelector(
      "#configuration-screen .muted"
    );

    if (details && databaseConnectionError) {
      details.textContent = databaseConnectionError;
    }

    console.error(
      "Supabase database client is unavailable:",
      databaseConnectionError
    );
    return;
  }

  try {
    const {
      data: { session },
      error: sessionError
    } = await db.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    db.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) {
        handleSignedIn(newSession).catch((error) => {
          console.error("Could not load signed-in account:", error);
          showToast(error.message || "Could not load your account.");
        });
      } else {
        state.session = null;
        state.user = null;
        state.memberships = [];
        state.workspace = null;
        state.role = null;
        setScreen("auth");
      }
    });

    if (session) {
      await handleSignedIn(session);
    } else {
      setScreen("auth");
    }
  } catch (error) {
    console.error("Supabase initialization failed:", error);
    setScreen("auth");
    $("#auth-message").textContent =
      error.message || "Could not connect to Supabase.";
  }
}

initialize();
