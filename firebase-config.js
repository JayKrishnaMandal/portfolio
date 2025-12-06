// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, push, onChildAdded, get, remove, child, onDisconnect, onValue, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBI3BhzcivNFMUmrXf4_HvuuH6Q0ycLqUk",
    authDomain: "jkchat-da985.firebaseapp.com",
    databaseURL: "https://jkchat-da985-default-rtdb.firebaseio.com",
    projectId: "jkchat-da985",
    storageBucket: "jkchat-da985.firebasestorage.app",
    messagingSenderId: "701754127862",
    appId: "1:701754127862:web:36147462c3e585377e83d7"
};

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
} catch (e) {
    console.error("Firebase Init Error", e);
}

export { db, ref, set, push, onChildAdded, get, remove, child, onDisconnect, onValue, update };
