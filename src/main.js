import App from './App.svelte';

const app = new App({
	target: document.body
});

export default app;

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA7BbsXLj7H361ufJpsBAhhjV-BnsSaac8",
  authDomain: "gcode-temp-tweaker.firebaseapp.com",
  projectId: "gcode-temp-tweaker",
  storageBucket: "gcode-temp-tweaker.appspot.com",
  messagingSenderId: "665589933096",
  appId: "1:665589933096:web:13a8c083f2b2af4224011d",
  measurementId: "G-E3BTLJ4DC4"
};

// Initialize Firebase
if (document.location.hostname.indexOf('localhost') == -1 ) {
	const fapp = initializeApp(firebaseConfig);
	const analytics = getAnalytics(fapp);
}