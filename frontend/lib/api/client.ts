import { ApiError, NetworkError, TimeoutError } from "./errors";

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  token?: string;
  demoUser?: string;
}

const RAW_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

export async function apiClient<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const {
    timeoutMs = 8000,
    token,
    demoUser = "demo-findost-judge",
    headers = {},
    ...customConfig
  } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  const requestHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string>),
  };

  // Auth headers rule: never send both Bearer and X-Demo-User unless explicitly instructed
  if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`;
  } else if (demoUser) {
    requestHeaders["X-Demo-User"] = demoUser;
  }

  // Only set Content-Type if sending a body and it is not FormData
  if (
    customConfig.body &&
    !(customConfig.body instanceof FormData) &&
    !requestHeaders["Content-Type"]
  ) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const url = `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  try {
    const response = await fetch(url, {
      ...customConfig,
      headers: requestHeaders,
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!response.ok) {
      let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try {
        errorBody = await response.json();
      } catch {
        // Not a JSON response
      }

      throw new ApiError(
        response.status,
        errorBody.error?.code || `HTTP_${response.status}`,
        errorBody.error?.message || `Request failed with status ${response.status}`,
        errorBody.error?.details
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    clearTimeout(id);

    if (error instanceof ApiError) {
      throw error;
    }

    if ((error as { name?: string }).name === "AbortError") {
      throw new TimeoutError(`Request to ${endpoint} timed out after ${timeoutMs}ms`);
    }

    throw new NetworkError(
      (error as Error).message || "Unable to reach backend API"
    );
  }
}
