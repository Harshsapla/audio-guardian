# Audio Guardian 🎙️🔒

**Audio Guardian** is a full-stack voice safety web application that continuously records audio from the browser, encrypts it in real-time, detects panic words, and automatically manages uploads with auto-delete functionality. It’s designed as a personal safety tool — especially in emergency situations.

## 🚀 Live Demo
🔗 [Try the App](http://harsh-audio-spy.netlify.app)

## 🧩 Key Features
- 🎙️ **Continuous audio recording** in the browser
- 🔐 **AES Encryption** for secure storage of audio chunks
- ☁️ **Real-time chunk upload** to the server with visual feedback
- 📁 **Playback, delete, and file timestamp UI**
- ⚠️ **Panic word detection system**
- 🧼 **Auto-delete feature** (user-defined: X days)
- 🔐 **Firebase authentication** for secure access

## 🛠️ Tech Stack
**Frontend:**
- React
- Tailwind CSS
- CryptoJS (for AES encryption)
- Firebase (Auth)

**Backend:**
- Node.js + Express
- MongoDB (for file metadata + settings)
- Multer (file handling)

## 📂 Project Structure
- `/client`: React frontend
- `/server`: Express + MongoDB backend

## 🧠 Inspiration
This app was inspired by real-world safety concerns, especially for vulnerable individuals who need an automatic, discreet audio monitoring system that respects privacy and security.

## 🧪 How to Run Locally
1. Clone the repo
2. Install frontend & backend dependencies
3. Add your Firebase config
4. Run backend (`npm start`), then frontend (`npm run dev`)

---

🔒 Built with care and safety in mind by [Harsh Yadav](mailto:harshsapla03@gmail.com)
