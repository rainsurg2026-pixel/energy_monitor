import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithRedirect,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  signOut,
  getRedirectResult
} from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const provider = new GoogleAuthProvider();
// Request Google Sheets scopes
provider.addScope("https://www.googleapis.com/auth/spreadsheets");

// Flag to indicate if we are in the middle of a sign-in flow.
let isSigningIn = false;
// Cache the access token in memory.
let cachedAccessToken: string | null = null;

// Initialize auth state listener. Call this on app load.
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Handle redirect result first
  getRedirectResult(auth).then(async (result) => {
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
        const expiresAt = Date.now() + 3300 * 1000; // 55 minutes
        localStorage.setItem("google_oauth_access_token", cachedAccessToken);
        localStorage.setItem("google_oauth_token_expires_at", String(expiresAt));
        if (onAuthSuccess) onAuthSuccess(result.user, cachedAccessToken);
      } else {
        console.error("Failed to get access token from Google Auth redirect result.");
        if (onAuthFailure) onAuthFailure();
      }
    }
  }).catch((error) => {
    console.error("Error during redirect result processing:", error);
    if (onAuthFailure) onAuthFailure();
  });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // 1. Check memory cache first
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
        return;
      }

      // 2. Try to recover access token from localStorage if valid
      const storedToken = localStorage.getItem("google_oauth_access_token");
      const expiresAtStr = localStorage.getItem("google_oauth_token_expires_at");
      const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;

      if (storedToken && expiresAt > Date.now()) {
        cachedAccessToken = storedToken;
        if (onAuthSuccess) onAuthSuccess(user, storedToken);
      } else {
        // Token is missing or expired in localStorage, clean up
        localStorage.removeItem("google_oauth_access_token");
        localStorage.removeItem("google_oauth_token_expires_at");
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      localStorage.removeItem("google_oauth_access_token");
      localStorage.removeItem("google_oauth_token_expires_at");
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Must be called from a button click or user interaction
export const googleSignIn = async (): Promise<void> => {
  try {
    isSigningIn = true;
    // Force popup for local dev/iframe environments if redirect fails
    await signInWithPopup(auth, provider);
  } catch (error: any) {
    console.error("Popup failed, trying redirect:", error);
    await signInWithRedirect(auth, provider);
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  // If memory cache is empty, try to retrieve from localStorage if still valid
  if (!cachedAccessToken) {
    const storedToken = localStorage.getItem("google_oauth_access_token");
    const expiresAtStr = localStorage.getItem("google_oauth_token_expires_at");
    const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;
    if (storedToken && expiresAt > Date.now()) {
      cachedAccessToken = storedToken;
    }
  }
  return cachedAccessToken;
};

export const logout = async () => {
  await signOut(auth);
  cachedAccessToken = null;
  localStorage.removeItem("google_oauth_access_token");
  localStorage.removeItem("google_oauth_token_expires_at");
};
