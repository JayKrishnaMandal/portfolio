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
    roomSettingsModal: document.getElementById('roomSettingsModal'),
    userSettingsModal: document.getElementById('userSettingsModal'),
    loading: document.getElementById('loadingOverlay')
};

// ... (Init/ShowScreen/Auth functions remain same) ...

// --- USER PROFILE SETTINGS ---
function openUserProfile() {
    if(!currentUser) return;
    
    document.getElementById('editUserName').value = currentUser.username;
    document.getElementById('editUserAvatarImg').src = currentUser.avatar;
    document.getElementById('editUserPass').value = '';
    
    el.userSettingsModal.style.display = 'flex';
}

async function saveUserProfile() {
    if(!currentUser) return;
    
    const newName = document.getElementById('editUserName').value.trim();
    const newPass = document.getElementById('editUserPass').value.trim();
    const avatarImg = document.getElementById('editUserAvatarImg');
    const isNewAvatar = avatarImg.dataset.new === "true";
    
    if(newName.length < 2) return alert("Name too short");
    
    setLoading(true, "Updating Profile...");
    
    try {
        const updates = {};
        
        // 1. Update Name
        if(newName !== currentUser.username) {
            updates['username'] = escapeHtml(newName);
            currentUser.username = updates['username']; // Local update
        }
        
        // 2. Update Password
        if(newPass.length > 0) {
            if(newPass.length < 6) throw new Error("Password must be 6+ chars");
            updates['password'] = btoa(newPass);
        }
        
        // 3. Update Avatar
        if(isNewAvatar) {
            updates['avatar'] = avatarImg.src;
            currentUser.avatar = avatarImg.src; // Local update
        }
        
        if(Object.keys(updates).length > 0) {
            await update(ref(db, `users/${currentUser.uid}`), updates);
            
            // Update UI
            el.dashUserName.textContent = currentUser.username;
            el.dashUserAvatar.src = currentUser.avatar;
            saveSession(currentUser, currentUser.autoLogout === true); // Update storage
            
            alert("Profile Updated!");
            el.userSettingsModal.style.display = 'none';
        } else {
            el.userSettingsModal.style.display = 'none';
        }
        
    } catch(e) {
        alert("Error: " + e.message);
    } finally {
        setLoading(false);
    }
}

// --- ROOM SETTINGS ---
async function openRoomSettings() {
    if(!currentRoomId) return;
    
    // Fetch fresh meta
    const snap = await get(ref(db, `rooms/${currentRoomId}/meta`));
    if(snap.exists()) {
        const meta = snap.val();
        document.getElementById('editRoomName').value = meta.name;
        document.getElementById('editRoomKey').value = meta.privateKey;
        el.roomSettingsModal.style.display = 'flex';
    }
}

async function saveRoomSettings() {
    if(!currentRoomId) return;
    
    const newName = document.getElementById('editRoomName').value.trim();
    const newKey = document.getElementById('editRoomKey').value.trim();
    
    if(!newName || !newKey) return alert("Fields cannot be empty");
    
    setLoading(true, "Updating Room...");
    
    try {
        await update(ref(db, `rooms/${currentRoomId}/meta`), {
            name: escapeHtml(newName),
            privateKey: newKey // In real app, re-auth or check admin logic here?
            // Note: Currently client-side we check btn visibility, security rules should enforce adminUid
        });
        
        // Local Update
        currentRoomName = newName;
        el.headerRoomName.textContent = newName;
        
        alert("Room Updated!");
        el.roomSettingsModal.style.display = 'none';
    } catch(e) {
        alert("Update failed: " + e.message);
    } finally {
        setLoading(false);
    }
}


// --- ROOM LOGIC ---
async function createRoom() {
    const name = document.getElementById('newRoomName').value.trim();
    const key = document.getElementById('newRoomKey').value.trim();
    
    // Determine Icon: Check if custom upload exists (img tag inside preview)
    const customImg = document.querySelector('#roomIconPreview img')?.src;
    const presetImg = document.querySelector('.small-grid .selected')?.src;
    
    const finalIcon = customImg || presetImg || `https://api.dicebear.com/7.x/shapes/svg?seed=${Date.now()}`;

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
                icon: finalIcon,
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

    // Dashboard Profile Edit
    document.getElementById('btnDashSettings').onclick = openUserProfile;
    
    // User Settings Modal
    const editAvatarInput = document.getElementById('editUserAvatarInput');
    const editAvatarPreview = document.getElementById('editUserAvatarImg');
    
    document.getElementById('editUserAvatarPreview').onclick = () => editAvatarInput.click();
    editAvatarInput.onchange = async (e) => {
        if(e.target.files[0]) {
            const base64 = await compressImage(e.target.files[0]);
            editAvatarPreview.src = base64;
            editAvatarPreview.dataset.new = "true"; // Mark as changed
        }
    };
    
    document.getElementById('btnSaveUserProfile').onclick = saveUserProfile;
    document.getElementById('btnCloseUserSettings').onclick = () => el.userSettingsModal.style.display = 'none';

    // Room Settings (Chat) -- Replacing old Admin logic
    document.getElementById('btnSettings').onclick = openRoomSettings;
    document.getElementById('btnSaveRoomSettings').onclick = saveRoomSettings;
    document.getElementById('btnCloseRoomSettings').onclick = () => el.roomSettingsModal.style.display = 'none';

    // ... (Keep existing Create Room logic below) ...
    // Create Room Logic
    const btnOpenCreate = document.getElementById('btnOpenCreateRoom');
    const roomIconPreview = document.getElementById('roomIconPreview');
    const roomIconInput = document.getElementById('roomIconInput');
    const createGrid = document.getElementById('createRoomAvatarGrid');

    btnOpenCreate.onclick = () => {
        el.createModal.style.display = 'flex';
        
        // Reset Inputs
        document.getElementById('newRoomName').value = '';
        document.getElementById('newRoomKey').value = '';
        roomIconInput.value = ''; // Clear file
        roomIconPreview.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
        
        // Init presets
        createGrid.innerHTML = '';
        for (let i = 0; i < 8; i++) {
            const seed = `room${i}`;
            const img = document.createElement('img');
            img.src = `https://api.dicebear.com/7.x/shapes/svg?seed=${seed}`;
            img.className = 'avatar-option';
            img.onclick = () => {
                document.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
                img.classList.add('selected');
                // Clear custom upload preview if preset selected
                roomIconInput.value = '';
                roomIconPreview.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>';
            };
            grid_select_default(img, i); // Helper to select first if needed, but here we prefer no default if custom? 
            // Actually let's select first by default but allow override
            if (i === 0) img.classList.add('selected');
            createGrid.appendChild(img);
        }
    };
    
    // Helper to select default
    function grid_select_default(img, i) {
        if(i===0) img.classList.add('selected');
    }

    // Custom Upload Click
    document.getElementById('roomIconUpload').onclick = () => roomIconInput.click();
    
    // Handle File Change
    roomIconInput.onchange = async (e) => {
        if (e.target.files[0]) {
            // Deselect presets
            document.querySelectorAll('#createRoomAvatarGrid .avatar-option').forEach(a => a.classList.remove('selected'));
            
            const base64 = await compressImage(e.target.files[0]);
            roomIconPreview.innerHTML = `<img src="${base64}">`;
        }
    };

    document.getElementById('btnConfirmCreate').onclick = createRoom;
    document.getElementById('btnCloseCreate').onclick = () => el.createModal.style.display = 'none';
    document.getElementById('btnCancelCreate').onclick = () => el.createModal.style.display = 'none';
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
