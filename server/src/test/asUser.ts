import request from "supertest";
import type { Harness } from "./harness.js";
import { USER_HEADER } from "./harness.js";

/** supertest calls pre-authenticated as one test identity. */
export function asUser(harness: Harness, email: string) {
  return {
    get: (url: string) => request(harness.app).get(url).set(USER_HEADER, email),
    post: (url: string) => request(harness.app).post(url).set(USER_HEADER, email),
    put: (url: string) => request(harness.app).put(url).set(USER_HEADER, email),
    patch: (url: string) => request(harness.app).patch(url).set(USER_HEADER, email),
    delete: (url: string) => request(harness.app).delete(url).set(USER_HEADER, email),
  };
}

export type UserClient = ReturnType<typeof asUser>;
