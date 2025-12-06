import { db, ref, get, update, remove, child } from "./firebase-config.js";

const el = {
    loginOverlay: document.getElementById('loginOverlay'),
    btnLogin: document.getElementById('btnLogin'),
    adminKey: document.getElementById('adminKey'),
    
    // Stats
    statRooms: document.getElementById('statRooms'),
    statMessages: document.getElementById('statMessages'),
    statUsers: document.getElementById('statUsers'),
    
    // Lists
    recentList: document.getElementById('recentList'),
    roomListFull: document.getElementById('roomListFull'),
    userListFull: document.getElementById('userListFull'),
    
    // Settings
    btnUpdateSecurity: document.getElementById('btnUpdateSecurity'),
    newAdminKey: document.getElementById('newAdminKey')
};

// State
let ADMIN_KEY = "";

// Init
el.btnLogin.addEventListener('click', async () => {
    const key = el.adminKey.value.trim();
    if(!key) return alert("Enter key");

    // Verify Key
    try {
        const snap = await get(ref(db, 'superAdmin'));
        const realKey = snap.exists() ? snap.val().key : "admin123"; // Default fallback
        if(key === realKey) {
            ADMIN_KEY = key;
            el.loginOverlay.style.display = 'none';
            refreshData();
        } else {
            alert("Access Denied");
        }
    } catch(e) {
        alert("Database Error: " + e.message);
    }
});

// Refresh Data
window.refreshData = async () => {
    // Rooms
    const rSnap = await get(ref(db, 'rooms'));
    const rooms = rSnap.val() || {};
    
    // Users
    const uSnap = await get(ref(db, 'users'));
    const users = uSnap.val() || {}; // Only valid if using new V4.0 users path
    
    // Stats
    const roomCount = Object.keys(rooms).length;
    const userCount = Object.keys(users).length;
    let msgCount = 0;
    
    Object.values(rooms).forEach(r => {
        if(r.messages) msgCount += Object.keys(r.messages).length;
    });

    el.statRooms.innerText = roomCount;
    el.statMessages.innerText = msgCount;
    el.statUsers.innerText = userCount;

    renderRooms(rooms);
    renderUsers(users);
};

function renderRooms(rooms) {
    let html = '';
    if(Object.keys(rooms).length === 0) html = '<p style="text-align:center; padding:20px;">No rooms found.</p>';
    
    Object.entries(rooms).forEach(([id, r]) => {
        const name = r.meta ? r.meta.name : "Unknown";
        const adminName = r.meta ? (r.meta.adminName || "Unknown") : "Unknown";
        const msgs = r.messages ? Object.keys(r.messages).length : 0;
        
        html += `
            <div class="room-row">
                <div class="room-info">
                    <h4>${escapeHtml(name)}</h4>
                    <p>Admin: ${escapeHtml(adminName)} • Messages: ${msgs} • ID: ${id}</p>
                </div>
                <div class="actions">
                    <button class="btn-delete" onclick="deleteRoom('${id}')"><i class="fa-solid fa-trash"></i></button>
                    <button class="btn-view" onclick="updateRoomKey('${id}')"><i class="fa-solid fa-key"></i></button>
                </div>
            </div>
        `;
    });
    
    el.roomListFull.innerHTML = html;
    el.recentList.innerHTML = html; // Mirror for dashboard "Recent"
}

function renderUsers(users) {
    let html = '';
    if(Object.keys(users).length === 0) html = '<p style="text-align:center; padding:20px;">No registered users.</p>';
    
    Object.entries(users).forEach(([uid, u]) => {
        html += `
            <div class="room-row">
                <div class="room-info" style="display:flex; align-items:center; gap:10px;">
                    <img src="${u.avatar || ''}" style="width:30px; height:30px; border-radius:50%; background:#eee;">
                    <div>
                        <h4>${escapeHtml(u.username)}</h4>
                        <p>UID: ${uid}</p>
                    </div>
                </div>
                <div class="actions">
                    <button class="btn-delete" onclick="deleteUser('${uid}')"><i class="fa-solid fa-ban"></i></button>
                </div>
            </div>
        `;
    });
    el.userListFull.innerHTML = html;
}

// Global Actions
window.deleteRoom = async (id) => {
    if(confirm("Permanently delete this room?")) {
        await remove(ref(db, `rooms/${id}`));
        refreshData();
    }
};

window.deleteUser = async (uid) => {
    if(confirm("Delete this user? They will lose access.")) {
        await remove(ref(db, `users/${uid}`));
        refreshData();
    }
};

window.updateRoomKey = async (id) => {
    const newKey = prompt("Enter new password for this room:");
    if(newKey) {
        await update(ref(db, `rooms/${id}/meta`), { privateKey: newKey });
        alert("Password updated.");
    }
};

// Settings
el.btnUpdateSecurity.addEventListener('click', async () => {
    const k = el.newAdminKey.value.trim();
    if(k) {
        await update(ref(db, 'superAdmin'), { key: k });
        alert("Super Admin Key Updated");
    }
});

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
