import { db, ref, set, push, onChildAdded, get, remove, child, onDisconnect, onValue, update, query, orderByChild, equalTo } from './firebase-config.js';

// --- UTILS ---
function generateId() { return Math.random().toString(36).substr(2,9); }
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- STATE ---
const state = {
    user: { name: "", avatar: "", id: localStorage.getItem('chat_uid') || generateId() },
    room: { id: "", name: "", avatar: "", adminUid: "" },
    selectedLoginAvatar: "",
    selectedCreateUserAvatar: "",
    selectedCreateRoomAvatar: "",
    isTyping: false,
    inputTimeout: null,
    darkMode: localStorage.getItem('darkMode') === 'true',
    listening: false,
    hasNotifPermission: false
};

if(!localStorage.getItem('chat_uid')) localStorage.setItem('chat_uid', state.user.id);

// --- AVATARS ---
const userSeeds = ["Felix", "Aneka", "Zack", "Molly", "Sam", "Bear", "Leo", "Bella", "Willow", "Max"];
const roomSeeds = ["Shape", "Polygon", "Star", "Circle", "Square", "Diamond", "Triangle", "Hexagon"];
const getUserAvatar = (seed) => `https://api.dicebear.com/7.x/open-peeps/svg?seed=${seed}&bg=e7f3ff`;
const getRoomAvatar = (seed) => `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;

state.selectedLoginAvatar = getUserAvatar(userSeeds[0]);
state.selectedCreateUserAvatar = getUserAvatar(userSeeds[0]);
state.selectedCreateRoomAvatar = getRoomAvatar(roomSeeds[0]);

// --- DOM ---
const el = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
    // Viewport Fix
    const setHeight = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
    };
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setHeight);
        window.visualViewport.addEventListener('scroll', setHeight);
    }
    window.addEventListener('resize', setHeight);
    setHeight(); 

    // IDs
    const ids = [
        'loginScreen', 'createModal', 'app', 'adminModal',
        'sidebar', 'messages', 'memberList', 'sidebarOverlay',
        'joinUser', 'joinRoom', 'joinKey', 'createUser', 'createRoom', 'createKey', 'msgInput',
        'btnLogin', 'btnOpenCreate', 'btnCloseModal', 'btnSignUp', 'btnSend', 'btnLogout', 
        'btnMobileMenu', 'btnDarkMode', 'btnEmoji', 'btnSettings', 'btnCloseAdmin',
        'btnUpdateKey', 'btnDeleteRoom', 'newRoomKey',
        'headerRoomName', 'headerRoomIcon', 'sidebarRoomNameDisplay', 'sidebarRoomIcon', 
        'typingIndicator', 'emojiPickerContainer', 'loadingOverlay', 'errorToast',
        'loginAvatarGrid', 'createRoomAvatarGrid', 'createUserAvatarGrid'
    ];
    ids.forEach(id => el[id] = document.getElementById(id));

    if(el.loginAvatarGrid) renderUserGrid(el.loginAvatarGrid, 'login');
    if(el.createUserAvatarGrid) renderUserGrid(el.createUserAvatarGrid, 'createUser');
    if(el.createRoomAvatarGrid) renderRoomGrid(el.createRoomAvatarGrid);
    if(state.darkMode) document.body.classList.add('dark-mode');

    setupEvents();

    // AUTO-LOGIN CHECK
    checkSession();
}

async function checkSession() {
    const session = JSON.parse(localStorage.getItem('chat_session'));
    if(session && session.roomId && session.userName && session.roomKey) {
        // Validation check
        setLoading(true, "Resuming Session...");
        try {
            const snap = await get(ref(db, `rooms/${session.roomId}`));
            if(snap.exists() && snap.val().password === session.roomKey) {
                // Valid session
                state.user.name = session.userName;
                state.user.avatar = session.userAvatar || state.selectedLoginAvatar;
                enterApp(session.roomId, session.roomName, snap.val().avatar, snap.val().admin);
            } else {
                localStorage.removeItem('chat_session');
                setLoading(false);
            }
        } catch(e) {
            localStorage.removeItem('chat_session');
            setLoading(false);
        }
    }
}

function setupEvents() {
    if(el.btnOpenCreate) el.btnOpenCreate.addEventListener('click', () => el.createModal.style.display = 'flex');
    if(el.btnCloseModal) el.btnCloseModal.addEventListener('click', () => el.createModal.style.display = 'none');
    if(el.btnLogin) el.btnLogin.addEventListener('click', attemptJoin);
    if(el.btnSignUp) el.btnSignUp.addEventListener('click', attemptCreate);
    if(el.btnSend) el.btnSend.addEventListener('click', sendMessage);
    if(el.btnLogout) el.btnLogout.addEventListener('click', logout);
    
    if(el.msgInput) {
        el.msgInput.addEventListener('keypress', (e) => { 
            handleTyping();
            if(e.key === 'Enter') sendMessage(); 
        });
    }

    const toggleSidebar = () => {
        el.sidebar.classList.toggle('active');
        if(el.sidebarOverlay) el.sidebarOverlay.style.display = el.sidebar.classList.contains('active') ? 'block' : 'none';
        if(el.emojiPickerContainer) el.emojiPickerContainer.style.display = 'none';
    };

    if(el.btnMobileMenu) el.btnMobileMenu.addEventListener('click', toggleSidebar);
    if(el.sidebarOverlay) el.sidebarOverlay.addEventListener('click', toggleSidebar);
    
    if(el.btnDarkMode) {
        el.btnDarkMode.addEventListener('click', () => {
            state.darkMode = !state.darkMode;
            document.body.classList.toggle('dark-mode', state.darkMode);
            localStorage.setItem('darkMode', state.darkMode);
        });
    }

    // Admin Events
    if(el.btnSettings) el.btnSettings.addEventListener('click', () => el.adminModal.style.display = 'flex');
    if(el.btnCloseAdmin) el.btnCloseAdmin.addEventListener('click', () => el.adminModal.style.display = 'none');
    
    if(el.btnUpdateKey) el.btnUpdateKey.addEventListener('click', async () => {
        const newKey = el.newRoomKey.value.trim();
        if(!newKey) return showError("Key cannot be empty");
        if(confirm("Change room password?")) {
            await update(ref(db, `rooms/${state.room.id}`), { password: newKey });
            showError("Password Updated!");
            el.adminModal.style.display = 'none';
        }
    });

    if(el.btnDeleteRoom) el.btnDeleteRoom.addEventListener('click', async () => {
        if(confirm("DELETE ROOM? This is permanent!")) {
            await remove(ref(db, `rooms/${state.room.id}`));
            alert("Room Deleted.");
            logout();
        }
    });

    // Emoji Picker
    let picker;
    if(el.btnEmoji) {
        el.btnEmoji.addEventListener('click', (e) => {
            e.stopPropagation();
            if(!picker && el.emojiPickerContainer) {
                picker = picmo.createPicker({ rootElement: el.emojiPickerContainer, itemsPerRow: 8, showRecents: false });
                picker.addEventListener('emoji:select', selection => {
                    el.msgInput.value += selection.emoji;
                    el.msgInput.focus();
                });
            }
            if(el.emojiPickerContainer) {
                const isHidden = el.emojiPickerContainer.style.display === 'none' || el.emojiPickerContainer.style.display === '';
                el.emojiPickerContainer.style.display = isHidden ? 'block' : 'none';
            }
        });
    }
    document.addEventListener('click', (e) => {
        if(el.emojiPickerContainer && !el.emojiPickerContainer.contains(e.target) && e.target !== el.btnEmoji) {
            el.emojiPickerContainer.style.display = 'none';
        }
    });

    // Notification Permission
    document.addEventListener('click', () => {
        if (Notification.permission === 'default') Notification.requestPermission();
    }, { once: true });
}

function logout() {
    localStorage.removeItem('chat_session');
    location.reload();
}

function setLoading(is, txt="Loading...") {
    if(!el.loadingOverlay) return;
    if(is) { el.loadingOverlay.querySelector('.loading-text').textContent = txt; el.loadingOverlay.style.display = 'flex'; }
    else el.loadingOverlay.style.display = 'none';
}
function sanitizeRoom(name) { return name.replace(/[.#$\[\]]/g, "_"); }
function showError(msg) {
    const toast = document.getElementById('errorToast');
    if(toast) { toast.innerText = msg; toast.style.display = 'block'; setTimeout(() => toast.style.display = 'none', 3000); }
    else alert(msg);
}

// --- AVATAR ---
function renderUserGrid(c, ctx) {
    c.innerHTML = '';
    userSeeds.forEach((s, i) => {
        const u = getUserAvatar(s);
        const img = document.createElement('img'); img.src = u; img.className = 'avatar-option';
        if(i===0) img.classList.add('selected');
        img.onclick = () => {
            c.querySelectorAll('.avatar-option').forEach(a=>a.classList.remove('selected'));
            img.classList.add('selected');
            if(ctx==='login') state.selectedLoginAvatar = u; else state.selectedCreateUserAvatar = u;
        };
        c.appendChild(img);
    });
}
function renderRoomGrid(c) {
    c.innerHTML = '';
    roomSeeds.forEach((s, i) => {
        const u = getRoomAvatar(s);
        const img = document.createElement('img'); img.src = u; img.className = 'avatar-option';
        if(i===0) img.classList.add('selected');
        img.onclick = () => {
            c.querySelectorAll('.avatar-option').forEach(a=>a.classList.remove('selected'));
            img.classList.add('selected');
            state.selectedCreateRoomAvatar = u;
        };
        c.appendChild(img);
    });
}

// --- CORE ---

async function checkUniqueName(roomId, name) {
    const q = query(ref(db, `rooms/${roomId}/members`), orderByChild('name'), equalTo(name));
    const snap = await get(q);
    return snap.exists(); 
}

async function attemptCreate() {
    const user = el.createUser.value.trim();
    const roomName = el.createRoom.value.trim();
    const key = el.createKey.value.trim();
    if(!user || !roomName || !key) return showError("Fill all fields");

    setLoading(true, "Creating...");
    const roomId = sanitizeRoom(roomName);
    const roomRef = ref(db, `rooms/${roomId}`);
    
    try {
        const snap = await get(roomRef);
        if(snap.exists()) { setLoading(false); return showError("Room Name Taken!"); }

        await set(roomRef, { 
            password: key, admin: state.user.id, adminName: user,
            avatar: state.selectedCreateRoomAvatar, createdAt: Date.now()
        });
        
        el.createModal.style.display = 'none';
        state.user.name = user;
        state.user.avatar = state.selectedCreateUserAvatar;
        
        saveSession(roomId, roomName, key, user, state.selectedCreateUserAvatar);
        enterApp(roomId, roomName, state.selectedCreateRoomAvatar, state.user.id);
    } catch(e) { console.error(e); setLoading(false); showError("Error creating room."); }
}

async function attemptJoin() {
    const user = el.joinUser.value.trim();
    const roomName = el.joinRoom.value.trim();
    const key = el.joinKey.value.trim();
    if(!user || !roomName || !key) return showError("Fill all fields");

    setLoading(true, "Joining...");
    const roomId = sanitizeRoom(roomName);
    try {
        const snap = await get(ref(db, `rooms/${roomId}`));
        if(!snap.exists()) { setLoading(false); return showError("Room not found"); }
        
        const data = snap.val();
        if(data.password !== key) { setLoading(false); return showError("Wrong Password"); }

        const isTaken = await checkUniqueName(roomId, user);
        if(isTaken) {
             const myRef = await get(ref(db, `rooms/${roomId}/members/${state.user.id}`));
             if(myRef.exists() && myRef.val().name === user) { /* Re-join logic matches */ } 
             else { setLoading(false); return showError(`Username '${user}' is taken.`); }
        }

        state.user.name = user;
        state.user.avatar = state.selectedLoginAvatar;
        saveSession(roomId, roomName, key, user, state.selectedLoginAvatar);
        enterApp(roomId, roomName, data.avatar || getRoomAvatar('default'), data.admin); 
    } catch(e) { 
        console.error("JOIN ERROR:", e); 
        setLoading(false); 
        showError("Error: " + e.message); 
    }
}

function saveSession(roomId, roomName, roomKey, userName, userAvatar) {
    localStorage.setItem('chat_session', JSON.stringify({ roomId, roomName, roomKey, userName, userAvatar }));
}

function enterApp(roomId, roomName, roomAvatar, adminUid) {
    state.room.id = roomId;
    state.room.name = roomName;
    state.room.avatar = roomAvatar;
    state.room.adminUid = adminUid;
    
    if(el.headerRoomName) el.headerRoomName.textContent = roomName;
    if(el.headerRoomIcon) { el.headerRoomIcon.src = roomAvatar; el.headerRoomIcon.style.display = 'block'; }
    if(el.sidebarRoomName) el.sidebarRoomName.textContent = roomName;
    if(el.sidebarRoomIcon) el.sidebarRoomIcon.src = roomAvatar;

    el.loginScreen.style.display = 'none';
    el.app.classList.add('visible');

    if(state.user.id === adminUid) { if(el.btnSettings) el.btnSettings.style.display = 'block'; }

    onValue(ref(db, `rooms/${roomId}/banned/${state.user.id}`), s => {
        if(s.exists()) { alert("You have been kicked."); logout(); }
    });
    onValue(ref(db, `rooms/${roomId}`), s => {
        if(!s.exists()) { alert("Room deleted."); logout(); }
    });

    const myRef = ref(db, `rooms/${roomId}/members/${state.user.id}`);
    set(myRef, { name: state.user.name, avatar: state.user.avatar, status: 'online', lastSeen: Date.now() });
    onDisconnect(myRef).update({ status: 'offline', lastSeen: Date.now() });

    setupListeners(roomId);
    setLoading(false);
}

function setupListeners(roomId) {
    if(state.listening) return;
    state.listening = true;

    onChildAdded(ref(db, `rooms/${roomId}/messages`), snap => renderMessage(snap.val()));
    onValue(ref(db, `rooms/${roomId}/members`), snap => renderMembers(snap.val()));
}

window.kickMember = async function(targetUid, targetName) {
    if(!confirm(`Kick ${targetName}?`)) return;
    try {
        await set(ref(db, `rooms/${state.room.id}/banned/${targetUid}`), true);
        await remove(ref(db, `rooms/${state.room.id}/members/${targetUid}`));
    } catch(e) { console.error(e); }
};

function renderMembers(members) {
    if(!el.memberList) return;
    el.memberList.innerHTML = '';
    let typingUsers = [];

    if(!members) return;
    const isAdmin = (state.user.id === state.room.adminUid);

    Object.entries(members).forEach(([uid, data]) => {
        if(data.typing && uid !== state.user.id) typingUsers.push(escapeHtml(data.name));

        const div = document.createElement('div');
        div.className = 'member-item';
        const safeName = escapeHtml(data.name);
        const isMe = uid === state.user.id;
        const kickBtn = (isAdmin && !isMe) ? `<i class="fa-solid fa-ban" style="color:#ff4444; margin-left:auto; padding:5px;" onclick="kickMember('${uid}', '${safeName}')"></i>` : '';

        div.innerHTML = `
            <div class="member-avatar-wrapper">
                <img src="${data.avatar}" class="member-avatar">
                <div class="status-dot ${data.status}"></div>
            </div>
            <span style="flex:1;">${safeName} ${isMe ? '(You)' : ''} ${uid === state.room.adminUid ? '👑' : ''}</span>
            ${kickBtn}
        `;
        el.memberList.appendChild(div);
    });

    if(el.typingIndicator) {
        if(typingUsers.length > 0) el.typingIndicator.textContent = `${typingUsers.join(', ')} is typing...`;
        else el.typingIndicator.textContent = '';
    }
}

function handleTyping() {
    if(state.isTyping) return;
    state.isTyping = true;
    update(ref(db, `rooms/${state.room.id}/members/${state.user.id}`), { typing: true }).catch(()=>{});
    clearTimeout(state.inputTimeout);
    state.inputTimeout = setTimeout(() => {
        state.isTyping = false;
        update(ref(db, `rooms/${state.room.id}/members/${state.user.id}`), { typing: false }).catch(()=>{});
    }, 2000);
}

function sendMessage() {
    const text = el.msgInput.value.trim();
    if(!text) return;
    push(ref(db, `rooms/${state.room.id}/messages`), { user: state.user.name, avatar: state.user.avatar, text: text, time: Date.now() });
    el.msgInput.value = ''; el.msgInput.focus();
}

function renderMessage(msg) {
    if(!msg || !msg.text) return;
    const isMe = msg.user === state.user.name;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
        ${!isMe ? `<div class="msg-meta"><img src="${msg.avatar}" class="msg-avatar"><span class="msg-name">${escapeHtml(msg.user)}</span></div>` : ''}
        <div>${escapeHtml(msg.text)}</div>
        <div class="msg-time">${time}</div>
    `;
    el.messages.appendChild(div);
    el.messages.scrollTop = el.messages.scrollHeight;

    // NOTIFICATION
    if(!isMe && document.hidden) {
        if (Notification.permission === 'granted') {
            new Notification(`New message from ${msg.user}`, { body: msg.text, icon: msg.avatar });
        }
    }
}
