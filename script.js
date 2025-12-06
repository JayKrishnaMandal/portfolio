import { db, ref, set, get, update, push, child, onValue, onChildAdded, onDisconnect, remove } from "./firebase-config.js";
import { createPicker } from 'https://cdn.jsdelivr.net/npm/picmo@latest/dist/index.js';

// --- STATE ---
let currentUser = null; // { uid, username, avatar, autoLogout }
let currentRoomId = null;
let currentRoomName = null;
let currentRoomKey = null; 
let isDark = false;
let typingTimeout = null;
let replyTarget = null; // { id, name, text }

// --- DOM ELEMENTS ---
const el = {
    authScreen: document.getElementById('authScreen'),
    dashboardScreen: document.getElementById('dashboardScreen'),
    app: document.getElementById('app'),
    
    // Auth Forms
    tabLogin: document.getElementById('tabLogin'),
    tabRegister: document.getElementById('tabRegister'),
    formLogin: document.getElementById('formLogin'),
    formRegister: document.getElementById('formRegister'),
    regAvatarPreview: document.getElementById('regAvatarPreview'),
    regAvatarInput: document.getElementById('regAvatarInput'),
    
    // Dashboard
    dashUserAvatar: document.getElementById('dashUserAvatar'),
    dashUserName: document.getElementById('dashUserName'),
    roomsList: document.getElementById('roomsList'),
    
    // Chat UI
    messages: document.getElementById('messages'),
    msgInput: document.getElementById('msgInput'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.querySelector('.sidebar-overlay'),
    memberList: document.getElementById('memberList'),
    headerRoomName: document.getElementById('headerRoomName'),
    
    // Modals
    createModal: document.getElementById('createModal'),
    loading: document.getElementById('loadingOverlay')
};

// --- INITIALIZATION ---
function init() {
    toggleDarkMode(localStorage.getItem('theme') === 'dark');
    setupEventListeners();
    
    // Check Persistence
    const savedUser = JSON.parse(localStorage.getItem('jkchat_user')); // Persistent
    const sessionUser = JSON.parse(sessionStorage.getItem('jkchat_user')); // Session
    
    if (savedUser) {
        loginUser(savedUser.uid, true);
    } else if (sessionUser) {
        loginUser(sessionUser.uid, false);
    } else {
        showScreen('auth');
    }
}

function showScreen(screen) {
    if(el.authScreen) el.authScreen.style.display = 'none';
    if(el.dashboardScreen) el.dashboardScreen.style.display = 'none';
    if(el.app) el.app.classList.remove('visible');
    
    if (screen === 'auth' && el.authScreen) el.authScreen.style.display = 'flex';
    if (screen === 'dashboard' && el.dashboardScreen) {
        el.dashboardScreen.style.display = 'flex';
        renderDashboard();
    }
    if (screen === 'chat' && el.app) el.app.classList.add('visible');
}

// --- AUTHENTICATION ---
async function registerUser() {
    const user = document.getElementById('regUsername').value.trim();
    const pass = document.getElementById('regPassword').value.trim();
    const file = el.regAvatarInput.files[0];
    const feedback = document.getElementById('regFeedback');

    if (user.length < 3 || pass.length < 6) return showError('Username > 3 chars, Password > 6 chars', feedback);
    if (!file) return showError('Please upload a profile picture', feedback);

    setLoading(true, 'Creating Profile...');
    
    try {
        // 1. Compress Image
        const avatarBase64 = await compressImage(file);
        
        // 2. Generate UID
        const uid = push(child(ref(db), 'users')).key;
        
        const userData = {
            uid: uid,
            username: escapeHtml(user),
            password: btoa(pass), // Basic encoding
            avatar: avatarBase64,
            joinedRooms: {}
        };

        // 3. Save to DB
        await set(ref(db, `users/${uid}`), userData);
        
        // 4. Auto Login
        currentUser = userData;
        saveSession(userData, false); // Default to session only on reg
        showScreen('dashboard');
        
    } catch (e) {
        console.error(e);
        showError('Registration failed: ' + e.message, feedback);
    } finally {
        setLoading(false);
    }
}

async function loginUser(uidOrUsername, isPersistent) {
    // If we have direct UID (from local storage)
    if (arguments.length === 2 && typeof uidOrUsername === 'string' && uidOrUsername.length > 10) {
        // Fetch by UID
        try {
            const snap = await get(ref(db, `users/${uidOrUsername}`));
            if (snap.exists()) {
                currentUser = snap.val();
                showScreen('dashboard');
                return;
            } else {
                // Invalid UID in storage
                localStorage.removeItem('jkchat_user');
                sessionStorage.removeItem('jkchat_user');
                showScreen('auth');
                return;
            }
        } catch(e) {
            console.error(e);
            return;
        }
    }

    // Manual Login Form
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const autoLogout = document.getElementById('chkAutoLogout').checked;
    const feedback = document.getElementById('loginFeedback');

    if (!username || !password) return showError('Missing credentials', feedback);

    setLoading(true, 'Verifying...');

    try {
        const snap = await get(ref(db, 'users'));
        let foundUser = null;
        
        if (snap.exists()) {
            snap.forEach(child => {
                const u = child.val();
                if (u.username === username && u.password === btoa(password)) {
                    foundUser = u;
                }
            });
        }

        if (foundUser) {
            currentUser = foundUser;
            currentUser.autoLogout = autoLogout;
            update(ref(db, `users/${foundUser.uid}`), { autoLogout });
            saveSession(foundUser, !autoLogout);
            showScreen('dashboard');
        } else {
            showError('Invalid username or password', feedback);
        }
    } catch (e) {
        console.error(e);
        showError('Login Error: ' + e.message, feedback);
    } finally {
        setLoading(false);
    }
}

function saveSession(user, persistent) {
    const data = JSON.stringify({ uid: user.uid });
    if (persistent) {
        localStorage.setItem('jkchat_user', data);
        sessionStorage.removeItem('jkchat_user');
    } else {
        sessionStorage.setItem('jkchat_user', data);
        localStorage.removeItem('jkchat_user');
    }
}

function logout() {
    if(currentUser && currentRoomId) {
        // Remove presence
        remove(ref(db, `rooms/${currentRoomId}/members/${currentUser.uid}`));
    }
    currentUser = null;
    localStorage.removeItem('jkchat_user');
    sessionStorage.removeItem('jkchat_user');
    location.reload();
}

// --- DASHBOARD LOGIC ---
function renderDashboard() {
    if (!currentUser) return;
    
    el.dashUserAvatar.src = currentUser.avatar;
    el.dashUserName.textContent = currentUser.username;
    el.roomsList.innerHTML = '';

    const rooms = currentUser.joinedRooms || {};
    const roomIds = Object.keys(rooms);

    if (roomIds.length === 0) {
        el.roomsList.innerHTML = `<div class="empty-state"><i class="fa-regular fa-comments"></i><p>No rooms found. Create or Join one!</p></div>`;
    }

    roomIds.forEach(async (rid) => {
        // Fetch generic room details
        const rSnap = await get(ref(db, `rooms/${rid}/meta`));
        if (rSnap.exists()) {
            const meta = rSnap.val();
            const card = document.createElement('div');
            card.className = 'room-card';
            card.innerHTML = `
                <img src="${meta.icon}" class="room-card-icon">
                <div class="room-card-info">
                    <h4>${escapeHtml(meta.name)}</h4>
                    <p>Tap to enter</p>
                </div>
            `;
            card.onclick = () => enterRoom(rid, meta);
            el.roomsList.appendChild(card);
        } else {
            // Room deleted?
            // Optional: Cleanup user's joinedRooms?
        }
    });
}

// --- ROOM LOGIC ---
async function createRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const key = document.getElementById('newRoomKey').value.trim();
    const selectedIcon = document.querySelector('.small-grid .selected')?.src || `https://api.dicebear.com/7.x/shapes/svg?seed=${Date.now()}`;

    if (!name || !key) return alert('Please fill all fields');
    if (!currentUser) return;

    setLoading(true, 'Creating Room...');

    try {
        const newRoomRef = push(child(ref(db), 'rooms'));
        const roomId = newRoomRef.key;

        const roomData = {
            meta: {
                name: escapeHtml(name),
                privateKey: key, 
                adminUid: currentUser.uid,
                adminName: currentUser.username,
                icon: selectedIcon,
                createdAt: Date.now()
            },
            members: {}
        };

        // 1. Create Room
        await set(newRoomRef, roomData);

        // 2. Link to User
        await update(ref(db, `users/${currentUser.uid}/joinedRooms`), {
            [roomId]: true
        });
        
        // 3. Update Local User State
        if (!currentUser.joinedRooms) currentUser.joinedRooms = {};
        currentUser.joinedRooms[roomId] = true;

        el.createModal.style.display = 'none';
        showScreen('dashboard');

    } catch (e) {
        alert(e.message);
    } finally {
        setLoading(false);
    }
}

async function joinRoomFromDash() {
    const name = document.getElementById('dashJoinName').value.trim();
    const key = document.getElementById('dashJoinKey').value.trim();

    if (!name || !key) return;
    setLoading(true, 'Finding Room...');

    try {
        const snap = await get(ref(db, 'rooms'));
        let targetId = null;

        if(snap.exists()) {
            snap.forEach(child => {
                const r = child.val();
                if (r.meta && r.meta.name === name && r.meta.privateKey === key) {
                    targetId = child.key;
                }
            });
        }

        if (targetId) {
            await update(ref(db, `users/${currentUser.uid}/joinedRooms`), {
                [targetId]: true
            });
            if (!currentUser.joinedRooms) currentUser.joinedRooms = {};
            currentUser.joinedRooms[targetId] = true;
            
            showScreen('dashboard'); 
        } else {
            alert('Room not found or incorrect password');
        }
    } catch (e) {
        console.error(e);
        alert("Error joining room.");
    } finally {
        setLoading(false);
    }
}

async function enterRoom(roomId, meta) {
    setLoading(true, 'Entering...');
    currentRoomId = roomId;
    currentRoomName = meta.name;
    currentRoomKey = meta.privateKey;
    
    // Update header
    el.headerRoomName.textContent = currentRoomName;
    document.getElementById('headerRoomIcon').src = meta.icon;
    document.getElementById('headerRoomIcon').style.display = 'block';
    
    // Set Sidebar Info
    document.getElementById('sidebarRoomNameDisplay').textContent = currentRoomName;
    document.getElementById('sidebarRoomIcon').src = meta.icon;

    // Setup Listeners
    setupRoomListeners(roomId);
    
    // Set Presence
    setPresence(roomId);

    showScreen('chat');
    setLoading(false);
}

// --- CHAT & PRESENCE ---
function setupRoomListeners(roomId) {
    // 1. Messages
    const msgRef = child(ref(db), `rooms/${roomId}/messages`);
    // Clear old listeners if any? (Simple app fallback: reload cleans up)
    
    // Clear UI
    el.messages.innerHTML = '';
    
    onChildAdded(msgRef, (snap) => {
        renderMessage(snap.val());
        el.messages.scrollTop = el.messages.scrollHeight;
    });

    // 2. Members
    const memRef = child(ref(db), `rooms/${roomId}/members`);
    onValue(memRef, (snap) => {
        renderMemberList(snap.val());
    });
}

function setPresence(roomId) {
    const userRef = ref(db, `rooms/${roomId}/members/${currentUser.uid}`);
    const presenceData = {
        username: currentUser.username,
        avatar: currentUser.avatar,
        status: 'online',
        lastSeen: Date.now()
    };
    
    set(userRef, presenceData);
    onDisconnect(userRef).remove(); // Auto remove
}

function renderMemberList(members) {
    el.memberList.innerHTML = '';
    if (!members) return;

    Object.entries(members).forEach(([uid, m]) => {
        const div = document.createElement('div');
        div.className = 'member-item';
        div.innerHTML = `
            <div class="member-avatar-wrapper">
                <img src="${m.avatar}" class="member-avatar">
                <div class="status-dot ${m.status}"></div>
            </div>
            <span style="font-size:14px; font-weight:600;">${escapeHtml(m.username)}</span>
        `;
        el.memberList.appendChild(div);
    });
}

function sendMessage() {
    const text = el.msgInput.value.trim();
    if (!text) return;

    const msgData = {
        user: currentUser.username,
        uid: currentUser.uid,
        avatar: currentUser.avatar,
        text: escapeHtml(text),
        timestamp: Date.now(),
        type: 'text'
    };

    if (replyTarget) {
        msgData.replyTo = replyTarget;
    }

    push(child(ref(db), `rooms/${currentRoomId}/messages`), msgData);
    el.msgInput.value = '';
    closeReply();
}

function renderMessage(msg) {
    const isMe = msg.uid === currentUser.uid;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    
    let content = '';

    // Reply Block
    if (msg.replyTo) {
        content += `
            <div class="reply-quote">
                <strong>${escapeHtml(msg.replyTo.name)}</strong>
                ${escapeHtml(msg.replyTo.text)}
            </div>
        `;
    }

    if (!isMe) {
        content += `<div class="msg-meta">
            <img class="msg-avatar" src="${msg.avatar}">
            <span class="msg-name">${escapeHtml(msg.user)}</span>
        </div>`;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    content += `
        ${msg.text}
        <span class="msg-time">${time}</span>
    `;

    div.innerHTML = content;
    div.ondblclick = () => setReply({ id: msg.uid, name: msg.user, text: msg.text });

    el.messages.appendChild(div);
}


// --- UTILITIES ---
function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Resize to 100px width
                const maxWidth = 150;
                const scaleSize = maxWidth / img.width;
                canvas.width = maxWidth;
                canvas.height = img.height * scaleSize;

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                // Compress
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = (e) => reject(e);
        };
        reader.onerror = (e) => reject(e);
    });
}

function setLoading(active, text = 'Loading...') {
    if(el.loading) {
        el.loading.style.display = active ? 'flex' : 'none';
        el.loading.querySelector('.loading-text').textContent = text;
    }
}

function showError(msg, container) {
    if (container) {
        container.textContent = msg;
        setTimeout(() => container.textContent = '', 3000);
    } else {
        alert(msg);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function toggleDarkMode(forceState) {
    isDark = typeof forceState === 'boolean' ? forceState : !isDark;
    document.body.classList.toggle('dark-mode', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    const btnIcon = document.querySelector('#btnDarkMode i');
    if (btnIcon) btnIcon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

function setupEventListeners() {
    // Auth Tabs
    if(el.tabLogin) {
        el.tabLogin.onclick = () => {
            el.tabLogin.classList.add('active'); el.tabRegister.classList.remove('active');
            el.formLogin.style.display = 'block'; el.formRegister.style.display = 'none';
        };
    }
    if(el.tabRegister) {
        el.tabRegister.onclick = () => {
            el.tabRegister.classList.add('active'); el.tabLogin.classList.remove('active');
            el.formRegister.style.display = 'block'; el.formLogin.style.display = 'none';
        };
    }

    // Forms
    const btnReg = document.getElementById('btnSubmitRegister');
    if(btnReg) btnReg.onclick = registerUser;

    const btnLog = document.getElementById('btnSubmitLogin');
    if(btnLog) btnLog.onclick = () => loginUser();

    if(el.regAvatarPreview) el.regAvatarPreview.onclick = () => el.regAvatarInput.click();
    if(el.regAvatarInput) el.regAvatarInput.onchange = async (e) => {
        if (e.target.files[0]) {
            const base64 = await compressImage(e.target.files[0]);
            el.regAvatarPreview.innerHTML = `<img src="${base64}">`;
        }
    };

    // Dashboard
    document.getElementById('btnDashLogout').onclick = logout;
    document.getElementById('btnOpenCreateRoom').onclick = () => {
        el.createModal.style.display = 'flex';
        // Init avatars for room creation
        const grid = document.getElementById('createRoomAvatarGrid');
        grid.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const seed = `room${i}`;
            const img = document.createElement('img');
            img.src = `https://api.dicebear.com/7.x/shapes/svg?seed=${seed}`;
            img.className = 'avatar-option';
            img.onclick = () => {
                document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
                img.classList.add('selected');
            };
            grid.appendChild(img);
        }
    };
    document.getElementById('btnConfirmCreate').onclick = createRoom;
    document.getElementById('btnCloseCreate').onclick = () => el.createModal.style.display = 'none';
    document.getElementById('btnDashJoin').onclick = joinRoomFromDash;

    // Chat
    document.getElementById('btnSend').onclick = sendMessage;
    el.msgInput.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };
    document.getElementById('btnMobileMenu').onclick = () => {
        el.sidebar.classList.add('active');
        if(el.sidebarOverlay) el.sidebarOverlay.style.display = 'block';
    };
    if(el.sidebarOverlay) {
        el.sidebarOverlay.onclick = () => {
            el.sidebar.classList.remove('active');
            el.sidebarOverlay.style.display = 'none';
        };
    }
    document.getElementById('btnDarkMode').onclick = () => toggleDarkMode();
    document.getElementById('btnCloseReply').onclick = closeReply;
    
    // Emoji Init (only if container exists)
    const emojiContainer = document.getElementById('emojiPickerContainer');
    if(emojiContainer) {
        const picker = createPicker({ rootElement: emojiContainer });
        picker.addEventListener('emoji:select', (selection) => {
            el.msgInput.value += selection.emoji;
            emojiContainer.style.display = 'none';
        });
        document.getElementById('btnEmoji').onclick = () => {
            emojiContainer.style.display = emojiContainer.style.display === 'block' ? 'none' : 'block';
        };
    }
}

// Reply Helpers
function setReply(target) {
    replyTarget = target;
    document.getElementById('replyTarget').textContent = target.name;
    document.getElementById('replyContent').textContent = target.text;
    document.getElementById('replyPreview').style.display = 'flex';
    el.msgInput.focus();
}
function closeReply() {
    replyTarget = null;
    document.getElementById('replyPreview').style.display = 'none';
}

window.onload = init;
