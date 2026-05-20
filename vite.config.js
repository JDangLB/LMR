import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Setting the third parameter to '' loads all env variables regardless of prefix.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    base: '/LMR/', 
    // Expose env variables as global constants during compile-time replacement
    define: {
      VITE_FIREBASE_API_KEY: JSON.stringify(env.VITE_FIREBASE_API_KEY || ''),
      VITE_FIREBASE_AUTH_DOMAIN: JSON.stringify(env.VITE_FIREBASE_AUTH_DOMAIN || ''),
      VITE_FIREBASE_PROJECT_ID: JSON.stringify(env.VITE_FIREBASE_PROJECT_ID || ''),
      VITE_FIREBASE_STORAGE_BUCKET: JSON.stringify(env.VITE_FIREBASE_STORAGE_BUCKET || ''),
      VITE_FIREBASE_MESSAGING_SENDER_ID: JSON.stringify(env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''),
      VITE_FIREBASE_APP_ID: JSON.stringify(env.VITE_FIREBASE_APP_ID || ''),
      VITE_APP_ID: JSON.stringify(env.VITE_APP_ID || 'default-local-app-id')
    }
  }
})