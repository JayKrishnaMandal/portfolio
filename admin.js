import { db, ref, set, get, remove, child } from './firebase-config.js';

// Simple client-side protection (Obscurity, not true security without Auth rules)
// In a real app, you'd use Firebase Auth Claims.
const ACCESS_HASH = "admin123"; // Simple password for demo

window.login = function() {
    const key = document.getElementById('adminKey').value;
    if(key === ACCESS_HASH) {
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
        loadDashboard();
    } else {
        alert("Access Denied");
    }
}

async function loadDashboard() {
    const list = document.getElementById('roomList');
    list.innerHTML = '<div style="padding:20px;">Loading data...</div>';

    try {
        const snap = await get(ref(db, 'rooms'));
        if(!snap.exists()) {
            list.innerHTML = '<div style="padding:20px;">No rooms active.</div>';
            updateStats(0,0,0);
            return;
        }

        const rooms = snap.val();
        let roomCount = 0, msgCount = 0, userCount = 0;
        list.innerHTML = '';

        Object.entries(rooms).forEach(([id, data]) => {
            roomCount++;
            const msgs = data.messages ? Object.keys(data.messages).length : 0;
            const members = data.members ? Object.keys(data.members).length : 0;
            msgCount += msgs;
            userCount += members;

            const date = data.createdAt ? new Date(data.createdAt).toLocaleDateString() : 'Unknown';

            const div = document.createElement('div');
            div.className = 'room-item';
            div.innerHTML = `
                <div class="room-info">
                    <strong>${id}</strong>
                    <div class="room-meta">
                        Created: ${date} • Admin: ${data.adminName || 'Unknown'} <br>
                        ${members} Members • ${msgs} Messages
                    </div>
                </div>
                <div class="actions">
                    <button class="btn-view" onclick="viewRoom('${id}')">Manage</button>
                    <button class="btn-delete" onclick="deleteRoom('${id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            list.appendChild(div);
        });

        updateStats(roomCount, msgCount, userCount);
        
        // Expose viewRoom/deleteRoom to window scope
        window.roomsData = rooms;

    } catch(e) {
        console.error(e);
        list.innerHTML = `<div style="padding:20px; color:red;">Error loading data: ${e.message}</div>`;
    }
}

function updateStats(r, m, u) {
    document.getElementById('statRooms').innerText = r;
    document.getElementById('statMsgs').innerText = m;
    document.getElementById('statUsers').innerText = u;
}

window.deleteRoom = async function(id) {
    if(confirm(`Are you SURE you want to delete room: ${id}? This cannot be undone.`)) {
        await remove(ref(db, `rooms/${id}`));
        loadDashboard();
    }
}

window.viewRoom = function(id) {
    const data = window.roomsData[id];
    if(!data) return;

    document.getElementById('modalTitle').innerText = id;
    const container = document.getElementById('modalMembers');
    container.innerHTML = '';

    const members = data.members || {};
    if(Object.keys(members).length === 0) container.innerHTML = '<p>No active members.</p>';

    Object.entries(members).forEach(([uid, m]) => {
        const row = document.createElement('div');
        row.className = 'member-row';
        row.innerHTML = `
            <span>
                <img src="${m.avatar}" style="width:20px; height:20px; vertical-align:middle; border-radius:50%;">
                ${m.name} ${uid === data.admin ? '👑' : ''}
            </span>
            <button class="btn-delete" onclick="kickUser('${id}', '${uid}')">Kick</button>
        `;
        container.appendChild(row);
    });

    document.getElementById('btnNukeRoom').onclick = () => { window.deleteRoom(id); document.getElementById('detailsModal').style.display='none'; };
    document.getElementById('detailsModal').style.display = 'flex';
}

window.kickUser = async function(roomId, uid) {
    if(confirm("Kick this user?")) {
        await remove(ref(db, `rooms/${roomId}/members/${uid}`));
        await set(ref(db, `rooms/${roomId}/banned/${uid}`), true);
        alert("User kicked.");
        document.getElementById('detailsModal').style.display='none';
        loadDashboard();
    }
}
