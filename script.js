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
    // Hide all screens using Tailwind's 'hidden' class
    if(el.authScreen) el.authScreen.classList.add('hidden');
    if(el.dashboardScreen) el.dashboardScreen.classList.add('hidden');
    if(el.app) el.app.classList.add('hidden');
    
    // Show the requested screen
    if (screen === 'auth' && el.authScreen) {
        el.authScreen.classList.remove('hidden');
    }
    if (screen === 'dashboard' && el.dashboardScreen) {
        el.dashboardScreen.classList.remove('hidden');
        renderDashboard();
    }
    if (screen === 'chat' && el.app) {
        el.app.classList.remove('hidden');
    }
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

// --- USER PROFILE SETTINGS ---
function openUserProfile() {
    if(!currentUser) return;
    
    document.getElementById('editUserName').value = currentUser.username;
    document.getElementById('editUserAvatarImg').src = currentUser.avatar;
    document.getElementById('editUserPass').value = '';
    
    el.userSettingsModal.classList.add('flex');
    el.userSettingsModal.classList.remove('hidden');
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
            el.userSettingsModal.classList.remove('flex');
            el.userSettingsModal.classList.add('hidden');
        } else {
            el.userSettingsModal.classList.remove('flex');
            el.userSettingsModal.classList.add('hidden');
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
        
        // Attach delete room event listener here (when modal is opened)
        const deleteRoomBtn = document.getElementById('btnDeleteRoom');
        if(deleteRoomBtn) {
            // Remove any existing event listeners by cloning the node
            const newDeleteBtn = deleteRoomBtn.cloneNode(true);
            deleteRoomBtn.parentNode.replaceChild(newDeleteBtn, deleteRoomBtn);
            
            // Attach new event listener
            newDeleteBtn.onclick = deleteRoom;
            console.log('[DELETE ROOM] Delete room button event listener attached');
            
            // Show/hide delete button based on admin status
            if(currentUser.uid === currentRoomAdminUid) {
                newDeleteBtn.style.display = 'block';
                console.log('[DELETE ROOM] User is admin, showing delete button');
            } else {
                newDeleteBtn.style.display = 'none';
                console.log('[DELETE ROOM] User is not admin, hiding delete button');
            }
        } else {
            console.error('[DELETE ROOM] btnDeleteRoom element NOT FOUND in modal');
        }
        
        el.roomSettingsModal.classList.add('flex');
        el.roomSettingsModal.classList.remove('hidden');
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
        el.roomSettingsModal.classList.remove('flex');
        el.roomSettingsModal.classList.add('hidden');
    } catch(e) {
        alert("Update failed: " + e.message);
    } finally {
        setLoading(false);
    }
}

async function deleteRoom() {
    console.log('[DELETE ROOM] Function called');
    console.log('[DELETE ROOM] currentRoomId:', currentRoomId);
    console.log('[DELETE ROOM] currentUser.uid:', currentUser?.uid);
    console.log('[DELETE ROOM] currentRoomAdminUid:', currentRoomAdminUid);
    
    if(!currentRoomId) {
        console.error('[DELETE ROOM] No currentRoomId, aborting');
        return;
    }
    
    // Verify user is admin
    if(currentUser.uid !== currentRoomAdminUid) {
        console.error('[DELETE ROOM] User is not admin. User UID:', currentUser.uid, 'Admin UID:', currentRoomAdminUid);
        alert("Only the room creator can delete this room.");
        return;
    }
    
    console.log('[DELETE ROOM] User verified as admin, showing confirmation');
    if(!confirm("Are you sure you want to permanently delete this room? This action cannot be undone!")) {
        console.log('[DELETE ROOM] User cancelled deletion');
        return;
    }
    
    console.log('[DELETE ROOM] User confirmed deletion, proceeding...');
    setLoading(true, "Deleting Room...");
    
    try {
        console.log('[DELETE ROOM] Removing room from database');
        // Remove room from database
        await remove(ref(db, `rooms/${currentRoomId}`));
        
        console.log('[DELETE ROOM] Removing room from user joinedRooms');
        // Remove room from user's joined rooms
        await remove(ref(db, `users/${currentUser.uid}/joinedRooms/${currentRoomId}`));
        
        // Update local state
        if(currentUser.joinedRooms) {
            delete currentUser.joinedRooms[currentRoomId];
        }
        
        // Close modal
        el.roomSettingsModal.classList.remove('flex');
        el.roomSettingsModal.classList.add('hidden');
        
        // Redirect to dashboard
        currentRoomId = null;
        currentRoomName = null;
        currentRoomKey = null;
        currentRoomAdminUid = null;
        
        console.log('[DELETE ROOM] Room deleted successfully!');
        alert("Room deleted successfully!");
        showScreen('dashboard');
    } catch(e) {
        console.error('[DELETE ROOM] Error:', e);
        alert("Failed to delete room: " + e.message);
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

        el.createModal.classList.remove('flex');
        el.createModal.classList.add('hidden');
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

// --- CHAT & PRESENCE ---
let currentRoomAdminUid = null;

async function enterRoom(roomId, meta) {
    setLoading(true, 'Entering...');
    currentRoomId = roomId;
    currentRoomName = meta.name;
    currentRoomKey = meta.privateKey;
    currentRoomAdminUid = meta.adminUid; // Store admin UID
    
    // Update header
    el.headerRoomName.textContent = currentRoomName;
    document.getElementById('headerRoomIcon').src = meta.icon;
    document.getElementById('headerRoomIcon').style.display = 'block';
    
    // Admin Gear Visibility
    const btnSettings = document.getElementById('btnSettings');
    if(currentUser.uid === meta.adminUid) {
        btnSettings.style.display = 'block';
    } else {
        btnSettings.style.display = 'none';
    }
    
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

function setupRoomListeners(roomId) {
    // 1. Messages
    const msgRef = child(ref(db), `rooms/${roomId}/messages`);
    el.messages.innerHTML = '';
    
    // Check if banned
    onValue(ref(db, `rooms/${roomId}/banned/${currentUser.uid}`), (s) => {
        if(s.exists()) {
            alert("You have been kicked from this room.");
            showScreen('dashboard');
            currentRoomId = null;
        }
    });

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

function renderMemberList(members) {
    el.memberList.innerHTML = '';
    if (!members) return;

    const myUid = currentUser.uid;
    const adminUid = currentRoomAdminUid;

    Object.entries(members).forEach(([uid, m]) => {
        const div = document.createElement('div');
        div.className = 'member-item';
        
        let actionBtn = '';
        if(myUid === adminUid && uid !== myUid) {
            actionBtn = `<i class="fa-solid fa-ban" style="color:#ff4444; margin-left:auto; padding:8px; cursor:pointer;" title="Kick User" onclick="kickMember('${uid}', '${escapeHtml(m.username)}')"></i>`;
        }

        const isRoomAdmin = (uid === adminUid);

        div.innerHTML = `
            <div class="member-avatar-wrapper">
                <img src="${m.avatar}" class="member-avatar">
                <div class="status-dot ${m.status}"></div>
            </div>
            <span style="font-size:14px; font-weight:600;">
                ${escapeHtml(m.username)} 
                ${isRoomAdmin ? '<i class="fa-solid fa-crown" style="color:#ffd700; margin-left:4px; font-size:12px;" title="Room Admin"></i>' : ''}
            </span>
            ${actionBtn}
        `;
        el.memberList.appendChild(div);
    });
}

window.kickMember = async (targetUid, targetName) => {
    if(!confirm(`Kick ${targetName}? They will be banned.`)) return;
    
    try {
        // Add to banned list
        await set(ref(db, `rooms/${currentRoomId}/banned/${targetUid}`), true);
        // Remove from members
        await remove(ref(db, `rooms/${currentRoomId}/members/${targetUid}`));
    } catch(e) {
        alert("Error kicking member: " + e.message);
    }
};

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

// --- SEND MESSAGE ---

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
    
    // Container for the message with proper alignment
    div.className = `flex ${isMe ? 'justify-end' : 'justify-start'} mb-3`;
    
    let content = '';

    if (!isMe) {
        // Received message with avatar
        content += `
            <div class="flex gap-1.5 sm:gap-2 max-w-[85%] sm:max-w-[75%]">
                <img class="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover flex-shrink-0" src="${msg.avatar}" alt="avatar">
                <div class="flex flex-col min-w-0">
                    <span class="text-[11px] sm:text-xs text-text-sub font-semibold mb-1 ml-2 sm:ml-3">${escapeHtml(msg.user)}</span>
                    <div class="bg-white border border-gray-200 text-text-main px-3 py-2 sm:px-4 sm:py-2.5 rounded-[18px] sm:rounded-[20px] rounded-tl-sm shadow-sm text-sm sm:text-base">
        `;
    } else {
        // Sent message (aligned right)
        content += `
            <div class="flex flex-col max-w-[85%] sm:max-w-[75%]">
                <div class="bg-primary text-white px-3 py-2 sm:px-4 sm:py-2.5 rounded-[18px] sm:rounded-[20px] rounded-tr-sm shadow-lg shadow-blue-500/20 text-sm sm:text-base">
        `;
    }

    // Reply quote (if exists)
    if (msg.replyTo) {
        const replyBg = isMe ? 'bg-white/20' : 'bg-gray-100';
        const replyBorder = isMe ? 'border-white/30' : 'border-gray-300';
        content += `
            <div class="${replyBg} border-l-4 ${replyBorder} px-3 py-2 rounded mb-2 text-xs">
                <div class="font-bold opacity-90">${escapeHtml(msg.replyTo.name)}</div>
                <div class="opacity-75">${escapeHtml(msg.replyTo.text)}</div>
            </div>
        `;
    }

    // Message text
    content += `<div class="break-words">${escapeHtml(msg.text)}</div>`;

    // Timestamp
    const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const timeColor = isMe ? 'text-white/70' : 'text-text-sub';
    content += `<div class="text-[10px] ${timeColor} mt-1 text-right">${time}</div>`;

    // Close message bubble
    content += `</div>`;
    
    // Close container
    if (!isMe) {
        content += `</div>`;
    }
    content += `</div>`;

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
    console.log('Setting up event listeners...');
    console.log('tabLogin element:', el.tabLogin);
    console.log('tabRegister element:', el.tabRegister);
    console.log('formLogin element:', el.formLogin);
    console.log('formRegister element:', el.formRegister);
    
    if(el.tabLogin && el.tabRegister && el.formLogin && el.formRegister) {
        el.tabLogin.onclick = () => {
            console.log('Login tab clicked');
            // Style the active tab
            el.tabLogin.classList.add('bg-white', 'text-text-main', 'shadow-sm');
            el.tabLogin.classList.remove('text-text-sub');
            el.tabRegister.classList.remove('bg-white', 'text-text-main', 'shadow-sm');
            el.tabRegister.classList.add('text-text-sub');
            
            // Show/hide forms
            el.formLogin.classList.remove('hidden');
            el.formRegister.classList.add('hidden');
        };
        
        el.tabRegister.onclick = () => {
            console.log('Register tab clicked');
            // Style the active tab
            el.tabRegister.classList.add('bg-white', 'text-text-main', 'shadow-sm');
            el.tabRegister.classList.remove('text-text-sub');
            el.tabLogin.classList.remove('bg-white', 'text-text-main', 'shadow-sm');
            el.tabLogin.classList.add('text-text-sub');
            
            // Show/hide forms
            el.formRegister.classList.remove('hidden');
            el.formLogin.classList.add('hidden');
        };
        console.log('Tab event listeners attached successfully');
    } else {
        console.error('Missing tab elements:', {
            tabLogin: !!el.tabLogin,
            tabRegister: !!el.tabRegister,
            formLogin: !!el.formLogin,
            formRegister: !!el.formRegister
        });
    }

    // Logout Event Listeners - CRITICAL: Add early to ensure execution
    console.log('[LOGOUT] Setting up logout listeners...');
    const btnDashLogout = document.getElementById('btnDashLogout');
    const btnChatLogout = document.getElementById('btnLogout');
    
    if (btnDashLogout) {
        console.log('[LOGOUT] Dashboard logout button FOUND');
        btnDashLogout.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[LOGOUT] Dashboard logout CLICKED!');
            logout();
        };
    } else {
        console.error('[LOGOUT] btnDashLogout NOT FOUND');
    }
    
    if (btnChatLogout) {
        console.log('[LOGOUT] Chat logout button FOUND');
        btnChatLogout.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[LOGOUT] Chat logout CLICKED!');
            logout();
        };
    } else {
        console.error('[LOGOUT] btnLogout NOT FOUND');
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
    document.getElementById('btnCloseUserSettings').onclick = () => { el.userSettingsModal.classList.remove('flex'); el.userSettingsModal.classList.add('hidden'); };

    // Room Settings (Chat) -- Replacing old Admin logic
    document.getElementById('btnSettings').onclick = openRoomSettings;
    document.getElementById('btnSaveRoomSettings').onclick = saveRoomSettings;
    document.getElementById('btnCloseRoomSettings').onclick = () => { el.roomSettingsModal.classList.remove('flex'); el.roomSettingsModal.classList.add('hidden'); };
    
    // Delete Room Button
    const btnDeleteRoom = document.getElementById('btnDeleteRoom');
    if (btnDeleteRoom) {
        btnDeleteRoom.onclick = async () => {
            if (!currentRoomId || !currentUser) {
                alert('No room loaded');
                return;
            }
            
            // Check if user is admin
            const roomRef = ref(db, `rooms/${currentRoomId}/meta/adminUid`);
            const adminSnap = await get(roomRef);
            
            if (adminSnap.val() !== currentUser.uid) {
                alert('Only the room creator can delete the room!');
                return;
            }
            
            const confirmation = confirm(`Are you sure you want to DELETE this room? This cannot be undone!`);
            if (!confirmation) return;
            
            try {
                // Remove room data
                await remove(ref(db, `rooms/${currentRoomId}`));
                
                // Remove from user's joined rooms
                if (currentUser.joinedRooms && currentUser.joinedRooms[currentRoomId]) {
                    delete currentUser.joinedRooms[currentRoomId];
                    await update(ref(db, `users/${currentUser.uid}`), {
                        joinedRooms: currentUser.joinedRooms
                    });
                    saveSession(currentUser, currentUser.autoLogout === true);
                }
                
                alert('Room deleted successfully!');
                el.roomSettingsModal.classList.add('hidden');
                el.roomSettingsModal.classList.remove('flex');
                showScreen('dashboard');
                renderDashboard();
            } catch (error) {
                console.error('Delete room error:', error);
                alert('Failed to delete room: ' + error.message);
            }
        };
    }
    // Note: Delete room button event listener is now attached in openRoomSettings() when modal opens




    // ... (Keep existing Create Room logic below) ...
    // Create Room Logic
    const btnOpenCreate = document.getElementById('btnOpenCreateRoom');
    const roomIconPreview = document.getElementById('roomIconPreview');
    const roomIconInput = document.getElementById('roomIconInput');
    const createGrid = document.getElementById('createRoomAvatarGrid');

    btnOpenCreate.onclick = () => {
        el.createModal.classList.add('flex');
        el.createModal.classList.remove('hidden');
        
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

    // Custom Upload Click (with null check)
    const uploadArea = document.getElementById('roomIconUpload');
    if (uploadArea) {
        uploadArea.onclick = () => roomIconInput.click();
    }
    
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
    document.getElementById('btnCloseCreate').onclick = () => { el.createModal.classList.remove('flex'); el.createModal.classList.add('hidden'); };
    document.getElementById('btnCancelCreate').onclick = () => { el.createModal.classList.remove('flex'); el.createModal.classList.add('hidden'); };
    document.getElementById('btnDashJoin').onclick = joinRoomFromDash;

    // Chat
    document.getElementById('btnSend').onclick = sendMessage;
    el.msgInput.onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };
    
    // Mobile Menu with proper classList
    document.getElementById('btnMobileMenu').onclick = () => {
        el.sidebar.classList.add('active');
        if(el.sidebarOverlay) {
            el.sidebarOverlay.classList.remove('hidden');
            el.sidebarOverlay.classList.add('active');
        }
    };
    if(el.sidebarOverlay) {
        el.sidebarOverlay.onclick = () => {
            el.sidebar.classList.remove('active');
            el.sidebarOverlay.classList.add('hidden');
            el.sidebarOverlay.classList.remove('active');
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
