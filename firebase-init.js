// firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getDatabase, ref, get, set, push, update, remove, onValue } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBrHx9CocgdmapbOMBWYJVmLSJ_e4mYveI",
    authDomain: "liga-lombarda.firebaseapp.com",
    databaseURL: "https://liga-lombarda-default-rtdb.firebaseio.com",
    projectId: "liga-lombarda",
    storageBucket: "liga-lombarda.firebasestorage.app",
    messagingSenderId: "307688207183",
    appId: "1:307688207183:web:333da62c10793719330b3a",
    measurementId: "G-KM18Y3F21T"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

// Persistencia de sesión
await setPersistence(auth, browserLocalPersistence);

// Exportar todo
export {
    auth,
    database,
    storage,
    ref,
    get,
    set,
    push,
    update,
    remove,
    onValue,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    storageRef,
    uploadString,
    getDownloadURL
};
