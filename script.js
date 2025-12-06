import { db, ref, set, push, onChildAdded, get, remove, child, onDisconnect, onValue, update } from './firebase-config.js';

// --- UTILS ---
function generateId() { return Math.random().toString(36).substr(2,9); }
function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;")
               .replace(/'/g, "&#039;");
}

// --- STATE ---
const state = {
    user: { name: "", avatar: "", id: localStorage.getItem('chat_uid') || generateId() },
    room: { id: "", name: "", avatar: "" },
    selectedLoginAvatar: "",
    selectedCreateUserAvatar: "",
    selectedCreateRoomAvatar: "",
    isTyping: false,
    inputTimeout: null,
    darkMode: localStorage.getItem('darkMode') === 'true'
};

// Ensure ID persistence
if(!localStorage.getItem('chat_uid')) localStorage.setItem('chat_uid', state.user.id);

// --- AVATARS ---
const userSeeds = ["Felix", "Aneka", "Zack", "Molly", "Sam", "Bear", "Leo", "Bella", "Willow", "Max"];
const roomSeeds = ["Shape", "Polygon", "Star", "Circle", "Square", "Diamond", "Triangle", "Hexagon"];
const getUserAvatar = (seed) => `https://api.dicebear.com/7.x/open-peeps/svg?seed=${seed}&bg=e7f3ff`;
const getRoomAvatar = (seed) => `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;

// Map defaults
state.selectedLoginAvatar = getUserAvatar(userSeeds[0]);
state.selectedCreateUserAvatar = getUserAvatar(userSeeds[0]);
state.selectedCreateRoomAvatar = getRoomAvatar(roomSeeds[0]);

// --- DOM ELEMENTS (Populated in init) ---
const el = {};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', init);

function init() {
    // --- 1. VIEWPORT FIX (FOR REDMI/ANDROID) ---
    // Sets a CSS variable --app-height to the actual visible height (minus keyboard)
    const setHeight = () => {
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${vh}px`);
    };
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', setHeight);
        window.visualViewport.addEventListener('scroll', setHeight);
    }
    window.addEventListener('resize', setHeight);
    setHeight(); // Initial set

    // Populate Elements Safely
    const ids = [
        'loginScreen', 'createModal', 'app', 
        'sidebar', 'messages', 'memberList', 'sidebarOverlay',
        'joinUser', 'joinRoom', 'joinKey', 'createUser', 'createRoom', 'createKey', 'msgInput',
        'btnLogin', 'btnOpenCreate', 'btnCloseModal', 'btnSignUp', 'btnSend', 'btnLogout', 
        'btnMobileMenu', 'btnDarkMode', 'btnEmoji',
        'headerRoomName', 'headerRoomIcon', 'sidebarRoomNameDisplay', 'sidebarRoomIcon', 
        'typingIndicator', 'emojiPickerContainer', 'loadingOverlay', 'errorToast',
        'loginAvatarGrid', 'createRoomAvatarGrid', 'createUserAvatarGrid'
    ];
    
    ids.forEach(id => {
        el[id] = document.getElementById(id);
    });

    // Render Grids
    if(el.loginAvatarGrid) renderUserGrid(el.loginAvatarGrid, 'login');
    if(el.createUserAvatarGrid) renderUserGrid(el.createUserAvatarGrid, 'createUser');
    if(el.createRoomAvatarGrid) renderRoomGrid(el.createRoomAvatarGrid);
    
    // Dark Mode
    if (state.darkMode) document.body.classList.add('dark-mode');

    // Setup Events
    setupEvents();
}

function setupEvents() {
    if(el.btnOpenCreate) el.btnOpenCreate.addEventListener('click', () => el.createModal.style.display = 'flex');
    if(el.btnCloseModal) el.btnCloseModal.addEventListener('click', () => el.createModal.style.display = 'none');
    if(el.btnLogin) el.btnLogin.addEventListener('click', attemptJoin);
    if(el.btnSignUp) el.btnSignUp.addEventListener('click', attemptCreate);
    if(el.btnSend) el.btnSend.addEventListener('click', sendMessage);
    if(el.btnLogout) el.btnLogout.addEventListener('click', () => location.reload());
    
    if(el.msgInput) {
        el.msgInput.addEventListener('keypress', (e) => { 
            handleTyping();
            if(e.key === 'Enter') sendMessage(); 
        });
    }

    // Sidebar Mobile Logic
    const toggleSidebar = () => {
        el.sidebar.classList.toggle('active');
        if(el.sidebarOverlay) el.sidebarOverlay.style.display = el.sidebar.classList.contains('active') ? 'block' : 'none';
        
        // Hide emoji picker if open
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

    // Emoji Picker
    let picker;
    if(el.btnEmoji) {
        el.btnEmoji.addEventListener('click', (e) => {
            e.stopPropagation();
            if(!picker && el.emojiPickerContainer) {
                picker = picmo.createPicker({ 
                    rootElement: el.emojiPickerContainer,
                    itemsPerRow: 8,
                    showRecents: false
                });
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
    
    // Close emoji picker on outside click
    document.addEventListener('click', (e) => {
        if(el.emojiPickerContainer && 
           !el.emojiPickerContainer.contains(e.target) && 
           e.target !== el.btnEmoji) {
            el.emojiPickerContainer.style.display = 'none';
        }
    });
}

// --- UI HELPER ---
function setLoading(isLoading, text="Connecting...") {
    if(!el.loadingOverlay) return;
    if(isLoading) {
        el.loadingOverlay.querySelector('.loading-text').textContent = text;
        el.loadingOverlay.style.display = 'flex';
    } else {
        el.loadingOverlay.style.display = 'none';
    }
}

function renderUserGrid(container, context) {
    container.innerHTML = '';
    userSeeds.forEach((seed, i) => {
        const url = getUserAvatar(seed);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'avatar-option';
        if (i === 0) img.classList.add('selected');
        
        img.onclick = () => {
            container.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
            img.classList.add('selected');
            if(context === 'login') state.selectedLoginAvatar = url;
            else state.selectedCreateUserAvatar = url;
        };
        container.appendChild(img);
    });
}

function renderRoomGrid(container) {
    container.innerHTML = '';
    roomSeeds.forEach((seed, i) => {
        const url = getRoomAvatar(seed);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'avatar-option';
        if (i === 0) img.classList.add('selected');
        
        img.onclick = () => {
            container.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
            img.classList.add('selected');
            state.selectedCreateRoomAvatar = url;
        };
        container.appendChild(img);
    });
}

function sanitizeRoom(name) { return name.replace(/[.#$\[\]]/g, "_"); }

function showError(msg) {
    const toast = document.getElementById('errorToast');
    if(toast) {
        toast.innerText = msg; toast.style.display = 'block';
        setTimeout(() => toast.style.display = 'none', 3000);
    } else {
        alert(msg);
    }
}

// --- FIREBASE ACTIONS ---

async function attemptCreate() {
    const user = el.createUser.value.trim();
    const roomName = el.createRoom.value.trim();
    const key = el.createKey.value.trim();
    if(!user || !roomName || !key) return showError("Fill all fields");

    setLoading(true, "Creating Safe Space...");
    const roomId = sanitizeRoom(roomName);
    const roomRef = ref(db, `rooms/${roomId}`);
    
    try {
        const snap = await get(roomRef);
        if(snap.exists()) {
            setLoading(false);
            return showError("Room Name Taken!");
        }

        await set(roomRef, { 
            password: key, 
            admin: user,
            avatar: state.selectedCreateRoomAvatar,
            createdAt: Date.now()
        });
        
        el.createModal.style.display = 'none';
        state.user.name = user;
        state.user.avatar = state.selectedCreateUserAvatar;
        
        enterApp(roomId, roomName, state.selectedCreateRoomAvatar);
    } catch(e) { 
        console.error(e); 
        setLoading(false);
        showError("Invalid Room Name. Try another."); 
    }
}

async function attemptJoin() {
    const user = el.joinUser.value.trim();
    const roomName = el.joinRoom.value.trim();
    const key = el.joinKey.value.trim();
    if(!user || !roomName || !key) return showError("Fill all fields");

    setLoading(true, "Authenticating...");
    const roomId = sanitizeRoom(roomName);
    try {
        const snap = await get(ref(db, `rooms/${roomId}`));
        if(!snap.exists()) {
            setLoading(false);
            return showError("Room not found");
        }
        
        const data = snap.val();
        if(data.password !== key) {
            setLoading(false);
            return showError("Wrong Password");
        }

        state.user.name = user;
        state.user.avatar = state.selectedLoginAvatar;
        enterApp(roomId, roomName, data.avatar || getRoomAvatar('default'));
    } catch(e) { 
        console.error(e); 
        setLoading(false);
        showError("Check internet connection"); 
    }
}

function enterApp(roomId, roomName, roomAvatar) {
    state.room.id = roomId;
    state.room.name = roomName;
    state.room.avatar = roomAvatar;
    
    // Header UI
    if(el.headerRoomName) el.headerRoomName.textContent = roomName;
    if(el.headerRoomIcon) {
        el.headerRoomIcon.src = roomAvatar;
        el.headerRoomIcon.style.display = 'block';
    }

    // Sidebar UI
    if(el.sidebarRoomName) el.sidebarRoomName.textContent = roomName;
    if(el.sidebarRoomIcon) el.sidebarRoomIcon.src = roomAvatar;

    el.loginScreen.style.display = 'none';
    el.app.classList.add('visible');

    // PRESENCE SYSTEM
    const myStatusRef = ref(db, `rooms/${roomId}/members/${state.user.id}`);
    set(myStatusRef, {
        name: state.user.name,
        avatar: state.user.avatar,
        status: 'online',
        lastSeen: Date.now()
    }).catch(e => console.error("Presence Error", e));
    
    onDisconnect(myStatusRef).update({ status: 'offline', lastSeen: Date.now() });

    setupListeners(roomId);
    setLoading(false);
}

function setupListeners(roomId) {
    // We only attach once, so this simple check prevents duplicates if re-called
    if(state.listening) return;
    state.listening = true;

    onChildAdded(ref(db, `rooms/${roomId}/messages`), snap => renderMessage(snap.val()));
    onValue(ref(db, `rooms/${roomId}/members`), snap => renderMembers(snap.val()));
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

function renderMembers(members) {
    if(!el.memberList) return;
    el.memberList.innerHTML = '';
    let typingUsers = [];

    if(!members) return;

    Object.entries(members).forEach(([uid, data]) => {
        if(data.typing && uid !== state.user.id) typingUsers.push(escapeHtml(data.name));

        const div = document.createElement('div');
        div.className = 'member-item';
        
        const safeName = escapeHtml(data.name);
        const safeAvatar = data.avatar || getUserAvatar('unknown'); 
        const isMe = uid === state.user.id ? '(You)' : '';
        
        div.innerHTML = `
            <div class="member-avatar-wrapper">
                <img src="${safeAvatar}" class="member-avatar">
                <div class="status-dot ${data.status}"></div>
            </div>
            <span>${safeName} ${isMe}</span>
        `;
        el.memberList.appendChild(div);
    });

    if(el.typingIndicator) {
        if(typingUsers.length > 0) {
            el.typingIndicator.textContent = `${typingUsers.join(', ')} is typing...`;
            el.typingIndicator.style.opacity = '1';
        } else {
            el.typingIndicator.style.opacity = '0';
        }
    }
}

function sendMessage() {
    const text = el.msgInput.value.trim();
    if(!text) return;

    push(ref(db, `rooms/${state.room.id}/messages`), {
        user: state.user.name,
        avatar: state.user.avatar,
        text: text, 
        time: Date.now()
    }).catch(e => showError("Failed to send"));
    
    el.msgInput.value = '';
    el.msgInput.focus();
}

function renderMessage(msg) {
    if(!msg || !msg.text) return;
    const isMe = msg.user === state.user.name;
    const div = document.createElement('div');
    div.className = `message ${isMe ? 'sent' : 'received'}`;
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const safeUser = escapeHtml(msg.user);
    const safeText = escapeHtml(msg.text);
    const safeAvatar = msg.avatar; 

    div.innerHTML = `
        ${!isMe ? `<div class="msg-meta"><img src="${safeAvatar}" class="msg-avatar"><span class="msg-name">${safeUser}</span></div>` : ''}
        <div>${safeText}</div>
        <div class="msg-time">${time}</div>
    `;

    el.messages.appendChild(div);
    el.messages.scrollTop = el.messages.scrollHeight;
}
