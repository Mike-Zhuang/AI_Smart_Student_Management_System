import type { User } from "./types";

const TOKEN_KEY = "ms_token";
const USER_KEY = "ms_user";
const API_KEY = "ms_zhipu_api_key";

export const storage = {
  getToken: (): string | null => sessionStorage.getItem(TOKEN_KEY),
  setToken: (value: string): void => sessionStorage.setItem(TOKEN_KEY, value),
  removeToken: (): void => sessionStorage.removeItem(TOKEN_KEY),

  getUser: (): User | null => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  },
  setUser: (value: User): void => localStorage.setItem(USER_KEY, JSON.stringify(value)),
  removeUser: (): void => localStorage.removeItem(USER_KEY),

  getApiKey: (): string => localStorage.getItem(API_KEY) ?? "",
  setApiKey: (value: string): void => localStorage.setItem(API_KEY, value),
  removeApiKey: (): void => localStorage.removeItem(API_KEY),

  clearAuth: (): void => {
    storage.removeToken();
    storage.removeUser();
  }
};
