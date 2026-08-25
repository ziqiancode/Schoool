import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const CONFIG = window.SCHOOOL_CONFIG || {};
const PUBLIC_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || CONFIG.SUPABASE_ANON_KEY || "";
const configured =
  CONFIG.SUPABASE_URL &&
  PUBLIC_KEY &&
  !CONFIG.SUPABASE_URL.includes("PASTE_") &&
  !PUBLIC_KEY.includes("PASTE_");

const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let supabase = null;
let session = null;
let me = null;
let profile = null;
let settings = null;
let captchaExpected = null;
let activeTab = "home";
let friends = [];
let selectedDmFriend = null;
let groups = [];
let selectedGroup = null;
let realtimeChannels = [];
let isAdmin = false;
const usernameCache = new Map();

const DEFAULT_SETTINGS = {
  theme: "system",
  background: "soft",
  font_family: "system",
  font_size: 16,
  font_color: "#1f2937",
  accent_color: "#5b5ce2"
};

function fakeEmail(username) {
  return `${normalizeUsername(username)}@schoool.local`;
}
function normalizeUsername(v) {
  return String(v || "").trim().toLowerCase();
}
function validUsername(v) {
  return /^[a-z0-9_]{3,24}$/.test(normalizeUsername(v));
}
function initials(name) {
  return String(name || "?").slice(0, 1).toUpperCase();
}
function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove("show"), 3500);
}
function setStatus(id, message, type = "") {
  const el = $(id);
  el.textContent = message || "";
  el.className = "form-status" + (type ? ` ${type}` : "");
}
function timeText(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function clearChannels() {
  if (!supabase) return;
  for (const ch of realtimeChannels) supabase.removeChannel(ch);
  realtimeChannels = [];
}
function addChannel(ch) {
  realtimeChannels.push(ch);
  return ch;
}
async function getUsername(userId) {
  if (!userId) return "unknown";
  if (usernameCache.has(userId)) return usernameCache.get(userId);
  const { data } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  const name = data?.username || "unknown";
  usernameCache.set(userId, name);
  return name;
}
function renderMessage(container, msg, username, own = false) {
  const row = document.createElement("div");
  row.className = "message" + (own ? " me" : "");

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials(username);

  const body = document.createElement("div");
  body.className = "message-body";

  const top = document.createElement("div");
  top.className = "message-top";
  const strong = document.createElement("strong");
  strong.textContent = username;
  const time = document.createElement("time");
  time.textContent = timeText(msg.created_at);
  top.append(strong, time);

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = msg.body;

  body.append(top, text);
  row.append(avatar, body);
  container.appendChild(row);
}
function scrollBottom(el) {
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function newCaptcha() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  const subtract = Math.random() < 0.35;
  if (subtract) {
    const hi = Math.max(a, b), lo = Math.min(a, b);
    captchaExpected = hi - lo;
    $("captchaQuestion").textContent = `What is ${hi} − ${lo}?`;
  } else {
    captchaExpected = a + b;
    $("captchaQuestion").textContent = `What is ${a} + ${b}?`;
  }
  $("captchaAnswer").value = "";
}

function switchAuth(mode) {
  const login = mode === "login";
  $("loginForm").classList.toggle("hidden", !login);
  $("signupForm").classList.toggle("hidden", login);
  $("showLoginBtn").classList.toggle("active", login);
  $("showSignupBtn").classList.toggle("active", !login);
  if (!login) newCaptcha();
}

async function signup(event) {
  event.preventDefault();
  if (!configured) return setStatus("signupStatus", "Supabase is not configured yet.", "error");

  const username = normalizeUsername($("signupUsername").value);
  const password = $("signupPassword").value;
  const captcha = Number($("captchaAnswer").value);

  if (!validUsername(username)) {
    return setStatus("signupStatus", "Username must be 3–24 lowercase letters, numbers, or underscores.", "error");
  }
  if (captcha !== captchaExpected) {
    newCaptcha();
    return setStatus("signupStatus", "CAPTCHA was incorrect. Try the new one.", "error");
  }

  setStatus("signupStatus", "Creating account…");
  const { data, error } = await supabase.auth.signUp({
    email: fakeEmail(username),
    password,
    options: { data: { username } }
  });

  if (error) {
    newCaptcha();
    const msg = error.message?.includes("Database error")
      ? "That username may already be taken."
      : error.message;
    return setStatus("signupStatus", msg, "error");
  }

  if (!data.session) {
    return setStatus(
      "signupStatus",
      "Account created, but Supabase email confirmation is enabled. Turn off Confirm Email in Supabase Auth settings.",
      "error"
    );
  }

  setStatus("signupStatus", "Account created!", "success");
}

async function login(event) {
  event.preventDefault();
  if (!configured) return setStatus("loginStatus", "Supabase is not configured yet.", "error");

  const username = normalizeUsername($("loginUsername").value);
  const password = $("loginPassword").value;
  if (!validUsername(username)) return setStatus("loginStatus", "Invalid username format.", "error");

  setStatus("loginStatus", "Logging in…");
  const { error } = await supabase.auth.signInWithPassword({
    email: fakeEmail(username),
    password
  });
  if (error) return setStatus("loginStatus", "Incorrect username or password.", "error");
  setStatus("loginStatus", "");
}

async function logout() {
  clearChannels();
  await supabase.auth.signOut();
}


async function checkAdminStatus() {
  if (!me || !supabase) {
    isAdmin = false;
    $("adminNavBtn").classList.add("hidden");
    return false;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", me.id)
    .maybeSingle();

  isAdmin = !error && !!data;
  $("adminNavBtn").classList.toggle("hidden", !isAdmin);

  if (!isAdmin && activeTab === "admin") {
    activeTab = "home";
  }
  return isAdmin;
}

function requireAdmin() {
  if (!isAdmin) {
    showToast("Admin access required.");
    return false;
  }
  return true;
}

async function loadAdminConsole() {
  if (!requireAdmin()) return;

  const [
    usersResult,
    messagesCountResult,
    groupsResult,
    adminsResult
  ] = await Promise.all([
    supabase.from("profiles").select("id,username,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("global_messages").select("id", { count: "exact", head: true }),
    supabase.from("groups").select("id,name,owner_id,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("admin_users").select("user_id", { count: "exact" })
  ]);

  if (usersResult.error || groupsResult.error || adminsResult.error) {
    showToast("Could not load all admin data.");
  }

  const users = usersResult.data || [];
  const adminIds = new Set((adminsResult.data || []).map(x => x.user_id));
  const groupsData = groupsResult.data || [];

  $("adminUserCount").textContent = users.length;
  $("adminGlobalMessageCount").textContent = messagesCountResult.count ?? "—";
  $("adminGroupCount").textContent = groupsData.length;
  $("adminAdminCount").textContent = adminsResult.count ?? adminIds.size;

  renderAdminUsers(users, adminIds);
  await renderAdminGroups(groupsData);
  await loadAdminMessages();
}

function renderAdminUsers(users, adminIds = new Set()) {
  const query = normalizeUsername($("adminUserSearch").value);
  const filtered = query
    ? users.filter(u => String(u.username).toLowerCase().includes(query))
    : users;

  const box = $("adminUsersList");
  box.innerHTML = "";

  if (!filtered.length) {
    box.innerHTML = `<div class="muted-note">No matching users.</div>`;
    return;
  }

  for (const user of filtered) {
    usernameCache.set(user.id, user.username);

    const row = document.createElement("div");
    row.className = "admin-row";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = initials(user.username);

    const grow = document.createElement("div");
    grow.className = "grow";

    const name = document.createElement("strong");
    name.textContent = user.username + (user.id === me.id ? " (you)" : "");

    const meta = document.createElement("small");
    const adminText = adminIds.has(user.id) ? " • Admin" : "";
    meta.textContent = `Joined ${new Date(user.created_at).toLocaleDateString()}${adminText}`;

    grow.append(name, meta);
    row.append(av, grow);
    box.appendChild(row);
  }
}

async function renderAdminGroups(groupsData) {
  const box = $("adminGroupsList");
  box.innerHTML = "";

  if (!groupsData.length) {
    box.innerHTML = `<div class="muted-note">No friend groups yet.</div>`;
    return;
  }

  for (const group of groupsData) {
    const owner = await getUsername(group.owner_id);

    const row = document.createElement("div");
    row.className = "admin-row";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = initials(group.name);

    const grow = document.createElement("div");
    grow.className = "grow";

    const name = document.createElement("strong");
    name.textContent = group.name;

    const meta = document.createElement("small");
    meta.textContent = `Owner: ${owner} • ${new Date(group.created_at).toLocaleDateString()}`;

    grow.append(name, meta);

    const remove = document.createElement("button");
    remove.className = "tiny-btn danger";
    remove.type = "button";
    remove.textContent = "Delete group";
    remove.addEventListener("click", () => adminDeleteGroup(group));

    row.append(av, grow, remove);
    box.appendChild(row);
  }
}

async function loadAdminMessages() {
  if (!requireAdmin()) return;

  const { data, error } = await supabase
    .from("global_messages")
    .select("id,sender_id,body,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const box = $("adminMessagesList");
  box.innerHTML = "";

  if (error) {
    box.innerHTML = `<div class="muted-note">Could not load global messages.</div>`;
    return;
  }

  if (!(data || []).length) {
    box.innerHTML = `<div class="muted-note">No global messages yet.</div>`;
    return;
  }

  for (const msg of data || []) {
    const username = await getUsername(msg.sender_id);

    const row = document.createElement("div");
    row.className = "admin-row";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = initials(username);

    const grow = document.createElement("div");
    grow.className = "grow";

    const top = document.createElement("strong");
    top.textContent = username;

    const meta = document.createElement("small");
    meta.textContent = new Date(msg.created_at).toLocaleString();

    const body = document.createElement("div");
    body.className = "admin-message-text";
    body.textContent = msg.body;

    grow.append(top, meta, body);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tiny-btn danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => adminDeleteGlobalMessage(msg.id));

    row.append(av, grow, remove);
    box.appendChild(row);
  }
}

async function adminDeleteGlobalMessage(id) {
  if (!requireAdmin()) return;
  if (!confirm("Delete this global message?")) return;

  const { error } = await supabase
    .from("global_messages")
    .delete()
    .eq("id", id);

  if (error) return showToast(error.message || "Could not delete message.");

  showToast("Global message deleted.");
  await Promise.all([loadAdminMessages(), loadGlobalMessages()]);
}

async function adminDeleteGroup(group) {
  if (!requireAdmin()) return;
  if (!confirm(`Delete the group "${group.name}" and all of its group messages?`)) return;

  const { error } = await supabase
    .from("groups")
    .delete()
    .eq("id", group.id);

  if (error) return showToast(error.message || "Could not delete group.");

  if (selectedGroup?.id === group.id) {
    selectedGroup = null;
    $("groupArea").classList.add("hidden");
    $("groupEmptyState").classList.remove("hidden");
  }

  showToast("Group deleted.");
  await Promise.all([loadAdminConsole(), loadGroups()]);
}

async function initializeUser(currentSession) {
  session = currentSession;
  me = currentSession.user;
  const { data: p, error: pError } = await supabase.from("profiles").select("*").eq("id", me.id).single();
  if (pError) {
    showToast("Could not load your Schoool profile.");
    return;
  }
  profile = p;
  usernameCache.set(me.id, profile.username);
  await checkAdminStatus();

  const { data: s } = await supabase.from("user_settings").select("*").eq("user_id", me.id).maybeSingle();
  settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  applySettings(settings);
  fillSettingsForm(settings);

  $("sidebarUsername").textContent = `@${profile.username}`;
  $("mobileUsername").textContent = `@${profile.username}`;
  $("settingsUsername").textContent = `@${profile.username}`;
  $("settingsUserId").textContent = me.id;
  $("welcomeHeading").textContent = `Hey, ${profile.username}.`;

  $("authScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");

  clearChannels();
  await Promise.all([
    loadFriends(),
    loadFriendRequests(),
    loadGroups(),
    loadGroupInvites()
  ]);
  subscribeGlobal();
  subscribeFriendEvents();
  subscribeGroupEvents();
  await refreshHome();
  await switchTab(activeTab);
}

function showLoggedOut() {
  session = null; me = null; profile = null; settings = null; friends = []; groups = [];
  selectedDmFriend = null; selectedGroup = null; isAdmin = false;
  $("adminNavBtn").classList.add("hidden");
  clearChannels();
  $("appScreen").classList.add("hidden");
  $("authScreen").classList.remove("hidden");
  applySettings(DEFAULT_SETTINGS);
}

async function switchTab(tab) {
  if (tab === "admin" && !isAdmin) {
    showToast("Admin access required.");
    tab = "home";
  }
  activeTab = tab;
  $$(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
  $$(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${tab}`));
  $("sidebar").classList.remove("open");

  if (!me) return;
  if (tab === "home") await refreshHome();
  if (tab === "global") await loadGlobalMessages();
  if (tab === "friends") await Promise.all([loadFriends(), loadFriendRequests()]);
  if (tab === "dms") await loadDmFriends();
  if (tab === "groups") await Promise.all([loadGroups(), loadGroupInvites()]);
  if (tab === "admin") await loadAdminConsole();
}

async function refreshHome() {
  if (!me) return;
  $("friendCount").textContent = friends.length;
  $("groupCount").textContent = groups.length;
  const pendingFriends = Number($("friendRequestBadge").textContent || 0);
  const pendingGroups = Number($("groupInviteBadge").textContent || 0);
  $("pendingCount").textContent = pendingFriends + pendingGroups;
}

/* GLOBAL CHAT */
async function loadGlobalMessages() {
  const box = $("globalMessages");
  box.innerHTML = "";
  const { data, error } = await supabase
    .from("global_messages")
    .select("id,sender_id,body,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return showToast("Could not load global chat.");
  const ordered = [...(data || [])].reverse();
  for (const msg of ordered) {
    const name = await getUsername(msg.sender_id);
    renderMessage(box, msg, name, msg.sender_id === me.id);
  }
  scrollBottom(box);
}
async function sendGlobal(event) {
  event.preventDefault();
  const input = $("globalMessageInput");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  const { error } = await supabase.from("global_messages").insert({ sender_id: me.id, body });
  if (error) {
    input.value = body;
    showToast(error.message || "Could not send message.");
  }
}
function subscribeGlobal() {
  const ch = supabase.channel(`global-${me.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "global_messages" }, async payload => {
      if (activeTab !== "global") return;
      const name = await getUsername(payload.new.sender_id);
      renderMessage($("globalMessages"), payload.new, name, payload.new.sender_id === me.id);
      scrollBottom($("globalMessages"));
    })
    .subscribe();
  addChannel(ch);
}

/* FRIENDS */
async function loadFriends() {
  const { data, error } = await supabase.from("friends").select("friend_id").eq("user_id", me.id);
  if (error) return showToast("Could not load friends.");

  const ids = (data || []).map(x => x.friend_id);
  if (!ids.length) {
    friends = [];
    renderFriends();
    return;
  }

  const { data: profiles } = await supabase.from("profiles").select("id,username").in("id", ids).order("username");
  friends = profiles || [];
  friends.forEach(f => usernameCache.set(f.id, f.username));
  renderFriends();
}
function renderFriends() {
  const box = $("friendsList");
  box.innerHTML = "";
  if (!friends.length) {
    box.innerHTML = `<div class="muted-note">No friends yet. Send somebody a request.</div>`;
  } else {
    for (const friend of friends) {
      const card = document.createElement("div");
      card.className = "person-card";
      const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(friend.username);
      const text = document.createElement("div"); text.className = "grow";
      const strong = document.createElement("strong"); strong.textContent = friend.username;
      const small = document.createElement("small"); small.textContent = "Friend";
      text.append(strong, small);
      card.append(av, text);
      box.appendChild(card);
    }
  }
  renderDmFriends();
  refreshHome();
}
async function sendFriendRequest(event) {
  event.preventDefault();
  const username = normalizeUsername($("friendSearchInput").value);
  setStatus("friendSearchStatus", "");
  if (!validUsername(username)) return setStatus("friendSearchStatus", "Enter an exact valid username.", "error");
  if (username === profile.username) return setStatus("friendSearchStatus", "You cannot friend yourself.", "error");

  const { data: target } = await supabase.from("profiles").select("id,username").eq("username", username).maybeSingle();
  if (!target) return setStatus("friendSearchStatus", "No Schoool user with that username.", "error");

  if (friends.some(f => f.id === target.id)) return setStatus("friendSearchStatus", "You are already friends.", "error");

  const { data: existing } = await supabase.from("friend_requests")
    .select("id,sender_id,receiver_id,status")
    .or(`and(sender_id.eq.${me.id},receiver_id.eq.${target.id}),and(sender_id.eq.${target.id},receiver_id.eq.${me.id})`)
    .maybeSingle();

  if (existing?.status === "pending") {
    return setStatus(
      "friendSearchStatus",
      existing.sender_id === me.id ? "Request already sent." : "They already sent you a request — accept it below.",
      "error"
    );
  }
  if (existing?.status === "declined") {
    await supabase.from("friend_requests").delete().eq("id", existing.id);
  }

  const { error } = await supabase.from("friend_requests").insert({
    sender_id: me.id,
    receiver_id: target.id
  });
  if (error) return setStatus("friendSearchStatus", error.message, "error");

  $("friendSearchInput").value = "";
  setStatus("friendSearchStatus", `Friend request sent to ${target.username}.`, "success");
}
async function loadFriendRequests() {
  const { data, error } = await supabase
    .from("friend_requests")
    .select("id,sender_id,receiver_id,status,created_at")
    .eq("receiver_id", me.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return showToast("Could not load friend requests.");
  const box = $("friendRequestsList");
  box.innerHTML = "";
  const requests = data || [];

  $("friendRequestBadge").textContent = requests.length;
  $("friendRequestBadge").classList.toggle("hidden", requests.length === 0);

  if (!requests.length) {
    box.innerHTML = `<div class="muted-note">No pending friend requests.</div>`;
    refreshHome();
    return;
  }

  for (const req of requests) {
    const username = await getUsername(req.sender_id);
    const row = document.createElement("div");
    row.className = "list-row";
    const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(username);
    const grow = document.createElement("div"); grow.className = "grow";
    const strong = document.createElement("strong"); strong.textContent = username;
    const small = document.createElement("small"); small.textContent = "wants to be friends";
    grow.append(strong, small);
    const actions = document.createElement("div"); actions.className = "row-actions";
    const accept = document.createElement("button"); accept.className = "tiny-btn primary"; accept.textContent = "Accept";
    const decline = document.createElement("button"); decline.className = "tiny-btn"; decline.textContent = "Decline";
    accept.addEventListener("click", () => respondFriendRequest(req.id, "accepted"));
    decline.addEventListener("click", () => respondFriendRequest(req.id, "declined"));
    actions.append(accept, decline);
    row.append(av, grow, actions);
    box.appendChild(row);
  }
  refreshHome();
}
async function respondFriendRequest(id, status) {
  const { error } = await supabase.from("friend_requests").update({ status }).eq("id", id);
  if (error) return showToast(error.message);
  await Promise.all([loadFriendRequests(), loadFriends()]);
  showToast(status === "accepted" ? "Friend added." : "Request declined.");
}
function subscribeFriendEvents() {
  const ch = supabase.channel(`friends-${me.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, async () => {
      await loadFriendRequests();
      await loadFriends();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "friends" }, async () => {
      await loadFriends();
    })
    .subscribe();
  addChannel(ch);
}

/* DMs */
function renderDmFriends() {
  const box = $("dmFriendsList");
  box.innerHTML = "";
  if (!friends.length) {
    box.innerHTML = `<div class="muted-note">Add a friend first.</div>`;
    return;
  }
  for (const friend of friends) {
    const row = document.createElement("button");
    row.className = "list-row";
    row.type = "button";
    const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(friend.username);
    const grow = document.createElement("div"); grow.className = "grow";
    const strong = document.createElement("strong"); strong.textContent = friend.username;
    const small = document.createElement("small"); small.textContent = "Open DM";
    grow.append(strong, small);
    row.append(av, grow);
    row.addEventListener("click", () => openDm(friend));
    box.appendChild(row);
  }
}
async function loadDmFriends() {
  await loadFriends();
  renderDmFriends();
}
async function openDm(friend) {
  selectedDmFriend = friend;
  $("dmEmptyState").classList.add("hidden");
  $("dmChatArea").classList.remove("hidden");
  $("dmTitle").textContent = friend.username;
  $("dmAvatar").textContent = initials(friend.username);
  await loadDmMessages();
}
async function loadDmMessages() {
  if (!selectedDmFriend) return;
  const box = $("dmMessages"); box.innerHTML = "";
  const { data, error } = await supabase.from("direct_messages")
    .select("id,sender_id,receiver_id,body,created_at")
    .or(`and(sender_id.eq.${me.id},receiver_id.eq.${selectedDmFriend.id}),and(sender_id.eq.${selectedDmFriend.id},receiver_id.eq.${me.id})`)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return showToast("Could not load DMs.");
  for (const msg of data || []) {
    const name = msg.sender_id === me.id ? profile.username : selectedDmFriend.username;
    renderMessage(box, msg, name, msg.sender_id === me.id);
  }
  scrollBottom(box);
}
async function sendDm(event) {
  event.preventDefault();
  if (!selectedDmFriend) return;
  const input = $("dmMessageInput"), body = input.value.trim();
  if (!body) return;
  input.value = "";
  const { error } = await supabase.from("direct_messages").insert({
    sender_id: me.id,
    receiver_id: selectedDmFriend.id,
    body
  });
  if (error) {
    input.value = body;
    showToast(error.message || "Could not send DM.");
  }
}
function subscribeDm() {
  // One broad RLS-protected realtime stream for DMs visible to this user.
  const ch = supabase.channel(`dms-${me.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages" }, async payload => {
      if (!selectedDmFriend || activeTab !== "dms") return;
      const msg = payload.new;
      const participants = [msg.sender_id, msg.receiver_id];
      if (!participants.includes(selectedDmFriend.id) || !participants.includes(me.id)) return;
      const name = msg.sender_id === me.id ? profile.username : selectedDmFriend.username;
      renderMessage($("dmMessages"), msg, name, msg.sender_id === me.id);
      scrollBottom($("dmMessages"));
    })
    .subscribe();
  addChannel(ch);
}

/* GROUPS */
async function loadGroups() {
  const { data: memberships, error } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", me.id);

  if (error) return showToast("Could not load groups.");
  const ids = (memberships || []).map(x => x.group_id);
  if (!ids.length) {
    groups = [];
    renderGroups();
    return;
  }
  const { data } = await supabase.from("groups").select("id,name,owner_id,created_at").in("id", ids).order("name");
  groups = data || [];
  renderGroups();
}
function renderGroups() {
  const box = $("groupsList"); box.innerHTML = "";
  if (!groups.length) {
    box.innerHTML = `<div class="muted-note">You are not in any groups yet.</div>`;
  } else {
    for (const group of groups) {
      const row = document.createElement("button");
      row.type = "button"; row.className = "list-row";
      const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(group.name);
      const grow = document.createElement("div"); grow.className = "grow";
      const strong = document.createElement("strong"); strong.textContent = group.name;
      const small = document.createElement("small"); small.textContent = group.owner_id === me.id ? "Owner" : "Member";
      grow.append(strong, small); row.append(av, grow);
      row.addEventListener("click", () => openGroup(group));
      box.appendChild(row);
    }
  }
  refreshHome();
}
async function createGroup(event) {
  event.preventDefault();
  const name = $("newGroupName").value.trim();
  if (!name) return;
  setStatus("createGroupStatus", "Creating…");
  const { data, error } = await supabase.from("groups").insert({ name, owner_id: me.id }).select().single();
  if (error) return setStatus("createGroupStatus", error.message, "error");
  $("newGroupName").value = "";
  setStatus("createGroupStatus", "", "");
  $("createGroupDialog").close();
  await loadGroups();
  showToast(`Created ${data.name}.`);
}
async function openGroup(group) {
  selectedGroup = group;
  $("groupEmptyState").classList.add("hidden");
  $("groupArea").classList.remove("hidden");
  $("groupTitle").textContent = group.name;
  $("inviteGroupName").textContent = `Invite somebody to ${group.name}`;
  await Promise.all([loadGroupMessages(), loadGroupMembers()]);
}
async function loadGroupMembers() {
  if (!selectedGroup) return;
  const { data: members, error } = await supabase.from("group_members")
    .select("user_id,role,joined_at")
    .eq("group_id", selectedGroup.id)
    .order("joined_at");
  if (error) return showToast("Could not load group members.");

  const ids = (members || []).map(x => x.user_id);
  const { data: profilesData } = ids.length
    ? await supabase.from("profiles").select("id,username").in("id", ids)
    : { data: [] };
  const map = new Map((profilesData || []).map(p => [p.id, p.username]));

  const box = $("groupMembersList"); box.innerHTML = "";
  for (const member of members || []) {
    const name = map.get(member.user_id) || "unknown";
    usernameCache.set(member.user_id, name);
    const row = document.createElement("div"); row.className = "list-row";
    const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(name);
    const grow = document.createElement("div"); grow.className = "grow";
    const strong = document.createElement("strong"); strong.textContent = name;
    const small = document.createElement("small"); small.textContent = member.role;
    grow.append(strong, small); row.append(av, grow); box.appendChild(row);
  }
}
async function loadGroupMessages() {
  if (!selectedGroup) return;
  const box = $("groupMessages"); box.innerHTML = "";
  const { data, error } = await supabase.from("group_messages")
    .select("id,group_id,sender_id,body,created_at")
    .eq("group_id", selectedGroup.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return showToast("Could not load group chat.");
  for (const msg of data || []) {
    const name = await getUsername(msg.sender_id);
    renderMessage(box, msg, name, msg.sender_id === me.id);
  }
  scrollBottom(box);
}
async function sendGroupMessage(event) {
  event.preventDefault();
  if (!selectedGroup) return;
  const input = $("groupMessageInput"), body = input.value.trim();
  if (!body) return;
  input.value = "";
  const { error } = await supabase.from("group_messages").insert({
    group_id: selectedGroup.id,
    sender_id: me.id,
    body
  });
  if (error) { input.value = body; showToast(error.message || "Could not send group message."); }
}
async function inviteToGroup(event) {
  event.preventDefault();
  if (!selectedGroup) return;
  const username = normalizeUsername($("inviteUsername").value);
  setStatus("inviteGroupStatus", "");
  if (!validUsername(username)) return setStatus("inviteGroupStatus", "Enter a valid username.", "error");

  const { data: target } = await supabase.from("profiles").select("id,username").eq("username", username).maybeSingle();
  if (!target) return setStatus("inviteGroupStatus", "No Schoool user with that username.", "error");

  const { data: existingMember } = await supabase.from("group_members")
    .select("user_id")
    .eq("group_id", selectedGroup.id)
    .eq("user_id", target.id)
    .maybeSingle();

  if (existingMember) {
    return setStatus("inviteGroupStatus", `${target.username} is already in this group.`, "error");
  }

  const { data: existingInvite } = await supabase.from("group_invites")
    .select("id,status")
    .eq("group_id", selectedGroup.id)
    .eq("invitee_id", target.id)
    .maybeSingle();

  if (existingInvite?.status === "pending") {
    return setStatus("inviteGroupStatus", `${target.username} already has a pending invite.`, "error");
  }

  if (existingInvite?.status === "declined") {
    await supabase.from("group_invites").delete().eq("id", existingInvite.id);
  }

  const { error } = await supabase.from("group_invites").insert({
    group_id: selectedGroup.id,
    inviter_id: me.id,
    invitee_id: target.id
  });
  if (error) return setStatus("inviteGroupStatus", error.message, "error");

  $("inviteUsername").value = "";
  setStatus("inviteGroupStatus", `Invite sent to ${target.username}.`, "success");
}
async function loadGroupInvites() {
  const { data, error } = await supabase.from("group_invites")
    .select("id,group_id,inviter_id,invitee_id,status,created_at")
    .eq("invitee_id", me.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return showToast("Could not load group invites.");
  const invites = data || [];
  $("groupInviteBadge").textContent = invites.length;
  $("groupInviteBadge").classList.toggle("hidden", invites.length === 0);

  const groupIds = [...new Set(invites.map(i => i.group_id))];
  const { data: groupData } = groupIds.length
    ? await supabase.from("groups").select("id,name").in("id", groupIds)
    : { data: [] };
  const gmap = new Map((groupData || []).map(g => [g.id, g.name]));

  const box = $("groupInvitesList"); box.innerHTML = "";
  if (!invites.length) {
    box.innerHTML = `<div class="muted-note">No pending group invitations.</div>`;
    refreshHome();
    return;
  }
  for (const invite of invites) {
    const inviter = await getUsername(invite.inviter_id);
    const groupName = gmap.get(invite.group_id) || "Group";
    const row = document.createElement("div"); row.className = "list-row";
    const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(groupName);
    const grow = document.createElement("div"); grow.className = "grow";
    const strong = document.createElement("strong"); strong.textContent = groupName;
    const small = document.createElement("small"); small.textContent = `invited by ${inviter}`;
    grow.append(strong, small);
    const actions = document.createElement("div"); actions.className = "row-actions";
    const accept = document.createElement("button"); accept.className = "tiny-btn primary"; accept.textContent = "Join";
    const decline = document.createElement("button"); decline.className = "tiny-btn"; decline.textContent = "Decline";
    accept.addEventListener("click", () => respondGroupInvite(invite.id, "accepted"));
    decline.addEventListener("click", () => respondGroupInvite(invite.id, "declined"));
    actions.append(accept, decline); row.append(av, grow, actions); box.appendChild(row);
  }
  refreshHome();
}
async function respondGroupInvite(id, status) {
  const { error } = await supabase.from("group_invites").update({ status }).eq("id", id);
  if (error) return showToast(error.message);
  await Promise.all([loadGroupInvites(), loadGroups()]);
  showToast(status === "accepted" ? "Joined group." : "Invite declined.");
}
function subscribeGroupEvents() {
  const inviteCh = supabase.channel(`group-events-${me.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_invites" }, async () => {
      await Promise.all([loadGroupInvites(), loadGroups()]);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, async () => {
      await loadGroups();
      if (selectedGroup) await loadGroupMembers();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, async payload => {
      if (!selectedGroup || activeTab !== "groups" || payload.new.group_id !== selectedGroup.id) return;
      const name = await getUsername(payload.new.sender_id);
      renderMessage($("groupMessages"), payload.new, name, payload.new.sender_id === me.id);
      scrollBottom($("groupMessages"));
    })
    .subscribe();
  addChannel(inviteCh);
}

/* SETTINGS */
function fillSettingsForm(s) {
  $("themeSelect").value = s.theme;
  $("backgroundSelect").value = s.background;
  $("fontFamilySelect").value = s.font_family;
  $("fontSizeRange").value = s.font_size;
  $("fontSizeLabel").textContent = `${s.font_size}px`;
  $("fontColorInput").value = normalizeHex(s.font_color, "#1f2937");
  $("accentColorInput").value = normalizeHex(s.accent_color, "#5b5ce2");
}
function normalizeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}
function applySettings(s) {
  const safe = { ...DEFAULT_SETTINGS, ...(s || {}) };
  document.body.dataset.theme = safe.theme;
  document.body.dataset.background = safe.background;
  document.body.dataset.font = safe.font_family;
  document.documentElement.style.setProperty("--font-size", `${safe.font_size}px`);

  // The default font color means "use the theme's automatic readable color".
  // A custom font color overrides it.
  if (normalizeHex(safe.font_color, DEFAULT_SETTINGS.font_color).toLowerCase() === DEFAULT_SETTINGS.font_color.toLowerCase()) {
    document.documentElement.style.removeProperty("--text");
  } else {
    document.documentElement.style.setProperty("--text", normalizeHex(safe.font_color, DEFAULT_SETTINGS.font_color));
  }

  document.documentElement.style.setProperty("--accent", normalizeHex(safe.accent_color, DEFAULT_SETTINGS.accent_color));
}
async function saveAppearance(event) {
  event.preventDefault();
  const next = {
    user_id: me.id,
    theme: $("themeSelect").value,
    background: $("backgroundSelect").value,
    font_family: $("fontFamilySelect").value,
    font_size: Number($("fontSizeRange").value),
    font_color: $("fontColorInput").value,
    accent_color: $("accentColorInput").value
  };
  applySettings(next);
  setStatus("appearanceStatus", "Saving…");
  const { data, error } = await supabase.from("user_settings").upsert(next).select().single();
  if (error) return setStatus("appearanceStatus", error.message, "error");
  settings = data;
  setStatus("appearanceStatus", "Saved.", "success");
}
function previewAppearance() {
  const next = {
    theme: $("themeSelect").value,
    background: $("backgroundSelect").value,
    font_family: $("fontFamilySelect").value,
    font_size: Number($("fontSizeRange").value),
    font_color: $("fontColorInput").value,
    accent_color: $("accentColorInput").value
  };
  $("fontSizeLabel").textContent = `${next.font_size}px`;
  applySettings(next);
}
function resetAppearance() {
  fillSettingsForm(DEFAULT_SETTINGS);
  applySettings(DEFAULT_SETTINGS);
}
async function changePassword(event) {
  event.preventDefault();
  const p1 = $("newPassword").value, p2 = $("confirmPassword").value;
  if (p1 !== p2) return setStatus("passwordStatus", "Passwords do not match.", "error");
  if (p1.length < 6) return setStatus("passwordStatus", "Password must be at least 6 characters.", "error");
  setStatus("passwordStatus", "Updating…");
  const { error } = await supabase.auth.updateUser({ password: p1 });
  if (error) return setStatus("passwordStatus", error.message, "error");
  $("newPassword").value = $("confirmPassword").value = "";
  setStatus("passwordStatus", "Password changed.", "success");
}

/* EVENTS */
$("showLoginBtn").addEventListener("click", () => switchAuth("login"));
$("showSignupBtn").addEventListener("click", () => switchAuth("signup"));
$("newCaptchaBtn").addEventListener("click", newCaptcha);
$("signupForm").addEventListener("submit", signup);
$("loginForm").addEventListener("submit", login);
$("logoutBtn").addEventListener("click", logout);
$("mobileMenuBtn").addEventListener("click", () => $("sidebar").classList.toggle("open"));
$$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
$$("[data-jump]").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.jump)));
$("refreshHomeBtn").addEventListener("click", refreshHome);

$("globalMessageForm").addEventListener("submit", sendGlobal);
$("friendSearchForm").addEventListener("submit", sendFriendRequest);
$("refreshRequestsBtn").addEventListener("click", loadFriendRequests);
$("refreshFriendsBtn").addEventListener("click", loadFriends);

$("dmMessageForm").addEventListener("submit", sendDm);

$("openCreateGroupBtn").addEventListener("click", () => $("createGroupDialog").showModal());
$("createGroupForm").addEventListener("submit", createGroup);
$("refreshGroupInvitesBtn").addEventListener("click", loadGroupInvites);
$("refreshGroupsBtn").addEventListener("click", loadGroups);
$("openInviteGroupBtn").addEventListener("click", () => {
  if (!selectedGroup) return;
  setStatus("inviteGroupStatus", "");
  $("inviteGroupDialog").showModal();
});
$("inviteGroupForm").addEventListener("submit", inviteToGroup);
$("groupMessageForm").addEventListener("submit", sendGroupMessage);
$$(".dialog-close").forEach(btn => btn.addEventListener("click", () => btn.closest("dialog").close()));

$("appearanceForm").addEventListener("submit", saveAppearance);
$("passwordForm").addEventListener("submit", changePassword);
$("resetAppearanceBtn").addEventListener("click", resetAppearance);
["themeSelect","backgroundSelect","fontFamilySelect","fontSizeRange","fontColorInput","accentColorInput"]
  .forEach(id => $(id).addEventListener("input", previewAppearance));


$("refreshAdminBtn").addEventListener("click", loadAdminConsole);
$("adminUserSearchBtn").addEventListener("click", loadAdminConsole);
$("adminUserSearch").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadAdminConsole();
  }
});

/* BOOT */
newCaptcha();
applySettings(DEFAULT_SETTINGS);

if (!configured) {
  $("setupBanner").classList.remove("hidden");
  $("setupMessage").textContent = "Open config.js and paste your Supabase Project URL + anon/public key.";
} else {
  supabase = createClient(CONFIG.SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data: { session: initialSession } } = await supabase.auth.getSession();
  if (initialSession) {
    await initializeUser(initialSession);
    subscribeDm();
  }

  supabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (nextSession && (!me || nextSession.user.id !== me.id)) {
      await initializeUser(nextSession);
      subscribeDm();
    } else if (!nextSession) {
      showLoggedOut();
    }
  });
}
