const state = {
  surveyUrl: "#",
  leaderboard: [],
  stats: { approvedTotal: 0, pendingTotal: 0, proofTotal: 0 },
  submissions: [],
  adminAuthed: false
};

const SURVEY_INTRO_TEXT = `안녕하세요. 사회탐구방법 교과에서 수행평가를 목적으로 연구를 진행 중인 고양국제고등학교 3학년 정주훈입니다.

본 설문은 AI가 형사재판 과정에서 어떤 역할을 맡는지에 따라 청소년이 그 재판 방식을 얼마나 정당하다고 느끼는지 알아보기 위한 연구입니다.

설문에서는 가상의 형사재판 상황을 읽고, 그 재판 방식에 대한 생각을 응답하게 됩니다. 정답은 없으며, 되도록이면 '보통이다' 선택지가 아닌 자신의 생각과 가장 가까운 답을 선택해 주세요.

본 설문은 익명으로 진행되며, 이름이나 연락처 등 응답자를 직접 식별할 수 있는 정보는 수집하지 않습니다. 응답 내용은 연구 및 통계 분석 목적으로만 사용되며, 「통계법」 제33조의 비밀 보호 취지에 따라 개인의 응답 내용은 외부에 공개되지 않습니다. 또한 수집된 자료는 연구 목적 이외의 용도로 사용되지 않습니다.

상품 추첨을 원하시는 분은 학번, 이름, 연락처를 작성해 주시되, 해당 개인정보 역시 상품 추첨 및 전달 목적으로만 사용되며, 이외의 용도로 사용되지 않습니다. 수집된 개인정보는 상품 추첨 및 전달 목적이 달성되는 즉시 파기할 예정입니다.

설문 참여는 자발적이며, 원하지 않을 경우 언제든지 참여를 중단할 수 있습니다. 참여를 중단하더라도 어떠한 불이익도 없습니다.

설문 제출 버튼을 눌러 응답 내용을 제출하신 경우, 위 내용을 숙지하였으며, 설문 참여에 동의한 것으로 간주합니다.`;

const SHARE_RULES = [
  "설문을 공유한 뒤 공유 화면을 사진으로 인증해 주세요.",
  "고양국제고 재학생에게 공유한 인증은 인정되지 않습니다.",
  "같은 사람에게 여러 명이 공유한 경우 가장 먼저 인증한 사람만 인정됩니다.",
  "단톡방에 공유한 경우 관리자가 사진을 확인한 뒤 실제 유효 인원 수를 반영합니다.",
  "순위는 관리자가 승인한 인원 수 기준으로 계산됩니다.",
  "상위 3명에게 기프티콘을 지급합니다."
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function paintIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function setMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `form-message ${type}`.trim();
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function statusLabel(status) {
  return {
    pending: "대기",
    approved: "승인",
    rejected: "반려"
  }[status] || status;
}

function shareTypeLabel(type) {
  return type === "group" ? "단톡방" : "1명";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function getShareSiteUrl() {
  return `${window.location.origin}/`;
}

function buildShareRulesText() {
  return SHARE_RULES.map((rule, index) => `${index + 1}. ${rule}`).join("\n");
}

function buildShareBundle() {
  return `[설문 안내]\n${SURVEY_INTRO_TEXT}\n\n[설문 링크]\n${state.surveyUrl}\n\n[공유 규칙]\n${buildShareRulesText()}\n\n[설문 공유 인증 사이트 링크]\n${getShareSiteUrl()}`;
}

function renderPostedRules() {
  $("#postedRulesList").innerHTML = SHARE_RULES.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("");
}

function setCopyStatus(text) {
  const target = $("#copyStatus");
  if (!target) return;
  target.textContent = text;
  window.clearTimeout(setCopyStatus.timer);
  setCopyStatus.timer = window.setTimeout(() => {
    target.textContent = "";
  }, 2500);
}

async function copyTextFrom(target) {
  const text = target.value || target.textContent || "";
  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    target.focus();
    target.select();
    document.execCommand("copy");
  }
  setCopyStatus("복사되었습니다.");
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "object" ? payload.error : payload;
    throw new Error(message || "요청에 실패했습니다.");
  }
  return payload;
}

function renderLeaderboard(target, entries, compact = false) {
  if (!entries.length) {
    target.innerHTML = `<div class="empty-state">아직 승인된 인증이 없습니다.</div>`;
    return;
  }

  target.innerHTML = entries
    .slice(0, compact ? 5 : 30)
    .map((item) => `
      <li class="${item.prizeCandidate ? "prize" : ""}">
        <span class="rank-number">${item.rank}</span>
        <span class="person">
          <strong>${escapeHtml(item.maskedName)}</strong>
          <span>전화번호 끝 4자리 ${escapeHtml(item.phoneLast4)} · 인증 ${item.proofCount}건</span>
        </span>
        <span class="count">
          ${item.approvedCount}
          <small>명</small>
        </span>
      </li>
    `)
    .join("");
}

async function loadLeaderboard() {
  const payload = await api("/api/leaderboard");
  state.leaderboard = payload.leaderboard;
  state.stats = payload.stats;
  $("#approvedTotal").textContent = state.stats.approvedTotal;
  $("#pendingTotal").textContent = state.stats.pendingTotal;
  renderLeaderboard($("#sideLeaderboard"), state.leaderboard, true);
  renderLeaderboard($("#fullLeaderboard"), state.leaderboard, false);
}

async function loadConfig() {
  const config = await api("/api/config");
  state.surveyUrl = config.surveyUrl;
  $("#surveyLink").href = state.surveyUrl;
  $("#shareBundleText").value = buildShareBundle();
}

function activateView(viewId) {
  $$(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  if (viewId === "rankView") loadLeaderboard().catch(console.error);
  if (viewId === "adminView") checkAdmin().catch(() => {});
}

function bindTabs() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });
}

function resetUploadPreview() {
  $("#previewGrid").innerHTML = "";
  $("#uploadTitle").textContent = "공유 화면 사진 선택";
  $("#uploadSubtitle").textContent = "여러 장 선택 가능, 이미지 파일만 업로드";
}

function bindUploadPreview() {
  $("#proofPhotos").addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      resetUploadPreview();
      return;
    }

    $("#uploadTitle").textContent = `${files.length}장 선택됨`;
    $("#uploadSubtitle").textContent = files.map((file) => file.name).join(", ");
    $("#previewGrid").innerHTML = files.map((file) => `
      <img src="${URL.createObjectURL(file)}" alt="선택한 인증 사진 미리보기" />
    `).join("");
  });
}

function bindProofForm() {
  $("#proofForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#submitMessage");
    setMessage(message, "접수 중입니다...");

    try {
      const formData = new FormData(form);
      formData.set("consent", form.consent.checked ? "true" : "false");
      await api("/api/submissions", { method: "POST", body: formData });
      form.reset();
      resetUploadPreview();
      setMessage(message, "인증이 접수되었습니다. 승인 후 순위에 반영됩니다.", "success");
      await loadLeaderboard();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  });
}

async function checkAdmin() {
  try {
    await api("/api/admin/me");
    state.adminAuthed = true;
    $("#adminLoginPanel").classList.add("hidden");
    $("#adminDashboard").classList.remove("hidden");
    await loadAdmin();
  } catch {
    state.adminAuthed = false;
    $("#adminLoginPanel").classList.remove("hidden");
    $("#adminDashboard").classList.add("hidden");
  }
}

function bindAdminLogin() {
  $("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#loginMessage");
    setMessage(message, "확인 중입니다...");

    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: form.password.value })
      });
      setMessage(message, "");
      form.reset();
      await checkAdmin();
    } catch (error) {
      setMessage(message, error.message, "error");
    }
  });

  $("#logoutButton").addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    await checkAdmin();
  });
}

function duplicateNote(item) {
  const info = item.duplicateInfo;
  if (!info?.checked) return "단톡방 인증은 사진을 보고 유효 인원을 직접 입력";
  if (info.isDuplicateTarget) {
    return `중복 가능: 최초 접수자는 ${escapeHtml(info.firstSubmissionName || "확인 필요")}`;
  }
  if (info.duplicateCount > 1) return "이 대상의 최초 접수";
  return "같은 대상 중복 없음";
}

function renderPhotoThumbs(item) {
  const photos = Array.isArray(item.photos) ? item.photos : [];
  if (!photos.length) return `<div class="photo-empty">사진 없음</div>`;
  return `
    <div class="proof-photos">
      ${photos.map((photo, index) => `
        <button class="photo-thumb" type="button" data-photo="${escapeHtml(photo.photoUrl)}" aria-label="인증 사진 ${index + 1} 확대 보기">
          <img src="${escapeHtml(photo.photoUrl)}" alt="인증 사진 ${index + 1}" />
        </button>
      `).join("")}
    </div>
  `;
}

function renderAdminList() {
  const target = $("#adminList");
  if (!state.submissions.length) {
    target.innerHTML = `<div class="empty-state">접수된 인증이 없습니다.</div>`;
    return;
  }

  target.innerHTML = state.submissions.map((item) => `
    <article class="proof-card" data-id="${escapeHtml(item.id)}">
      ${renderPhotoThumbs(item)}
      <div class="proof-main">
        <div class="proof-head">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${formatDate(item.createdAt)} 접수</p>
          </div>
          <span class="status-pill status-${item.status}">${statusLabel(item.status)}</span>
        </div>

        <div class="detail-grid">
          <div><span>전화번호</span><strong>${escapeHtml(item.phone)}</strong></div>
          <div><span>공유 방식</span><strong>${shareTypeLabel(item.shareType)}</strong></div>
          <div><span>공유 대상</span><strong>${escapeHtml(item.target)}</strong></div>
          <div><span>반영 인원</span><strong>${item.approvedCount}</strong></div>
        </div>

        <div class="admin-note ${item.duplicateInfo?.isDuplicateTarget ? "duplicate" : ""}">
          ${duplicateNote(item)}
        </div>

        ${item.memo ? `<div class="memo-box">${escapeHtml(item.memo)}</div>` : ""}

        <div class="admin-controls">
          <label>
            <span>상태</span>
            <select data-field="status">
              <option value="pending" ${item.status === "pending" ? "selected" : ""}>대기</option>
              <option value="approved" ${item.status === "approved" ? "selected" : ""}>승인</option>
              <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>반려</option>
            </select>
          </label>
          <label>
            <span>인원</span>
            <input type="number" min="1" max="9999" data-field="approvedCount" value="${item.approvedCount || 1}" />
          </label>
          <label>
            <span>관리 메모</span>
            <input data-field="adminMemo" value="${escapeHtml(item.adminMemo || "")}" />
          </label>
          <button class="primary-action" data-action="save">
            <i data-lucide="check"></i>
            저장
          </button>
          <button class="secondary-action delete-button" data-action="delete">
            <i data-lucide="trash-2"></i>
            삭제
          </button>
        </div>
      </div>
    </article>
  `).join("");

  paintIcons();
}

async function loadAdmin() {
  const payload = await api("/api/admin/submissions");
  state.submissions = payload.submissions;
  state.leaderboard = payload.leaderboard;
  const pending = state.submissions.filter((item) => item.status === "pending").length;
  const approved = state.submissions
    .filter((item) => item.status === "approved")
    .reduce((sum, item) => sum + Number(item.approvedCount || 0), 0);
  $("#adminProofTotal").textContent = state.submissions.length;
  $("#adminPendingTotal").textContent = pending;
  $("#adminApprovedTotal").textContent = approved;
  renderAdminList();
}

function bindAdminList() {
  $("#adminList").addEventListener("click", async (event) => {
    const photo = event.target.closest("[data-photo]");
    if (photo) {
      $("#dialogImage").src = photo.dataset.photo;
      $("#photoDialog").showModal();
      return;
    }

    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest(".proof-card");
    const id = card.dataset.id;

    if (button.dataset.action === "delete") {
      if (!confirm("이 인증과 사진 파일을 삭제할까요?")) return;
      await api(`/api/admin/submissions/${id}`, { method: "DELETE" });
      await loadAdmin();
      await loadLeaderboard();
      return;
    }

    const payload = {
      status: card.querySelector('[data-field="status"]').value,
      approvedCount: Number(card.querySelector('[data-field="approvedCount"]').value),
      adminMemo: card.querySelector('[data-field="adminMemo"]').value
    };

    await api(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    await loadAdmin();
    await loadLeaderboard();
  });
}

function bindShareTools() {
  $("#copyShareBundle").addEventListener("click", () => {
    $("#shareBundleText").value = buildShareBundle();
    copyTextFrom($("#shareBundleText")).catch(() => setCopyStatus("복사에 실패했습니다."));
  });
}

function bindRefreshButtons() {
  $("#refreshRank").addEventListener("click", () => loadLeaderboard().catch(console.error));
  $("#rankRefreshButton").addEventListener("click", () => loadLeaderboard().catch(console.error));
  $("#adminRefreshButton").addEventListener("click", () => loadAdmin().catch(console.error));
  $("#closePhotoDialog").addEventListener("click", () => $("#photoDialog").close());
}

async function init() {
  renderPostedRules();
  bindTabs();
  bindUploadPreview();
  bindProofForm();
  bindAdminLogin();
  bindAdminList();
  bindShareTools();
  bindRefreshButtons();
  await loadConfig();
  await loadLeaderboard();
  paintIcons();
}

init().catch((error) => {
  console.error(error);
  setMessage($("#submitMessage"), "앱을 불러오지 못했습니다.", "error");
});
