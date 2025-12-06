import { db, ref, set, get, remove, child } from './firebase-config.js';

// --- AUTH LOGIC ---
const SYSTEM_REF = ref(db, 'system/adminKey');

window.initAdmin = async function() {
    // 1. Check if key exists in DB, if not set default 'admin123'
    try {
        const snap = await get(SYSTEM_REF);
        if(!snap.exists()) {
            await set(SYSTEM_REF, 'admin123');
            console.log("System initialized with default key.");
        }
    } catch(e) { console.error("Init check failed", e); }
}

document.getElementById('btnLogin').addEventListener('click', async () => {
    const input = document.getElementById('adminKey').value;
    const btn = document.getElementById('btnLogin');
    
    if(!input) return alert("Please enter a key.");
    
    btn.innerText = "Verifying...";
    try {
        const snap = await get(SYSTEM_REF);
        const realKey = snap.exists() ? snap.val() : 'admin123'; // Fallback if DB empty
        
        if(input === realKey) {
            document.getElementById('loginOverlay').style.display = 'none';
            loadData();
        } else {
            alert("Access Denied: Invalid Key");
        }
    } catch(e) {
        alert("System Error: " + e.message + "\nCheck your internet connection.");
        console.error(e);
    }
    btn.innerText = "Unlock Dashboard";
});

// --- DATA ---
async function loadData() {
    const listRecent = document.getElementById('recentList');
    const listFull = document.getElementById('roomListFull');
    
    try {
        const snap = await get(ref(db, 'rooms'));
        const rooms = snap.exists() ? snap.val() : {};
        
        // 1. Calculate Stats
        const roomCount = Object.keys(rooms).length;
        let msgCount = 0;
        let userCount = 0;
        
        // 2. Render Lists
        let html = '';
        Object.entries(rooms).forEach(([id, data]) => {
            const mC = data.messages ? Object.keys(data.messages).length : 0;
            const uC = data.members ? Object.keys(data.members).length : 0;
            msgCount += mC;
            userCount += uC;
            
            html += `
                <div class="room-row">
                    <div class="room-info">
                        <h4>${id}</h4>
                        <p>Users: ${uC} | Msgs: ${mC} | Admin: ${data.adminName || '?'}</p>
                    </div>
                    <div class="actions">
                        <button class="btn-delete" onclick="window.nukeRoom('${id}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `;
        });
        
        listRecent.innerHTML = html || '<p style="text-align:center; padding:20px; color:#aaa;">No data found.</p>';
        listFull.innerHTML = html || '<p style="text-align:center; padding:20px; color:#aaa;">No data found.</p>';
        
        document.getElementById('statRooms').innerText = roomCount;
        document.getElementById('statMessages').innerText = msgCount;
        document.getElementById('statUsers').innerText = userCount;
        
    } catch(e) { console.error(e); }
}

window.nukeRoom = async function(id) {
    if(confirm(`PERMANENTLY DELETE room '${id}'?`)) {
        await remove(ref(db, `rooms/${id}`));
        loadData();
    }
}

window.refreshData = loadData;

// --- SETTINGS ---
document.getElementById('btnUpdateSecurity').addEventListener('click', async () => {
    const newKey = document.getElementById('newAdminKey').value.trim();
    if(!newKey || newKey.length < 4) return alert("Key must be 4+ chars");
    
    if(confirm("Change Super Admin Password?")) {
        await set(SYSTEM_REF, newKey);
        alert("Success! Please re-login.");
        location.reload();
    }
});

// Run Init
window.initAdmin();
